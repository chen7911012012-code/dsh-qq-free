/**
 * 本地冒烟测试：用假的 ctx / webServer / fetch / WebSocket 跑一遍插件逻辑。
 * 运行：node test/smoke.mjs
 */

import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataRoot = mkdtempSync(join(tmpdir(), 'qq-free-test-'))
process.env.DSH_PROFILE_DIR = dataRoot

let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`)
  else {
    failures += 1
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const GROUP = 'GROUPOPENID1234'

const routes = new Map()
const tools = []
const cleanups = []
const sections = []
let llmFail = false

class MockWebSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.sent = []
    this.readyState = 1
    MockWebSocket.instances.push(this)
  }
  send(data) { this.sent.push(JSON.parse(data)) }
  close() {
    this.readyState = 3
    this.onclose?.({})
  }
  emit(frame) { this.onmessage?.({ data: JSON.stringify(frame) }) }
}
globalThis.WebSocket = MockWebSocket

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function httpCall(url, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url)
    const request = httpRequest({
      hostname: parsed.hostname,
      port: parsed.port,
      path: `${parsed.pathname}${parsed.search}`,
      method: options.method ?? 'GET',
      headers: options.headers ?? {},
    }, (response) => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => { text += chunk })
      response.on('end', () => resolve({
        status: response.statusCode,
        text,
        json: () => JSON.parse(text),
      }))
    })
    request.on('error', reject)
    if (options.body !== undefined) request.write(JSON.stringify(options.body))
    request.end()
  })
}

const webServer = {
  register({ path, handler }) {
    routes.set(path, handler)
    return () => routes.delete(path)
  },
}

const llm = {
  listProviders: () => [{ id: 'deepseek-account', name: 'DeepSeek' }],
  stream(options) {
    return (async function* () {
      if (llmFail) {
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: '模拟鉴权失败' } } }
        return
      }
      const promptText = (options?.messages ?? [])
        .flatMap((message) => message.content ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
      const isClassifier = String(options?.system ?? '').includes('意图分类器')
      const pieces = isClassifier
        ? [promptText.includes('你好') ? 'QUESTION' : 'CHAT']
        : ['今天', '也是', '摸鱼的一天']
      for (const piece of pieces) yield { type: 'text-delta', index: 0, text: piece }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 3 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })()
  },
}

const ctx = {
  logger: {
    info: (msg) => console.log(`  [log] ${msg}`),
    warn: (msg) => console.log(`  [warn] ${msg}`),
    error: (msg) => console.log(`  [err] ${msg}`),
    debug: () => {},
  },
  get(name) {
    if (name === 'llm') return llm
    if (name === 'tools') return { register(definition) { tools.push(definition) } }
    if (name === 'systemPrompt') return { section(section) { sections.push(section); return () => {} } }
    return undefined
  },
  inject(deps, callback) {
    if (deps.includes('webServer')) callback({ webServer })
  },
  effect(fn) {
    const dispose = fn()
    cleanups.push(dispose)
  },
}

const sent = []
globalThis.fetch = async (url, init = {}) => {
  const target = String(url)
  if (target.includes('getAppAccessToken')) {
    return new Response(JSON.stringify({ access_token: 'TOKEN', expires_in: 7200 }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.endsWith('/gateway')) {
    return new Response(JSON.stringify({ url: 'ws://mock-gateway' }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  if (target.startsWith('https://api.sgroup.qq.com/')) {
    const method = String(init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : undefined
    sent.push({ target, method, body, authorization: init.headers.authorization })
    if (method === 'GET' && /\/v2\/users\/[^/]+\/info$/.test(target)) {
      return new Response(JSON.stringify({ username: '申请人', avatar: 'https://example.com/avatar.png', allow_proactive_msg: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && target.endsWith('/files')) {
      return new Response(JSON.stringify({ file_uuid: 'f1', file_info: 'F1', ttl: 300, id: 'IMG-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'GET' && target.includes('/join_request_list')) {
      return new Response(JSON.stringify({
        list: [{ join_request_id: 'J2', member_openid: 'REQ2', username: '另一个人', apply_at: '2026-11-20T09:00:00+08:00', risk_tips: '' }],
        next_cursor: '',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'GET' && target.includes('/restrict_chat_setting')) {
      return new Response(JSON.stringify({ global_rule: { mode: 'none' }, members: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && target.includes('/batch_remove_members')) {
      return new Response(JSON.stringify({ remove_members_result: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (body && typeof body.content === 'string' && body.content.includes('触发配额')) {
      return new Response(JSON.stringify({ code: 11244, message: '主动消息数量已达上限' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ id: `MSG-${sent.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

function call(path, method = 'GET', body) {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`路由未注册：${path}`)
  const payload = body === undefined ? '' : JSON.stringify(body)
  const req = {
    method,
    headers: { host: '127.0.0.1:63381' },
    async *[Symbol.asyncIterator]() {
      if (payload !== '') yield Buffer.from(payload, 'utf8')
    },
  }
  return new Promise((resolve, reject) => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status },
      end(text) {
        try {
          resolve({ status: this.status, body: JSON.parse(text) })
        } catch (error) {
          reject(new Error(`响应不是 JSON：${text.slice(0, 120)}`))
        }
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

const module = await import('../index.js')
check('模块导出 apply', typeof module.apply === 'function')
await module.apply(ctx, {
  appId: '',
  appSecret: '',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  dailyLimit: 2,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
})
check('注册了 19 条 HTTP 路由', routes.size === 19, [...routes.keys()].join(', '))
check('注册了 3 个工具', tools.length === 3)
const qaGuidance = sections.find((section) => section.name === 'qq-free:qa-guidance')
const qaLibrary = sections.find((section) => section.name === 'qq-free:qa-library')
check('注册了问答提示词', typeof qaGuidance?.text === 'string' && qaGuidance.text.includes('qq_qa_lookup'))
check('注册了动态问答库提示', typeof qaLibrary?.text === 'function' && qaLibrary.text({}) === '')

let result = await call('/qq-free/state')
check('初始状态可读', result.status === 200 && result.body.ok === true)
check('初始凭据未配置', result.body.credential.configured === false)

result = await call('/qq-free/config', 'POST', {
  appId: '102757755',
  appSecret: 'secret-for-test',
  persona: '测试人设',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
})
check('保存配置成功', result.status === 200 && result.body.ok === true)
check('配置已写入 config.json', existsSync(join(dataRoot, '.qq-free', 'config.json')))
check('config.json 含 appSecret', readFileSync(join(dataRoot, '.qq-free', 'config.json'), 'utf8').includes('secret-for-test'))

result = await call('/qq-free/config', 'POST', { replyLogFile: join(dataRoot, 'qq-replies.md') })
check('设置回复日志路径', result.status === 200)

result = await call('/qq-free/cloud', 'POST', {
  action: 'save', enabled: false, url: 'https://example.com/dav', user: 'tester', password: 'secret', auto: true,
})
check('保存 WebDAV 云端同步配置', result.status === 200 && result.body.state.cloud.user === 'tester' && result.body.state.cloud.hasPassword === true)

result = await call('/qq-free/github', 'POST', {
  action: 'save', enabled: false, owner: 'chen7911012012-code', repo: 'dsh-qq-free', token: 'test-token', auto: true,
})
check('保存 GitHub 直连配置', result.status === 200 && result.body.state.github.owner === 'chen7911012012-code' && result.body.state.github.hasToken === true)

result = await call('/qq-free/targets', 'POST', { action: 'add', scope: 'group', openid: 'TESTGROUPOPENID12345', name: '测试群' })
check('添加目标成功', result.status === 200)
const targetId = result.body.target.id
result = await call('/qq-free/targets', 'POST', { action: 'add', scope: 'group', openid: 'TESTGROUPOPENID22222', name: '测试群2' })
const target2Id = result.body.target.id
check('添加第二个目标', result.status === 200)

result = await call('/qq-free/generate', 'POST', { topic: '周末', send: true })
check('DeepSeek 生成并发送', result.status === 200 && result.body.sent === true)
check('发送请求带鉴权', sent[0]?.authorization === 'QQBot TOKEN')
check('主动消息不带 msg_id', sent[0] && !('msg_id' in sent[0].body))

result = await call('/qq-free/send', 'POST', { targetId, text: '第二条' })
check('第二条发送成功', result.status === 200)
result = await call('/qq-free/send', 'POST', { targetId, text: '第三条' })
check('每日配额生效', result.status === 400 && /上限/.test(result.body.error))

result = await call('/qq-free/config', 'POST', { dailyLimit: 10 })
check('调高每日配额', result.status === 200 && result.body.state.limits.dailyLimit === 10)

result = await call('/qq-free/boards', 'POST', { action: 'add', name: '测试板块', targetIds: [targetId, target2Id] })
check('添加群板块', result.status === 200 && result.body.board.targetIds.length === 2)
const boardId = result.body.board.id
result = await call('/qq-free/send', 'POST', { targetId: boardId, text: '板块群发测试' })
check('板块一次发到多个群', result.status === 200 && Array.isArray(result.body.results) && result.body.results.length === 2)
result = await call('/qq-free/send', 'POST', { targetId, text: '带@的发言', mention: 'MENTION123456' })
const mentionCall = sent.filter((item) => item.target.endsWith('/messages')).at(-1)
check('自由发言可 @ 群成员', result.status === 200 && mentionCall?.body?.msg_type === 2 && mentionCall?.body?.markdown?.content.includes('<qqbot-at-user id="MENTION123456"/>'), JSON.stringify(mentionCall?.body))

const mediaUploadsBefore = sent.length
result = await call('/qq-free/send-media', 'POST', { targetId, type: 1, url: 'https://example.com/sticker.gif' })
const mediaUpload = sent.slice(mediaUploadsBefore).find((item) => item.target.endsWith('/files'))
const mediaMessage = sent.slice(mediaUploadsBefore).find((item) => item.target.endsWith('/messages') && item.body?.msg_type === 7)
check('发送媒体（图片/表情包）', result.status === 200 && mediaUpload?.body?.url === 'https://example.com/sticker.gif' && Boolean(mediaMessage?.body?.media?.file_info), result.body.error)

result = await call('/qq-free/send-media', 'POST', {
  targetId, type: 1, fileName: 'local.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
})
const localUpload = sent.filter((item) => item.target.endsWith('/files')).at(-1)
check('发送本地选取的图片', result.status === 200 && localUpload?.body?.file_name === 'local.png' && typeof localUpload?.body?.file_data === 'string' && localUpload.body.file_data.length > 20, JSON.stringify(result.body.error))

result = await call('/qq-free/send-media', 'POST', {
  targetId, type: 4, fileName: 'big.bin', data: 'data:application/octet-stream;base64,' + 'A'.repeat(200000),
})
check('大文件请求体可上传（>64KB）', result.status === 200, result.body.error)

result = await call('/qq-free/qa', 'POST', { action: 'add', question: '群规是什么', answer: '不许发广告', keywords: '群规' })
check('添加问答成功', result.status === 200)
check('问答库进入系统提示', qaLibrary.text({}).includes('群规是什么'))
const qaId = result.body.entry.id
result = await call('/qq-free/qa/lookup', 'POST', { question: '这个群的群规是什么' })
check('问答库命中', result.status === 200 && result.body.matched === true)
result = await call('/qq-free/qa/lookup', 'POST', { question: '今天晚饭吃什么', fallback: true })
check('未命中回退 DeepSeek', result.status === 200 && result.body.source === 'deepseek')
result = await call('/qq-free/qa', 'POST', { action: 'remove', id: qaId })
check('删除问答成功', result.status === 200 && result.body.stats.count === 0)

// ── AI 对话通道 ──
result = await call('/qq-free/channel', 'POST', { enabled: true })
check('启用前要求确认', result.status === 409 && result.body.requiresConfirm === true)
result = await call('/qq-free/channel', 'POST', { enabled: true, confirm: true })
check('启用通道', result.status === 200 && result.body.state.chat.enabled === true)
await sleep(120)
const ws = MockWebSocket.instances.at(-1)
check('建立网关连接', Boolean(ws) && ws.url === 'ws://mock-gateway')

if (ws) {
  ws.emit({ op: 10, d: { heartbeat_interval: 45000 } })
  await sleep(10)
  const identify = ws.sent.find((frame) => frame.op === 2)
  check('发送 Identify', identify?.d?.token === 'QQBot TOKEN')
  check('订阅群成员与消息事件', identify?.d?.intents === ((1 << 24) | (1 << 25)), String(identify?.d?.intents))
  ws.emit({ op: 0, s: 1, t: 'READY', d: { session_id: 'S1' } })
  check('READY 后已连接', (await call('/qq-free/state')).body.chat.state === 'connected')

  const beforeC2C = sent.length
  ws.emit({ op: 0, s: 2, t: 'C2C_MESSAGE_CREATE', d: { id: 'EV-1', content: '你好', author: { user_openid: 'USER1' } } })
  await sleep(150)
  check('私聊自动回复', sent.slice(beforeC2C).some((item) => item.target.endsWith('/v2/users/USER1/messages') && item.body?.msg_id === 'EV-1'))

  const beforeDup = sent.length
  ws.emit({ op: 0, s: 3, t: 'C2C_MESSAGE_CREATE', d: { id: 'EV-1', content: '你好', author: { user_openid: 'USER1' } } })
  await sleep(80)
  check('重复事件去重', sent.length === beforeDup)

  result = await call('/qq-free/qa', 'POST', { action: 'add', question: '你好', answer: '库答案不应出现' })
  check('加入同名问答用于验证强制 DeepSeek', result.status === 200)
  const beforeGroup = sent.length
  ws.emit({ op: 0, s: 4, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-2', content: '<@BOT> 你好', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'ASKER1', member_role: 'member' } } })
  await sleep(150)
  const groupReply = sent.slice(beforeGroup).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-2')
  check('群 @ 自动回复', Boolean(groupReply))
  check('群回复用 Markdown @ 提问人', groupReply?.body?.msg_type === 2 && groupReply.body.markdown.content.includes('<qqbot-at-user id="ASKER1"/>'), JSON.stringify(groupReply?.body))
  check('回答强制走 DeepSeek 而非问答库', Boolean(groupReply) && groupReply.body.markdown.content.includes('摸鱼') && !groupReply.body.markdown.content.includes('库答案'), JSON.stringify(groupReply?.body))
  check('提问被识别并走 DeepSeek', (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '你好' && entry.source === 'deepseek'))

  ws.emit({ op: 0, s: 6, t: 'GROUP_ADD_ROBOT', d: { group_openid: 'NEWGROUPOPENID99999', group_name: '新群' } })
  await sleep(120)
  check('机器人被拉进新群后自动出现在目标里', (await call('/qq-free/state')).body.targets.some((target) => target.openid === 'NEWGROUPOPENID99999'))

  const beforeChat = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-CHAT', content: '<@BOT> 今天好累', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'ASKER1', member_role: 'member' } } })
  await sleep(180)
  const chatReply = sent.slice(beforeChat).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-CHAT')
  check('闲聊用智能体人设回复', Boolean(chatReply) && (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '今天好累' && entry.source === 'agent'))
  check('记录群成员目录', (await call('/qq-free/state')).body.members.some((member) => member.openid === 'ASKER1'))
  const chatState = (await call('/qq-free/state')).body
  check('问答写入对话记录', chatState.chatLog.some((entry) => entry.question.includes('你好') && entry.answer.length > 0))
  check('对话写入工作区文件', existsSync(join(dataRoot, 'qq-replies.md')) && readFileSync(join(dataRoot, 'qq-replies.md'), 'utf8').includes('你好'))

  const beforePlain = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-3', content: '路人消息', group_openid: GROUP, mentions: [] } })
  await sleep(80)
  check('普通群消息不回复', sent.length === beforePlain)

  result = await call('/qq-free/config', 'POST', { welcomeEnabled: true, welcomeText: '欢迎 {member_openid}', welcomeGroups: [GROUP] })
  check('保存入群欢迎', result.status === 200 && result.body.state.welcome.enabled === true)
  const beforeWelcome = sent.length
  ws.emit({ op: 0, s: 6, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'NEW1' } })
  await sleep(150)
  const welcome = sent.slice(beforeWelcome).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('入群欢迎已发送', welcome?.body?.content === '欢迎 NEW1' && !('msg_id' in welcome.body))

  const beforeJoin = sent.length
  ws.emit({
    op: 0, s: 7, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERREQ1',
      union_openid: 'UNIONREQ1',
      join_request_id: 'JOINREQ123456',
      username: '申请人',
      apply_at: '2026-11-20T09:00:00+08:00',
      verify_info: { method: 'admin_review_qa', review_qa_list: [{ question: '你为什么加群', answer: '想交流' }] },
    },
  })
  await sleep(200)
  const joinCalls = sent.slice(beforeJoin)
  const avatarUpload = joinCalls.find((item) => item.target.endsWith(`/v2/groups/${GROUP}/files`))
  const joinNotice = joinCalls.find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('申请头像已上传', Boolean(avatarUpload) && avatarUpload.body.url === 'https://example.com/avatar.png' && avatarUpload.body.srv_send_msg === true, JSON.stringify(avatarUpload?.body))
  check('入群申请通知已发到对应群', Boolean(joinNotice) && joinNotice.body.content.includes('申请人'), JSON.stringify(joinNotice?.body))
  check('通知含申请时间与验证答案', Boolean(joinNotice) && joinNotice.body.content.includes('申请时间') && joinNotice.body.content.includes('回答：想交流'), JSON.stringify(joinNotice?.body))
  check('通知只显示成员 openid，不显示群 openid', Boolean(joinNotice) && joinNotice.body.content.includes('成员 openid：') && !joinNotice.body.content.includes('群 openid：'), JSON.stringify(joinNotice?.body))
  check('通知不再出现 <@...> 或申请号', Boolean(joinNotice) && !joinNotice.body.content.includes('<@') && !joinNotice.body.content.includes('申请号'), JSON.stringify(joinNotice?.body))
  check('入群申请已记录', (await call('/qq-free/state')).body.pendingJoins.length === 1)

  result = await call('/qq-free/group-admin', 'POST', { action: 'list', groupOpenid: GROUP })
  check('拉取入群申请列表', result.status === 200 && result.body.list.length === 1 && result.body.list[0].member_openid === 'REQ2')
  check('未同意的申请不被自动删除', (await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ1'))

  const beforeDeny = sent.length
  ws.emit({
    op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-CMD0', content: '同意 申请人', group_openid: GROUP, mentions: [], author: { member_role: 'member' } },
  })
  await sleep(100)
  check('非管理员命令被忽略', sent.length === beforeDeny)

  const beforeCommand = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-CMD1', content: '同意 申请人', group_openid: GROUP, mentions: [], author: { member_role: 'admin', member_nickname: '测试管理员' } },
  })
  await sleep(150)
  const commandReply = sent.slice(beforeCommand).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('群内管理员「同意」生效', sent.some((item) => item.target.includes('/approval_join_request/MEMBERREQ1') && item.body?.op === 'approve')
    && commandReply?.body?.msg_id === 'EV-CMD1' && commandReply?.body?.content.includes('已由 测试管理员 通过'), JSON.stringify(commandReply?.body))
  check('命令处理后申请已移除', !(await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ1'))

  result = await call('/qq-free/group-admin', 'POST', {
    action: 'approve', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1', joinRequestId: 'JOINREQ123456', operator: '测试管理员',
  })
  check('通过入群申请', result.status === 200 && sent.find((item) => item.target.includes('/approval_join_request/MEMBERREQ1'))?.body?.op === 'approve')
  check('审批记录操作人', result.body.operator === '测试管理员' && (await call('/qq-free/state')).body.lastApproval?.operator === '测试管理员')

  result = await call('/qq-free/group-admin', 'POST', { action: 'mute', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1', minutes: 30 })
  const muteCall = sent.filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  check('禁言成员', result.status === 200 && muteCall?.body?.members?.[0]?.op === 'add')

  result = await call('/qq-free/group-admin', 'POST', { action: 'unmute', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1' })
  const unmuteCall = sent.filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  check('解除禁言', result.status === 200 && unmuteCall?.body?.members?.[0]?.op === 'del')

  result = await call('/qq-free/group-admin', 'POST', { action: 'kick', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1' })
  check('踢出成员', result.status === 200 && sent.find((item) => item.target.includes('/batch_remove_members'))?.body?.member_openids?.[0] === 'MEMBERREQ1')

  result = await call('/qq-free/group-admin', 'POST', { action: 'mutes', groupOpenid: GROUP })
  check('查询禁言状态', result.status === 200 && result.body.mutes.global_rule.mode === 'none')

  const beforeMod = sent.length
  ws.emit({
    op: 0, s: 10, t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'EV-MUTE', content: '禁言 30', group_openid: GROUP,
      mentions: [{ member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN1', member_role: 'admin' },
    },
  })
  await sleep(150)
  const modMute = sent.slice(beforeMod).filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  const modReply = sent.slice(beforeMod).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-MUTE')
  check('群内 @成员 禁言', modMute?.body?.members?.[0]?.member_openid === 'TARGET123456' && modReply?.body?.content.includes('已禁言'), JSON.stringify(modMute?.body))

  ws.emit({
    op: 0, s: 11, t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'EV-KICK', content: '踢人', group_openid: GROUP,
      mentions: [{ member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN1', member_role: 'admin' },
    },
  })
  await sleep(150)
  const modKick = sent.filter((item) => item.target.includes('/batch_remove_members')).at(-1)
  check('群内 @成员 踢人', modKick?.body?.member_openids?.[0] === 'TARGET123456', JSON.stringify(modKick?.body))

  ws.emit({
    op: 0, s: 12, t: 'GROUP_JOIN_REQUEST',
    d: { group_openid: GROUP, member_openid: 'MEMBERREQ2', join_request_id: 'JOINREQ654321', username: '另一位' },
  })
  await sleep(120)
  check('新申请已记录', (await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ2'))
  ws.emit({ op: 0, s: 13, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'MEMBERREQ2' } })
  await sleep(120)
  check('成员入群后自动清掉申请', !(await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ2'))

  result = await call('/qq-free/config', 'POST', {
    moderationEnabled: true,
    moderationGroups: [GROUP],
    bannedWords: ['坏词'],
    moderationMuteMinutes: 5,
  })
  check('保存违禁词设置', result.status === 200 && result.body.state.moderation.words.includes('坏词'))

  const emitBad = (id, content, role) => ws.emit({
    op: 0, s: 20 + Number(id.slice(-1)), t: 'GROUP_MESSAGE_CREATE',
    d: { id, content, group_openid: GROUP, mentions: [], author: { member_openid: 'BADUSER1', member_nickname: '捣乱的', member_role: role } },
  })
  const beforeBad = sent.length
  emitBad('EV-BAD1', '这里有坏词', 'member')
  await sleep(150)
  check('第 1 次违规撤回并警告', sent.some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-BAD1'))
    && sent.slice(beforeBad).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('第 1 次')))
  emitBad('EV-BAD2', '又是坏词', 'member')
  await sleep(150)
  check('第 2 次违规禁言', sent.some((item) => item.method === 'POST' && item.target.includes('/restrict_chat_setting') && item.body?.members?.[0]?.member_openid === 'BADUSER1')
    && sent.some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('第 2 次')))
  emitBad('EV-BAD3', '还是坏词', 'member')
  await sleep(150)
  check('第 3 次违规踢出', sent.some((item) => item.target.includes('/batch_remove_members') && item.body?.member_openids?.[0] === 'BADUSER1')
    && sent.some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('第 3 次')))
  check('踢出后违规次数清零', (await call('/qq-free/state')).body.moderation.strikes.every((entry) => entry.memberOpenid !== 'BADUSER1'))

  const beforeAdminBad = sent.length
  emitBad('EV-BAD4', '管理员也发坏词', 'admin')
  await sleep(100)
  check('管理员不被违禁词处罚', !sent.slice(beforeAdminBad).some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-BAD4')))

  result = await call('/qq-free/blocklist', 'POST', { action: 'add', groupOpenid: GROUP, memberOpenid: 'BLOCKED1', name: '被屏蔽的人' })
  check('添加屏蔽成员', result.status === 200 && result.body.state.blockedMembers.some((entry) => entry.memberOpenid === 'BLOCKED1'))
  const beforeBlocked = sent.length
  ws.emit({
    op: 0, s: 15, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-BLOCK1', content: '<@BOT> 你好', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'BLOCKED1', member_nickname: '被屏蔽的人', member_role: 'member' } },
  })
  await sleep(150)
  check('屏蔽成员的消息被忽略', sent.length === beforeBlocked)
  result = await call('/qq-free/blocklist', 'POST', { action: 'remove', groupOpenid: GROUP, memberOpenid: 'BLOCKED1' })
  check('取消屏蔽成员', result.status === 200 && !result.body.state.blockedMembers.some((entry) => entry.memberOpenid === 'BLOCKED1'))

  result = await call('/qq-free/blocklist', 'POST', { action: 'add-mention', groupOpenid: GROUP, memberOpenid: 'MENTIONBLOCK1', name: '被 @ 的人' })
  check('添加 @ 屏蔽', result.status === 200 && result.body.state.blockedMentions.some((entry) => entry.memberOpenid === 'MENTIONBLOCK1'))
  const beforeMentionBlocked = sent.length
  ws.emit({
    op: 0, s: 16, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-MBLOCK1', content: '<@MENTIONBLOCK1> <@BOT> 在吗', group_openid: GROUP, mentions: [{ member_openid: 'MENTIONBLOCK1' }, { bot: true, is_you: true }], author: { member_openid: 'NORMALUSER1', member_nickname: '普通人', member_role: 'member' } },
  })
  await sleep(150)
  check('@ 被屏蔽成员的消息被忽略', sent.length === beforeMentionBlocked)
  result = await call('/qq-free/blocklist', 'POST', { action: 'remove-mention', groupOpenid: GROUP, memberOpenid: 'MENTIONBLOCK1' })
  check('取消 @ 屏蔽', result.status === 200 && !result.body.state.blockedMentions.some((entry) => entry.memberOpenid === 'MENTIONBLOCK1'))
}

result = await call('/qq-free/channel', 'POST', { enabled: false, confirm: true })
check('停止通道', result.status === 200 && result.body.state.chat.state === 'stopped')

const remotePort = 37000 + (process.pid % 500)
result = await call('/qq-free/remote', 'POST', { enabled: true, port: remotePort, token: 'test-token' })
check('启用远程网页', result.status === 200 && result.body.state.remote.running === true && result.body.state.remote.token === 'test-token', result.body.error)
await sleep(200)
const remoteBase = `http://127.0.0.1:${remotePort}`
const pageRes = await httpCall(`${remoteBase}/`)
check('远程网页可打开', pageRes.status === 200 && pageRes.text.includes('QQ 自由发言'))
const unauth = await httpCall(`${remoteBase}/api/state`)
check('远程接口拒绝无 token', unauth.status === 401)
const authRes = await httpCall(`${remoteBase}/api/state`, { headers: { authorization: 'Bearer test-token' } })
const authBody = authRes.json()
check('远程接口 token 可用', authRes.status === 200 && authBody.ok === true && Array.isArray(authBody.targets))
const remoteSend = await httpCall(`${remoteBase}/api/send`, {
  method: 'POST',
  headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
  body: { targetId, text: '远程网页发送测试' },
})
check('远程网页可发言', remoteSend.status === 200 && remoteSend.json().ok === true)
result = await call('/qq-free/remote', 'POST', { enabled: false })
check('停止远程网页', result.status === 200 && result.body.state.remote.running === false)

llmFail = true
result = await call('/qq-free/generate', 'POST', { topic: '失败' })
check('模型失败有明确错误', result.status === 400 && /AUTH/.test(result.body.error))
llmFail = false

for (const dispose of cleanups) if (typeof dispose === 'function') await dispose()
rmSync(dataRoot, { recursive: true, force: true })
console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
