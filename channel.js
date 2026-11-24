/**
 * QQ 官方机器人「AI 对话」通道。
 *
 * 直连开放平台 WebSocket 网关，接收群 @ 消息与私聊消息，先用问答库、
 * 再用 DeepSeek 生成回复，通过被动回复接口（msg_id）发回 QQ。
 *
 * 注意：官方 AppID 同时只能有一个稳定的消息接收方。启用本通道前应停用
 * 官方 QQ 插件（@tencent-connect/dsh-qqbot），否则两个连接会抢事件。
 *
 * @module @local/dsh-qq-free/channel
 */

const INTENT_GROUP_MEMBER = 1 << 24
const INTENT_GROUP_AND_C2C = 1 << 25
const INTENTS = INTENT_GROUP_MEMBER | INTENT_GROUP_AND_C2C
const MAX_SEEN = 800
const MAX_HISTORY = 12
const MAX_CHUNKS = 4

function stripMentions(text) {
  return String(text ?? '')
    .replace(/<@!?[^>]+>/g, '')
    .replace(/<@[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function chunkText(text, size = 1400) {
  const value = String(text ?? '').trim()
  if (value.length <= size) return value.length > 0 ? [value] : []
  const chunks = []
  let rest = value
  while (rest.length > 0 && chunks.length < MAX_CHUNKS) {
    let cut = Math.min(size, rest.length)
    const newline = rest.lastIndexOf('\n', cut)
    if (newline > size * 0.4) cut = newline
    chunks.push(rest.slice(0, cut).trim())
    rest = rest.slice(cut).trim()
  }
  return chunks.filter((chunk) => chunk.length > 0)
}

/**
 * @param {object} deps
 * @param {() => object} deps.getConfig 读取生效配置
 * @param {() => Promise<string>} deps.getAccessToken 取 access_token
 * @param {(question: string) => ({entry: object, score: number}|null)} deps.searchQa 问答库匹配
 * @param {(entry: object) => void} deps.recordQaHit 命中计数
 * @param {(input: {question: string, history: Array<{role: string, text: string}>, persona: string}) => Promise<string>} deps.generateReply DeepSeek 回复
 * @param {(entry: object) => void} deps.onReply 发送成功回调
 * @param {object} deps.logger
 */
export function createChatChannel(deps) {
  const { getConfig, getAccessToken, searchQa, recordQaHit, generateReply, onReply } = deps
  const classifyQuestion = deps.classifyQuestion
  const onMemberAdd = deps.onMemberAdd
  const onMemberRemove = deps.onMemberRemove
  const onJoinRequest = deps.onJoinRequest
  const onGroupCommand = deps.onGroupCommand
  const onMemberSeen = deps.onMemberSeen
  const onGroupModeration = deps.onGroupModeration
  const onMemberBlocked = deps.onMemberBlocked
  const onMentionBlocked = deps.onMentionBlocked
  const onGroupSeen = deps.onGroupSeen
  const onMemberActivity = deps.onMemberActivity
  const onGroupAllBlocked = deps.onGroupAllBlocked
  const onGroupFeatureBlocked = deps.onGroupFeatureBlocked
  const onInfoCommand = deps.onInfoCommand
  const onFortune = deps.onFortune
  const onVerifyCode = deps.onVerifyCode
  const logger = deps.logger ?? console

  let socket = null
  let heartbeat = null
  let reconnectTimer = null
  let running = false
  let attempt = 0
  let sessionId = null
  let seq = 0
  let lastHelloAt = 0

  const seen = new Set()
  const seenOrder = []
  const histories = new Map()
  const queues = new Map()

  let status = {
    state: 'stopped',
    since: null,
    lastError: '',
    lastEventAt: null,
    messages: 0,
    replies: 0,
    connectedAt: null,
    frames: 0,
    lastOp: null,
    lastEventType: '',
    lastFrameAt: null,
    lastEventSample: '',
  }

  function setStatus(patch) {
    status = { ...status, ...patch }
  }

  function remember(id) {
    if (seen.has(id)) return false
    seen.add(id)
    seenOrder.push(id)
    if (seenOrder.length > MAX_SEEN) {
      const dropped = seenOrder.shift()
      seen.delete(dropped)
    }
    return true
  }

  function sendFrame(payload) {
    if (socket === null) return
    try {
      socket.send(JSON.stringify(payload))
    } catch (error) {
      logger.warn(`qq-free channel: 发送网关帧失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  function stopHeartbeat() {
    if (heartbeat !== null) {
      clearInterval(heartbeat)
      heartbeat = null
    }
  }

  function scheduleReconnect() {
    if (!running) return
    attempt += 1
    const delay = Math.min(30_000, 1_500 * 2 ** Math.min(attempt, 5))
    stopHeartbeat()
    setStatus({ state: 'connecting' })
    if (reconnectTimer !== null) clearTimeout(reconnectTimer)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, delay)
  }

  async function apiRequest(token, method, path, body) {
    const base = String(getConfig().apiBase || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json',
        'user-agent': 'dsh-qq-free/1.2',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
    const text = await response.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok) {
      const message = parsed && parsed.message ? parsed.message : text.slice(0, 200)
      throw new Error(`QQ 接口 HTTP ${response.status}: ${message}`)
    }
    return parsed
  }

  async function gatewayUrl(token) {
    const cfg = getConfig()
    const base = String(cfg.apiBase || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
    const response = await fetch(`${base}/gateway`, {
      headers: { authorization: `QQBot ${token}`, 'user-agent': 'dsh-qq-free/1.2' },
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    let parsed = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!response.ok || parsed === null || typeof parsed.url !== 'string') {
      throw new Error(`获取 QQ 网关地址失败: HTTP ${response.status} ${text.slice(0, 160)}`)
    }
    return parsed.url
  }

  function startHeartbeat(intervalMs) {
    stopHeartbeat()
    const interval = Math.max(5_000, Number(intervalMs) || 30_000)
    heartbeat = setInterval(() => {
      sendFrame({ op: 1, d: seq === 0 ? null : seq })
    }, interval)
    heartbeat.unref?.()
  }

  function identify(token) {
    sendFrame({
      op: 2,
      d: {
        token: `QQBot ${token}`,
        intents: INTENTS,
        shard: [0, 1],
        properties: {},
      },
    })
  }

  function resume(token) {
    if (sessionId === null) {
      identify(token)
      return
    }
    sendFrame({ op: 6, d: { token: `QQBot ${token}`, session_id: sessionId, seq } })
  }

  async function connect() {
    if (!running) return
    setStatus({ state: 'connecting' })
    let token
    try {
      token = await getAccessToken()
      const url = await gatewayUrl(token)
      if (!running) return
      const WebSocketImpl = globalThis.WebSocket
      if (typeof WebSocketImpl !== 'function') {
        throw new Error('当前运行时不支持 WebSocket（需要 Node 22+ 或 Electron 的 WebSocket）')
      }
      socket = new WebSocketImpl(url)
      socket.onopen = () => {
        attempt = 0
        lastHelloAt = Date.now()
      }
      socket.onmessage = (event) => {
        let frame
        try {
          frame = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data))
        } catch {
          return
        }
        void handleFrame(frame, token)
      }
      socket.onerror = () => {
        setStatus({ lastError: 'WebSocket 连接错误' })
      }
      socket.onclose = () => {
        socket = null
        stopHeartbeat()
        if (!running) {
          setStatus({ state: 'stopped' })
          return
        }
        setStatus({ state: 'connecting' })
        scheduleReconnect()
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setStatus({ state: 'error', lastError: message })
      logger.warn(`qq-free channel: 连接失败: ${message}`)
      scheduleReconnect()
    }
  }

  async function handleFrame(frame, token) {
    if (frame === null || typeof frame !== 'object') return
    status.frames += 1
    status.lastOp = frame.op ?? null
    status.lastFrameAt = new Date().toISOString()
    if (typeof frame.t === 'string' && frame.t.length > 0) {
      status.lastEventType = frame.t
      if (frame.op === 0 && frame.t !== 'READY' && frame.t !== 'RESUMED') {
        status.lastEventSample = JSON.stringify(frame.d ?? {}).slice(0, 800)
        logger.info(`qq-free channel: 收到事件 ${frame.t}`)
      }
    }
    if (typeof frame.s === 'number' && frame.s > seq) seq = frame.s
    switch (frame.op) {
      case 10: {
        lastHelloAt = Date.now()
        startHeartbeat(frame.d?.heartbeat_interval)
        if (sessionId !== null) resume(token)
        else identify(token)
        return
      }
      case 0: {
        if (frame.t === 'READY') {
          sessionId = frame.d?.session_id ?? null
          attempt = 0
          setStatus({ state: 'connected', connectedAt: new Date().toISOString(), lastError: '' })
          return
        }
        if (frame.t === 'RESUMED') {
          setStatus({ state: 'connected', lastError: '' })
          return
        }
        void handleDispatch(frame.t, frame.d).catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          setStatus({ lastError: message })
          logger.warn(`qq-free channel: 事件处理失败: ${message}`)
        })
        return
      }
      case 7: {
        socket?.close()
        return
      }
      case 9: {
        sessionId = null
        seq = 0
        socket?.close()
        return
      }
      case 11:
      default:
        return
    }
  }

  function mentionsBot(data) {
    const mentions = Array.isArray(data?.mentions) ? data.mentions : []
    // 只认当前机器人被 @；其他机器人也会带 bot:true，不能用它判断
    return mentions.some((mention) => mention && mention.is_you === true)
  }

  function isOpenModerationCommand(data) {
    const text = String(data?.content ?? '').replace(/<@!?[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    // 禁/解/踢 快捷管理，以及同意/拒绝入群申请，都不需要 @机器人
    if (/^(同意|通过|拒绝|不同意)(\s+\S+)?$/.test(text)) return true
    if (!/^(禁|解|踢|飞)$/.test(text)) return false
    const mentions = Array.isArray(data?.mentions) ? data.mentions : []
    return mentions.some((mention) => mention && mention.is_you !== true && mention.member_openid)
  }

  async function handleDispatch(type, data) {
    if (data === null || typeof data !== 'object') return
    if (type === 'GROUP_ADD_ROBOT') {
      status.lastEventAt = new Date().toISOString()
      if (typeof onGroupSeen === 'function' && data.group_openid) {
        try { onGroupSeen({ groupOpenid: data.group_openid, groupName: data.group_name, defaultBlock: true }) } catch { /* ignore */ }
      }
      return
    }
    if (type === 'GROUP_MEMBER_ADD') {
      status.lastEventAt = new Date().toISOString()
      if (typeof onGroupSeen === 'function' && data.group_openid) {
        try { onGroupSeen({ groupOpenid: data.group_openid, groupName: data.group_name }) } catch { /* ignore */ }
      }
      Promise.resolve(onMemberAdd?.(data)).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ lastError: message })
        logger.warn(`qq-free channel: 欢迎消息失败: ${message}`)
      })
      return
    }
    if (type === 'GROUP_JOIN_REQUEST') {
      status.lastEventAt = new Date().toISOString()
      if (typeof onGroupSeen === 'function' && data.group_openid) {
        try { onGroupSeen({ groupOpenid: data.group_openid, groupName: data.group_name }) } catch { /* ignore */ }
      }
      Promise.resolve(onJoinRequest?.(data)).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ lastError: message })
        logger.warn(`qq-free channel: 记录入群申请失败: ${message}`)
      })
      return
    }
    let scope = null
    let openid = null
    let asker = ''
    let askerName = ''
    if (type === 'GROUP_AT_MESSAGE_CREATE' || type === 'GROUP_MESSAGE_CREATE') {
      scope = 'group'
      openid = data.group_openid ?? data.group_id
      asker = String(data.author?.member_openid ?? data.author?.id ?? '')
      askerName = String(data.author?.member_nickname ?? data.author?.username ?? '')
    } else if (type === 'C2C_MESSAGE_CREATE') {
      scope = 'c2c'
      openid = data.author?.user_openid ?? data.author?.id
    }
    if (scope === null || typeof openid !== 'string' || openid.length === 0) return
    // 屏蔽其他机器人（Q群管家等）的消息
    if (data.author?.bot === true || data.author?.is_bot === true) return
    // 屏蔽所有群里的 @所有人 消息
    if (scope === 'group') {
      const mentions = Array.isArray(data.mentions) ? data.mentions : []
      const rawContent = String(data.content ?? '')
      if (mentions.some((mention) => mention && (mention.scope === 'all' || mention.is_everyone === true))
        || /<@all>|<qqbot-at-everyone/i.test(rawContent)) return
    }
    if (scope === 'group' && typeof onGroupSeen === 'function') {
      try { onGroupSeen({ groupOpenid: openid, groupName: data.group_name }) } catch { /* ignore */ }
    }
    if (scope === 'group' && typeof onMemberActivity === 'function') {
      try {
        onMemberActivity({
          groupOpenid: openid,
          memberOpenid: asker,
          username: String(data.author?.member_nickname ?? data.author?.username ?? ''),
        })
      } catch { /* ignore */ }
    }
    if (scope === 'group' && typeof onGroupAllBlocked === 'function' && onGroupAllBlocked(openid)) return
    const id = String(data.id ?? '')
    if (id.length === 0 || !remember(id)) return

    if (scope === 'group' && asker.length > 0 && typeof onMemberSeen === 'function') {
      try {
        onMemberSeen({
          groupOpenid: openid,
          memberOpenid: asker,
          username: String(data.author?.member_nickname ?? data.author?.username ?? ''),
          memberRole: String(data.author?.member_role ?? ''),
        })
      } catch {
        // 成员目录只是辅助信息，失败不影响回复
      }
    }

    // 入群人机验证：未验证成员的所有消息都先交给验证逻辑
    if (scope === 'group' && typeof onVerifyCode === 'function') {
      let verifyResult = null
      try {
        verifyResult = await onVerifyCode(data)
      } catch (error) {
        logger.warn(`qq-free channel: 入群验证失败 ${error instanceof Error ? error.message : String(error)}`)
      }
      if (verifyResult !== null && verifyResult.handled === true) {
        if (typeof verifyResult.reply === 'string' && verifyResult.reply.length > 0) {
          await sendReply('group', openid, id, verifyResult.reply)
        }
        if (typeof verifyResult.afterReply === 'function') {
          try {
            await verifyResult.afterReply()
          } catch (error) {
            logger.warn(`qq-free channel: 验证回复后操作失败 ${error instanceof Error ? error.message : String(error)}`)
          }
        }
        return
      }
    }

    // 屏蔽成员：完全忽略该成员在此群的消息
    if (scope === 'group' && typeof onMemberBlocked === 'function' && onMemberBlocked({ groupOpenid: openid, memberOpenid: asker })) {
      return
    }

    // 屏蔽 @ 目标：消息里 @ 了被屏蔽的人就整条忽略
    if (scope === 'group' && typeof onMentionBlocked === 'function' && onMentionBlocked({ groupOpenid: openid, mentions: data.mentions })) {
      return
    }

    // 违禁词：命中后撤回/禁言/踢人，并回一条警告，不再走 AI
    if (scope === 'group' && typeof onGroupModeration === 'function'
      && !(typeof onGroupFeatureBlocked === 'function' && onGroupFeatureBlocked(openid, 'moderation'))) {
      let moderation = null
      try {
        moderation = await onGroupModeration({
          groupOpenid: openid,
          messageId: id,
          memberOpenid: asker,
          memberName: askerName,
          memberRole: String(data.author?.member_role ?? ''),
          content: data.content,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ lastError: message })
        logger.warn(`qq-free channel: 违禁词处理失败: ${message}`)
      }
      if (moderation !== null && moderation.handled === true) {
        if (typeof moderation.reply === 'string' && moderation.reply.length > 0) {
          try {
            await sendReply('group', openid, id, moderation.reply)
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error)
            setStatus({ lastError: message })
            logger.warn(`qq-free channel: 违禁词警告发送失败: ${message}`)
          }
        }
        return
      }
    }

    // 「@某人 获取信息」：公开查询，不需要管理员；群全量消息必须 @ 当前机器人
    if (scope === 'group' && typeof onInfoCommand === 'function'
      && (type !== 'GROUP_MESSAGE_CREATE' || mentionsBot(data))) {
      let infoReply = null
      try {
        infoReply = await onInfoCommand(data)
      } catch (error) {
        logger.warn(`qq-free channel: 查询成员信息失败 ${error instanceof Error ? error.message : String(error)}`)
      }
      if (typeof infoReply === 'string' && infoReply.length > 0) {
        await sendReply('group', openid, id, infoReply)
        return
      }
    }

    // 今日运势：无需 @机器人，任何人发「今日运势」都触发，每天一次
    if (scope === 'group' && typeof onFortune === 'function') {
      let fortuneReply = null
      try {
        fortuneReply = await onFortune(data)
      } catch (error) {
        logger.warn(`qq-free channel: 今日运势失败 ${error instanceof Error ? error.message : String(error)}`)
      }
      if (typeof fortuneReply === 'string' && fortuneReply.length > 0) {
        await sendReply('group', openid, id, fortuneReply)
        return
      }
    }

    // 群全量消息里，默认必须 @ 当前机器人；禁/解/踢、同意/拒绝 允许不 @
    if (scope === 'group' && type === 'GROUP_MESSAGE_CREATE'
      && !mentionsBot(data) && !isOpenModerationCommand(data)) return

    // 群里管理员用「同意 / 拒绝 <申请号>」处理入群申请：走被动回复，不耗主动消息
    if (scope === 'group' && typeof onGroupCommand === 'function'
      && !(typeof onGroupFeatureBlocked === 'function' && onGroupFeatureBlocked(openid, 'commands'))) {
      let commandReply = null
      try {
        commandReply = await onGroupCommand(data)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ lastError: message })
        logger.warn(`qq-free channel: 群管理命令失败: ${message}`)
        commandReply = `处理失败：${message}`
      }
      if (typeof commandReply === 'string' && commandReply.length > 0) {
        status.messages += 1
        status.lastEventAt = new Date().toISOString()
        await sendReply('group', openid, id, commandReply)
        return
      }
    }

    // 群全量消息事件只有 @ 机器人的那条才处理，避免对每条群消息都插嘴
    if (scope === 'group' && typeof onGroupFeatureBlocked === 'function' && onGroupFeatureBlocked(openid, 'chat')) return
    if (type === 'GROUP_MESSAGE_CREATE' && !mentionsBot(data)) return
    const question = stripMentions(data.content)

    status.messages += 1
    status.lastEventAt = new Date().toISOString()
    const key = `${scope}:${openid}`
    const previous = queues.get(key) ?? Promise.resolve()
    const next = previous
      .then(() => handleMessage({ scope, openid, msgId: id, question, key, asker, askerName }))
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        setStatus({ lastError: message })
        logger.warn(`qq-free channel: 处理消息失败: ${message}`)
      })
    queues.set(key, next)
  }

  async function sendReply(scope, openid, msgId, text, options = {}) {
    const token = await getAccessToken()
    const path = scope === 'c2c'
      ? `/v2/users/${encodeURIComponent(openid)}/messages`
      : `/v2/groups/${encodeURIComponent(openid)}/messages`
    const chunks = chunkText(text)
    let sent = 0
    for (let index = 0; index < chunks.length; index += 1) {
      const base = { msg_id: msgId, msg_seq: index + 1 }
      const mention = index === 0 && scope === 'group' && typeof options.mention === 'string' && options.mention.length > 0
        ? options.mention
        : ''
      if (mention.length > 0) {
        try {
          await apiRequest(token, 'POST', path, {
            ...base,
            msg_type: 2,
            markdown: { content: `<qqbot-at-user id="${mention}"/> ${chunks[index]}` },
          })
          sent += 1
          continue
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          logger.warn(`qq-free channel: Markdown @ 失败，降级为文字: ${message}`)
        }
      }
      const fallbackPrefix = index === 0 && mention.length > 0 && options.mentionName
        ? `@${options.mentionName} `
        : ''
      await apiRequest(token, 'POST', path, {
        ...base,
        content: `${fallbackPrefix}${chunks[index]}`,
        msg_type: 0,
      })
      sent += 1
    }
    return sent
  }

  async function handleMessage({ scope, openid, msgId, question, key, asker, askerName }) {
    const cfg = getConfig()
    const history = histories.get(key) ?? []
    let answer = ''
    let source = 'deepseek'
    if (question.length === 0) {
      answer = '在的，直接问我问题就行。'
      source = 'prompt'
    } else {
      // 先判断是提问还是闲聊：提问优先查问答库，闲聊直接用智能体
      const isQuestion = typeof classifyQuestion === 'function' ? await classifyQuestion(question) : true
      const match = isQuestion && cfg.chatUseQa !== false ? searchQa(question) : null
      if (match !== null) {
        answer = String(match.entry.answer ?? '').trim()
        source = 'library'
        recordQaHit(match.entry)
      }
      if (answer.length === 0) {
        answer = await generateReply({
          question,
          history,
          persona: cfg.chatPersona || '',
          mode: isQuestion ? 'question' : 'chat',
          chatPersona: cfg.chatAgentPersona || '',
        })
        source = isQuestion ? 'deepseek' : 'agent'
      }
    }
    if (answer.length === 0) return
    // 群里回答必须 @ 提问的人：用 Markdown 的 qqbot-at-user 标签（纯文本 <@openid> 会原样显示）
    const sent = await sendReply(scope, openid, msgId, answer, {
      mention: scope === 'group' ? asker : '',
      mentionName: askerName,
    })
    history.push({ role: 'user', text: question })
    history.push({ role: 'assistant', text: answer })
    while (history.length > MAX_HISTORY) history.shift()
    histories.set(key, history)
    status.replies += sent
    onReply?.({
      at: new Date().toISOString(),
      scope,
      openid,
      asker,
      askerName,
      question,
      answer,
      source,
      chunks: sent,
    })
  }

  return {
    start() {
      if (running) return status
      running = true
      attempt = 0
      sessionId = null
      seq = 0
      setStatus({ state: 'connecting', since: new Date().toISOString(), lastError: '' })
      void connect()
      return status
    },
    stop() {
      running = false
      attempt = 0
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      stopHeartbeat()
      const active = socket
      socket = null
      try {
        active?.close()
      } catch {
        // ignore
      }
      sessionId = null
      seq = 0
      setStatus({ state: 'stopped', connectedAt: null })
      return status
    },
    status() {
      return { ...status }
    },
    lastHelloAt() {
      return lastHelloAt
    },
  }
}
