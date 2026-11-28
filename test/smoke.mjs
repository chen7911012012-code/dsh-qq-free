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
let groupMuted = false

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
        headers: response.headers,
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
    if (method === 'GET' && target.includes('/restrict_chat_setting')) {
      return new Response(JSON.stringify({
        global_rule: { mode: groupMuted ? 'all' : 'none', schedule_rules: [], recurring_rules: [] },
        members: [],
      }), { status: 200, headers: { 'content-type': 'application/json' } })
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
check('注册了 34 条 HTTP 路由', routes.size === 34, [...routes.keys()].join(', '))
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
  action: 'save', enabled: false, owner: 'chen7911012012-code', repo: 'dsh-qq-free', token: 'test12', auto: true,
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
result = await call('/qq-free/qa', 'POST', { action: 'add', question: '群规是什么', answer: '不许发广告（更新）', keywords: '群规' })
check('重复问题只更新不新增', result.status === 200 && result.body.updated === true && (await call('/qq-free/qa')).body.entries.filter((entry) => entry.question === '群规是什么').length === 1)
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
  check('问答库命中时优先使用库答案', Boolean(groupReply) && groupReply.body.markdown.content.includes('库答案') && !groupReply.body.markdown.content.includes('摸鱼'), JSON.stringify(groupReply?.body))
  check('问答库命中记录 source=library', (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '你好' && entry.source === 'library'))

  ws.emit({ op: 0, s: 6, t: 'GROUP_ADD_ROBOT', d: { group_openid: 'NEWGROUPOPENID99999', group_name: '新群' } })
  await sleep(120)
  check('机器人被拉进新群后自动出现在目标里', (await call('/qq-free/state')).body.targets.some((target) => target.openid === 'NEWGROUPOPENID99999'))
  check('新群默认屏蔽全部功能', (await call('/qq-free/state')).body.groupBlocks.some((entry) => entry.groupOpenid === 'NEWGROUPOPENID99999' && entry.all === true))

  const beforeChat = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-CHAT', content: '<@BOT> 今天好累', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'ASKER1', member_role: 'member' } } })
  await sleep(180)
  const chatReply = sent.slice(beforeChat).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-CHAT')
  check('闲聊用智能体人设回复', Boolean(chatReply) && (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '今天好累' && entry.source === 'agent'))
  check('记录群成员目录', (await call('/qq-free/state')).body.members.some((member) => member.openid === 'ASKER1'))

  // 昵称里带不可见字符时，状态接口要给出能显示的成员名（不能空白名 / bidi 乱码）
  ws.emit({ op: 0, s: 40, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-NAME1', content: '路过', group_openid: GROUP, mentions: [], author: { member_openid: 'BLANKNAME000123', member_nickname: '\u3164', member_role: 'member' } } })
  ws.emit({ op: 0, s: 41, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-NAME2', content: '路过', group_openid: GROUP, mentions: [], author: { member_openid: 'BIDIMEMBER01', member_nickname: '上传-Komorebi\u1160\u2067~喵\u2067\u202D', member_role: 'member' } } })
  await sleep(120)
  const nameState = (await call('/qq-free/state')).body
  const blankMember = nameState.members.find((member) => member.openid === 'BLANKNAME000123')
  const bidiMember = nameState.members.find((member) => member.openid === 'BIDIMEMBER01')
  check('空白昵称不会显示成空白名', Boolean(blankMember) && blankMember.name.trim().length > 0, JSON.stringify(blankMember))
  check('空白昵称回退到 openid 尾号', blankMember?.name === '成员000123', JSON.stringify(blankMember))
  check('昵称里的双向/零宽字符被清掉', bidiMember?.name === '上传-Komorebi~喵', JSON.stringify(bidiMember))

  const chatState = (await call('/qq-free/state')).body
  check('问答写入对话记录', chatState.chatLog.some((entry) => entry.question.includes('你好') && entry.answer.length > 0))
  check('对话写入工作区文件', existsSync(join(dataRoot, 'qq-replies.md')) && readFileSync(join(dataRoot, 'qq-replies.md'), 'utf8').includes('你好'))

  const beforePlain = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-3', content: '路人消息', group_openid: GROUP, mentions: [] } })
  await sleep(80)
  check('普通群消息不回复', sent.length === beforePlain)

  const beforeBot = sent.length
  ws.emit({ op: 0, s: 6, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-BOT', content: 'Q群管家提醒', group_openid: GROUP, mentions: [], author: { member_openid: 'QGROUPBOT1', bot: true, member_role: 'member' } } })
  ws.emit({ op: 0, s: 7, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-ATALL', content: '<@all> 全体通知', group_openid: GROUP, mentions: [{ scope: 'all' }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } } })
  await sleep(150)
  check('屏蔽其他机器人和 @所有人 消息', sent.length === beforeBot)

  const beforeOtherBot = sent.length
  ws.emit({ op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-OTHERBOT', content: '<@OTHERBOT> 你好', group_openid: GROUP, mentions: [{ member_openid: 'OTHERBOT1', bot: true, is_you: false }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } } })
  await sleep(150)
  check('@其他机器人不回复', sent.length === beforeOtherBot)

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

  ws.emit({
    op: 0, s: 7, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERREQ1',
      union_openid: 'UNIONREQ1',
      join_request_id: 'JOINREQ999999',
      username: '申请人（再次申请）',
      apply_at: '2026-11-21T00:00:00+08:00',
      verify_info: { verify_message: '想交流', review_qa_list: [{ question: '问题', answer: '想交流' }] },
    },
  })
  await sleep(120)
  const dedupedJoin = (await call('/qq-free/state')).body.pendingJoins
  check('同一个 QQ 的入群申请只保留一条', dedupedJoin.filter((entry) => entry.memberOpenid === 'MEMBERREQ1').length === 1
    && dedupedJoin.find((entry) => entry.memberOpenid === 'MEMBERREQ1')?.joinRequestId === 'JOINREQ999999')

  result = await call('/qq-free/group-admin', 'POST', { action: 'list', groupOpenid: GROUP })
  check('拉取入群申请列表', result.status === 200 && result.body.list.length === 1 && result.body.list[0].member_openid === 'REQ2')
  check('未同意的申请不被自动删除', (await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ1'))

  const beforeDeny = sent.length
  ws.emit({
    op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-CMD0', content: '同意 申请人', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_role: 'member' } },
  })
  await sleep(100)
  check('非管理员命令被拒绝', sent.slice(beforeDeny).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-CMD0' && item.body?.content?.includes('只有群主、管理员或代管')))

  result = await call('/qq-free/group-managers', 'POST', { action: 'save', groupOpenid: GROUP, memberOpenid: 'DELEGATE1', name: '代管' })
  check('添加代管', result.status === 200 && result.body.state.groupManagers.some((entry) => entry.memberOpenid === 'DELEGATE1'))
  const beforeDelegate = sent.length
  ws.emit({
    op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-DELEGATE', content: '群信息', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'DELEGATE1', member_role: 'member' } },
  })
  await sleep(150)
  const delegateReply = sent.slice(beforeDelegate).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-DELEGATE')
  check('代管可获取群信息', Boolean(delegateReply) && delegateReply.body.content.includes('群 openid：') && delegateReply.body.content.includes(GROUP))
  await call('/qq-free/group-managers', 'POST', { action: 'remove', groupOpenid: GROUP, memberOpenid: 'DELEGATE1' })

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

  // 入群问答自动通过：答案一致直接同意，不一致继续人工
  result = await call('/qq-free/join-answer', 'POST', { action: 'save', groupOpenid: GROUP, enabled: true, question: '入群暗号是什么', answer: '芝麻开门' })
  check('保存入群问答', result.status === 200 && result.body.state.joinAnswers[GROUP]?.answer === '芝麻开门')
  const beforeAuto = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERAUTO1',
      join_request_id: 'JOINAUTO1',
      username: '答对的人',
      verify_info: { verify_message: ' 芝麻开门 ' },
    },
  })
  await sleep(250)
  const autoApproveCall = sent.slice(beforeAuto).find((item) => item.method === 'POST' && item.target.includes('/approval_join_request/MEMBERAUTO1'))
  check('答案一致自动通过入群申请', Boolean(autoApproveCall) && autoApproveCall.body?.op === 'approve' && autoApproveCall.body?.join_request_id === 'JOINAUTO1', JSON.stringify(autoApproveCall?.body))
  check('自动通过后不留待处理申请', !(await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERAUTO1'))
  check('自动通过记录操作人', (await call('/qq-free/state')).body.lastApproval?.operator === '自动验证')
  const beforeAutoQa = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERAUTO2',
      join_request_id: 'JOINAUTO2',
      username: '答对的人二',
      verify_info: { review_qa_list: [{ question: '暗号', answer: '芝麻 开门' }] },
    },
  })
  await sleep(250)
  check('问答列表答案也能自动通过', sent.slice(beforeAutoQa).some((item) => item.target.includes('/approval_join_request/MEMBERAUTO2')))
  const beforeAutoBad = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERBAD1',
      join_request_id: 'JOINBAD1',
      username: '答错的人',
      verify_info: { verify_message: '开错门' },
    },
  })
  await sleep(200)
  check('答案不一致仍转人工审批', !sent.slice(beforeAutoBad).some((item) => item.target.includes('/approval_join_request/MEMBERBAD1'))
    && (await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERBAD1'))
  await call('/qq-free/join-answer', 'POST', { action: 'save', groupOpenid: GROUP, enabled: false, question: '入群暗号是什么', answer: '芝麻开门' })
  const beforeAutoOff = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBEROFF1',
      join_request_id: 'JOINOFF1',
      username: '关闭后',
      verify_info: { verify_message: '芝麻开门' },
    },
  })
  await sleep(200)
  check('关闭自动通过后不再自动同意', !sent.slice(beforeAutoOff).some((item) => item.target.includes('/approval_join_request/MEMBEROFF1')))
  await call('/qq-free/group-admin', 'POST', { action: 'forget', groupOpenid: GROUP, memberOpenid: 'MEMBERBAD1' })
  await call('/qq-free/group-admin', 'POST', { action: 'forget', groupOpenid: GROUP, memberOpenid: 'MEMBEROFF1' })

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
      mentions: [{ bot: true, is_you: true }, { member_openid: 'TARGET123456', is_you: false }],
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
      mentions: [{ bot: true, is_you: true }, { member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN1', member_role: 'admin' },
    },
  })
  await sleep(150)
  const modKick = sent.filter((item) => item.target.includes('/batch_remove_members')).at(-1)
  check('群内 @成员 踢人', modKick?.body?.member_openids?.[0] === 'TARGET123456', JSON.stringify(modKick?.body))

  const beforeNoAt = sent.length
  ws.emit({
    op: 0, s: 12, t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'EV-MUTE-NOAT', content: '禁<@TARGET123456>', group_openid: GROUP,
      mentions: [{ member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN2', member_nickname: '操作员', member_role: 'admin' },
    },
  })
  await sleep(150)
  const noAtMute = sent.slice(beforeNoAt).find((item) => item.target.includes('/restrict_chat_setting'))
  const noAtReply = sent.slice(beforeNoAt).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-MUTE-NOAT')
  check('不 @ 机器人也能禁@成员并显示操作人', noAtMute?.body?.members?.[0]?.member_openid === 'TARGET123456' && noAtReply?.body?.content?.includes('操作人：操作员'), JSON.stringify(noAtReply?.body))

  ws.emit({
    op: 0, s: 12, t: 'GROUP_JOIN_REQUEST',
    d: { group_openid: GROUP, member_openid: 'MEMBERREQ2', join_request_id: 'JOINREQ654321', username: '另一位' },
  })
  await sleep(120)
  const replacedJoin = (await call('/qq-free/state')).body.pendingJoins
  check('新申请让旧申请作废，只保留一条', replacedJoin.length === 1 && replacedJoin[0].memberOpenid === 'MEMBERREQ2')
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

  // 自定义处罚次数：第几次禁言 / 第几次踢出
  result = await call('/qq-free/config', 'POST', { moderationMuteAfter: 1, moderationKickAfter: 3 })
  check('自定义违规次数保存成功', result.status === 200
    && result.body.state.moderation.muteAfter === 1
    && result.body.state.moderation.kickAfter === 3, JSON.stringify(result.body.state.moderation))
  const badThreshold = await call('/qq-free/config', 'POST', { moderationMuteAfter: 5, moderationKickAfter: 3 })
  check('踢出次数必须大于禁言次数', badThreshold.status === 400 && /大于/.test(String(badThreshold.body.error)), JSON.stringify(badThreshold.body))

  const emitBad2 = (id, content) => ws.emit({
    op: 0, s: 40 + Number(id.slice(-1)), t: 'GROUP_MESSAGE_CREATE',
    d: { id, content, group_openid: GROUP, mentions: [], author: { member_openid: 'BADUSER2', member_nickname: '二犯', member_role: 'member' } },
  })
  const kickedBad2 = () => sent.some((item) => item.method === 'POST' && item.target.includes('/batch_remove_members') && item.body?.member_openids?.includes('BADUSER2'))
  emitBad2('EV-BAD5', '又来坏词')
  await sleep(150)
  check('自定义第 1 次即禁言', sent.some((item) => item.method === 'POST' && item.target.includes('/restrict_chat_setting')
    && item.body?.members?.[0]?.member_openid === 'BADUSER2') && !kickedBad2())
  emitBad2('EV-BAD6', '继续坏词')
  await sleep(150)
  check('未到踢出次数时只禁言不踢', !kickedBad2())
  emitBad2('EV-BAD7', '第三次坏词')
  await sleep(150)
  check('达到自定义踢出次数后踢出', kickedBad2())

  await call('/qq-free/config', 'POST', { moderationMuteAfter: 0, moderationKickAfter: 2 })
  const emitBad3 = (id) => ws.emit({
    op: 0, s: 50 + Number(id.slice(-1)), t: 'GROUP_MESSAGE_CREATE',
    d: { id, content: '坏词三号', group_openid: GROUP, mentions: [], author: { member_openid: 'BADUSER3', member_nickname: '三犯', member_role: 'member' } },
  })
  const mutedBad3 = () => sent.some((item) => item.method === 'POST' && item.target.includes('/restrict_chat_setting') && item.body?.members?.[0]?.member_openid === 'BADUSER3')
  emitBad3('EV-BAD8')
  await sleep(150)
  check('禁言次数设为 0 时第 1 次只警告', !mutedBad3())
  emitBad3('EV-BAD9')
  await sleep(150)
  check('禁言关闭时达到踢出次数直接踢出', sent.some((item) => item.method === 'POST' && item.target.includes('/batch_remove_members') && item.body?.member_openids?.includes('BADUSER3')))
  await call('/qq-free/config', 'POST', { moderationMuteAfter: 2, moderationKickAfter: 3 })


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

  const beforeInfo = sent.length
  ws.emit({
    op: 0, s: 17, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-INFO', content: '<@TARGET123456> 获取信息', group_openid: GROUP, mentions: [{ bot: true, is_you: true }, { member_openid: 'TARGET123456', username: '目标' }], author: { member_openid: 'NORMALUSER1', member_role: 'admin' } },
  })
  await sleep(150)
  const infoReply = sent.slice(beforeInfo).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-INFO')
  check('@某人 获取信息显示 openid 和入群时间', Boolean(infoReply) && infoReply.body.content.includes('openid：TARGET123456') && infoReply.body.content.includes('入群时间'))

  const beforeInfoDenied = sent.length
  ws.emit({
    op: 0, s: 18, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-INFO-DENIED', content: '<@TARGET123456> 获取信息', group_openid: GROUP, mentions: [{ bot: true, is_you: true }, { member_openid: 'TARGET123456', username: '目标' }], author: { member_openid: 'NORMALUSER2', member_role: 'member' } },
  })
  await sleep(150)
  const deniedInfoReply = sent.slice(beforeInfoDenied).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-INFO-DENIED')
  check('普通成员不能获取成员信息', Boolean(deniedInfoReply) && deniedInfoReply.body.content.includes('只有群主、管理员或主人'))

  result = await call('/qq-free/announcements', 'POST', {
    action: 'save', name: '测试公告', groupOpenids: [GROUP], date: '', time: '09:00', text: '重要通知', enabled: true,
  })
  check('保存定时群公告', result.status === 200 && Array.isArray(result.body.state.announcements) && result.body.state.announcements.length === 1)
  const annId = result.body.state.announcements[0].id
  const beforeAnn = sent.length
  result = await call('/qq-free/announcements', 'POST', { action: 'run', id: annId })
  const annMessage = sent.slice(beforeAnn).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('定时公告 @所有人 发送', result.status === 200 && annMessage?.body?.msg_type === 2 && annMessage?.body?.markdown?.content.includes('<qqbot-at-everyone />'), JSON.stringify(annMessage?.body))
  result = await call('/qq-free/announcements', 'POST', { action: 'remove', id: annId })
  check('删除定时公告', result.status === 200 && result.body.state.announcements.length === 0)

  result = await call('/qq-free/group-blocks', 'POST', { action: 'save', groupOpenid: GROUP, all: true, features: [] })
  check('保存群全部屏蔽', result.status === 200 && result.body.state.groupBlocks.some((entry) => entry.groupOpenid === GROUP && entry.all === true))
  const beforeBlockAll = sent.length
  ws.emit({ op: 0, s: 18, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-BLOCKALL', content: '<@BOT> 你好', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } } })
  await sleep(150)
  check('群全部屏蔽后不回复', sent.length === beforeBlockAll)
  result = await call('/qq-free/group-blocks', 'POST', { action: 'remove', groupOpenid: GROUP })
  check('取消群屏蔽', result.status === 200 && !result.body.state.groupBlocks.some((entry) => entry.groupOpenid === GROUP))

  result = await call('/qq-free/feature-blocks', 'POST', { action: 'add', groupOpenid: GROUP, feature: 'chat' })
  check('添加按功能屏蔽', result.status === 200 && result.body.state.featureBlocks.some((entry) => entry.groupOpenid === GROUP && entry.feature === 'chat'))
  const beforeFeatureBlock = sent.length
  ws.emit({ op: 0, s: 20, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-FEATURE-BLOCK', content: '<@BOT> 你好', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } } })
  await sleep(150)
  check('指定群屏蔽 AI 聊天后不回复', sent.length === beforeFeatureBlock)
  await call('/qq-free/feature-blocks', 'POST', { action: 'remove', groupOpenid: GROUP, feature: 'chat' })

  ws.emit({ op: 0, s: 21, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-MEMBER-LEAVE', content: '要走了', group_openid: GROUP, mentions: [], author: { member_openid: 'LEAVER001', member_nickname: '离开的人', member_role: 'member' } } })
  await sleep(100)
  ws.emit({ op: 0, s: 22, t: 'GROUP_MEMBER_REMOVE', d: { group_openid: GROUP, member_openid: 'LEAVER001' } })
  await sleep(100)
  check('成员退群后从成员列表移除', !(await call('/qq-free/state')).body.members.some((entry) => entry.openid === 'LEAVER001'))

  result = await call('/qq-free/config', 'POST', { joinVerifyEnabled: true, joinVerifyGroups: [GROUP] })
  check('开启入群验证', result.status === 200 && result.body.state.joinVerify.enabled === true)
  const readVerifyCode = (memberOpenid) => JSON.parse(readFileSync(join(dataRoot, '.qq-free', 'state.json'), 'utf8'))
    .joinVerifications.find((entry) => entry.memberOpenid === memberOpenid)?.code ?? ''

  groupMuted = true
  const beforeMuted = sent.length
  ws.emit({ op: 0, s: 29, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'DEFER001', username: '禁言新人', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(150)
  const mutedNotice = sent.slice(beforeMuted).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && JSON.stringify(item.body).includes('检测到禁言'))
  check('全体禁言时提示禁言结束首次发言验证', Boolean(mutedNotice) && !sent.slice(beforeMuted).some((item) => item.target.includes('/files')))
  groupMuted = false
  await sleep(200)
  check('禁言结束未发言时不发验证码', !sent.slice(beforeMuted).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && JSON.stringify(item.body).includes('5 分钟')))
  ws.emit({ op: 0, s: 30, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-DEFER', content: '在吗', group_openid: GROUP, mentions: [], author: { member_openid: 'DEFER001', member_nickname: '禁言新人', member_role: 'member' } } })
  await sleep(200)
  const deferredRecall = sent.slice(beforeMuted).some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-DEFER'))
  const deferredChallenge = sent.slice(beforeMuted).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && JSON.stringify(item.body).includes('5 分钟') && JSON.stringify(item.body).includes('DEFER001'))
  check('禁言结束后第一条消息立即撤回并 @ 对方验证', Boolean(deferredRecall) && Boolean(deferredChallenge))
  await call('/qq-free/join-verify/cancel', 'POST', {})
  groupMuted = false

  const beforeVerify = sent.length
  ws.emit({ op: 0, s: 30, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY01', username: '新人一', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(200)
  const verifyMessage = sent.slice(beforeVerify).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.markdown?.content?.includes('验证码'))
  const verifyCode = readVerifyCode('VERIFY01')
  const verifyImage = sent.slice(beforeVerify).some((item) => item.target.includes('/files') && item.body?.file_type === 1)
  check('新成员收到 @ 和验证码图片', Boolean(verifyMessage) && verifyCode.length === 6 && verifyImage && verifyMessage.body.markdown.content.includes('qqbot-at-user id="VERIFY01"') && verifyMessage.body.markdown.content.includes('图片'))
  ws.emit({ op: 0, s: 31, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-VERIFY-OK', content: `<@BOT> ${verifyCode}`, group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'VERIFY01', member_role: 'member' } } })
  await sleep(150)
  const successReply = sent.slice(beforeVerify).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-VERIFY-OK')
  check('验证成功回复', successReply?.body?.content === '验证成功')
  check('验证码正确不踢人', !sent.slice(beforeVerify).some((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY01')))

  const beforeWrong = sent.length
  ws.emit({ op: 0, s: 32, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY02', username: '新人二', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(200)
  const verifyCode2 = readVerifyCode('VERIFY02')
  const wrongCode = verifyCode2 === '000000' ? '111111' : '000000'
  // 第 1 次：发无关消息 → 撤回 + 记一次失败，不踢
  ws.emit({ op: 0, s: 33, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-VERIFY-CHAT', content: '大家好', group_openid: GROUP, mentions: [], author: { member_openid: 'VERIFY02', member_role: 'member' } } })
  await sleep(200)
  const chatRecall = sent.slice(beforeWrong).some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-VERIFY-CHAT'))
  const chatWarnReply = sent.slice(beforeWrong).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-VERIFY-CHAT')
  const noKickYet = !sent.slice(beforeWrong).some((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY02'))
  check('未验证成员发无关消息立即撤回并警告', chatRecall && Boolean(chatWarnReply) && chatWarnReply.body.content.includes('已撤回消息') && noKickYet)
  // 第 2 次：验证码错误 → 撤回后踢出
  ws.emit({ op: 0, s: 34, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-VERIFY-BAD', content: `<@BOT> ${wrongCode}`, group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'VERIFY02', member_role: 'member' } } })
  await sleep(200)
  const badRecall = sent.slice(beforeWrong).some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-VERIFY-BAD'))
  const wrongReplyIndex = sent.findIndex((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-VERIFY-BAD')
  const wrongKickIndex = sent.findIndex((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY02'))
  check('验证失败两次后撤回并踢出', badRecall && wrongReplyIndex >= 0 && wrongKickIndex > wrongReplyIndex && sent[wrongReplyIndex]?.body?.content?.includes('验证失败 2 次'))

  const beforeCancel = sent.length
  ws.emit({ op: 0, s: 34, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY03', username: '新人三', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(150)
  result = await call('/qq-free/join-verify/cancel', 'POST', {})
  check('取消本次验证不踢人', result.status === 200 && result.body.cancelled >= 1 && !sent.slice(beforeCancel).some((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY03')))
  ws.emit({ op: 0, s: 35, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY04', username: '新人四', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(150)
  check('取消后下一位入群仍验证', sent.slice(beforeCancel).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.markdown?.content?.includes('qqbot-at-user id="VERIFY04"')))
  await call('/qq-free/join-verify/cancel', 'POST', {})
  await call('/qq-free/config', 'POST', { joinVerifyEnabled: false, joinVerifyGroups: [] })

  result = await call('/qq-free/config', 'POST', { fortuneEnabled: true, fortuneGroups: [GROUP], fortuneImageEnabled: false })
  check('开启今日运势', result.status === 200 && result.body.state.fortune.enabled === true)
  const beforeFortune = sent.length
  ws.emit({ op: 0, s: 36, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-FORTUNE', content: '今日运势', group_openid: GROUP, mentions: [], author: { member_openid: 'FORTUNE1', member_nickname: '运势员', member_role: 'member' } } })
  await sleep(150)
  const fortuneReply = sent.slice(beforeFortune).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-FORTUNE')
  check('无需 @ 即可抽今日运势', Boolean(fortuneReply) && JSON.stringify(fortuneReply.body).includes('今日运势'))
  ws.emit({ op: 0, s: 37, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-FORTUNE2', content: '今日运势', group_openid: GROUP, mentions: [], author: { member_openid: 'FORTUNE1', member_nickname: '运势员', member_role: 'member' } } })
  await sleep(150)
  const againFortuneReply = sent.slice(beforeFortune).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-FORTUNE2')
  check('同一天第二次返回上次运势', Boolean(againFortuneReply) && JSON.stringify(againFortuneReply.body).includes('已经抽过') && JSON.stringify(againFortuneReply.body).includes('上次运势'))
  check('今日运势保存在本地', (await call('/qq-free/state')).body.fortunes.some((entry) => entry.memberOpenid === 'FORTUNE1' && entry.date.length === 10))
  await call('/qq-free/config', 'POST', { fortuneEnabled: false, fortuneGroups: [] })

  result = await call('/qq-free/config', 'POST', {
    inactiveCleanupEnabled: true, inactiveCleanupGroups: [GROUP], inactiveCleanupTime: '03:00', inactiveCleanupDays: 1, inactiveCleanupMaxLevel: 1,
  })
  check('保存沉默清理设置', result.status === 200 && result.body.state.inactiveCleanup.enabled === true)
  result = await call('/qq-free/inactive-cleanup', 'POST', { action: 'run' })
  check('沉默清理立即检查不报错', result.status === 200 && Array.isArray(result.body.results))
  await call('/qq-free/config', 'POST', { inactiveCleanupEnabled: false, inactiveCleanupGroups: [] })
}

result = await call('/qq-free/channel', 'POST', { enabled: false, confirm: true })
check('停止通道', result.status === 200 && result.body.state.chat.state === 'stopped')

const remotePort = 37000 + (process.pid % 500)
result = await call('/qq-free/remote', 'POST', { enabled: true, port: remotePort, token: 'test12' })
check('启用远程网页', result.status === 200 && result.body.state.remote.running === true && result.body.state.remote.token === 'test12', result.body.error)
const fixedBase = 'https://unit-test.tail1234.ts.net'
result = await call('/qq-free/remote', 'POST', {
  enabled: true, port: remotePort, token: 'test12', publicBaseUrl: `${fixedBase}/`,
})
check('固定公网地址按 http(s) 保存并去掉末尾斜杠', result.status === 200 && result.body.state.remote.publicUrl === fixedBase, result.body.error)
const fixedLink = result.body.state.remote.publicUrls?.[0] ?? ''
check('主网页链接用固定地址', fixedLink === `${fixedBase}/?token=test12`, fixedLink)
const badBase = await call('/qq-free/remote', 'POST', { enabled: true, port: remotePort, token: 'test12', publicBaseUrl: 'not-a-url' })
check('非法公网地址被拒绝', badBase.status !== 200, JSON.stringify(badBase.body))
result = await call('/qq-free/remote', 'POST', { enabled: true, port: remotePort, token: 'test12', tunnelEnabled: true })
check('cloudflared 临时隧道已停用（外网只走 Funnel）', result.status === 200 && result.body.state.remote.tunnel.enabled === false, JSON.stringify(result.body.state.remote.tunnel))
await sleep(200)
const remoteBase = `http://127.0.0.1:${remotePort}`
const pageRes = await httpCall(`${remoteBase}/`)
check('远程网页可打开', pageRes.status === 200 && pageRes.text.includes('QQ 自由发言'))
const unauth = await httpCall(`${remoteBase}/api/state`)
check('远程接口拒绝无 token', unauth.status === 401)
const authRes = await httpCall(`${remoteBase}/api/state`, { headers: { authorization: 'Bearer test12' } })
const authBody = authRes.json()
check('远程接口 token 可用', authRes.status === 200 && authBody.ok === true && Array.isArray(authBody.targets))
const remoteSend = await httpCall(`${remoteBase}/api/send`, {
  method: 'POST',
  headers: { authorization: 'Bearer test12', 'content-type': 'application/json' },
  body: { targetId, text: '远程网页发送测试' },
})
check('远程网页可发言', remoteSend.status === 200 && remoteSend.json().ok === true)

result = await call('/qq-free/group-pages', 'POST', { action: 'save', groupOpenid: GROUP, say: false, expiresAt: '' })
const groupToken = result.body.state?.groupPages?.[0]?.token
check('生成分群网页', result.status === 200 && typeof groupToken === 'string' && groupToken.length === 6)
const groupPageUrl = result.body.state?.groupPages?.[0]?.url
check('分群网页链接是固定公网地址（不是相对路径）', groupPageUrl === `${fixedBase}/g/${groupToken}`, groupPageUrl)
const gpState = await httpCall(`${remoteBase}/gapi/state?token=${encodeURIComponent(groupToken)}`)
check('分群网页状态可读', gpState.status === 200 && gpState.json().permissions?.say === false)
const gpOverview = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('分群网页可读完整管理数据', gpOverview.status === 200 && gpOverview.json().ok === true && Array.isArray(gpOverview.json().features))
const gpPageHtml = await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)
check('分群网页有 @ 成员选择框和「获取信息」注意事项', gpPageHtml.status === 200 && gpPageHtml.text.includes('id="mention"') && gpPageHtml.text.includes('获取信息') && gpPageHtml.text.includes('刷新成员'))
check('网页用 no-cache 校验，升级后刷新即生效', gpPageHtml.headers['cache-control'] === 'no-cache', String(gpPageHtml.headers['cache-control']))
check('分群网页返回可 @ 的成员列表', (gpOverview.json().members || []).some((member) => member.openid === 'ASKER1' && String(member.name || '').length > 0), JSON.stringify((gpOverview.json().members || []).slice(0, 3)))

// 分群网页公告：面板/主网页发布 → 分群网页 overview 展示 → 停用/删除后消失
const paAdd = await call('/qq-free/page-announcements', 'POST', { action: 'add', text: '分群网页公告测试', mode: 'once', groups: [GROUP] })
check('发布分群网页公告', paAdd.status === 200 && paAdd.body.state.pageAnnouncements.length === 1 && paAdd.body.state.pageAnnouncements[0].mode === 'once')
check('分群网页页面有公告容器', (await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)).text.includes('id="announcements"'))

// 违禁词处罚次数：分群网页只显示，不能修改
check('分群网页展示处罚次数', (await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)).json().moderationPolicy?.muteAfter === 2
  && (await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)).json().moderationPolicy?.kickAfter === 3
  && (await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)).json().moderationPolicy?.muteMinutes === 5)
check('分群网页有处罚次数的只读展示位', (await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)).text.includes('id="modPolicy"'))
const gpModEdit = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'moderation-save', muteAfter: 1, kickAfter: 2 },
})
check('分群网页不能修改处罚次数', gpModEdit.status === 400 && /未知操作/.test(String(gpModEdit.json().error)), JSON.stringify(gpModEdit.json()))
const paOverview = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('分群网页能读到公告', (paOverview.json().pageAnnouncements || []).some((item) => item.text === '分群网页公告测试'))
const paOther = await call('/qq-free/page-announcements', 'POST', { action: 'add', text: '别的群的公告', mode: 'always', groups: ['OTHERGROUPOPENID1'] })
const paScoped = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('公告可以只投放到指定群', paOther.status === 200 && !(paScoped.json().pageAnnouncements || []).some((item) => item.text === '别的群的公告'))
const paToggle = await call('/qq-free/page-announcements', 'POST', { action: 'toggle', id: paAdd.body.entry.id, active: false })
const paAfterToggle = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('停用公告后分群网页不再显示', paToggle.status === 200 && !(paAfterToggle.json().pageAnnouncements || []).some((item) => item.text === '分群网页公告测试'))
const paRemoteAdd = await httpCall(`${remoteBase}/api/pageAnnouncements`, {
  method: 'POST', headers: { authorization: 'Bearer test12', 'content-type': 'application/json' },
  body: { action: 'add', text: '主网页发布的公告', mode: 'once', groups: [] },
})
check('主网页也能发布分群网页公告', paRemoteAdd.status === 200 && paRemoteAdd.json().ok === true)
const paAllGroups = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('不选群的公告在所有分群网页显示', (paAllGroups.json().pageAnnouncements || []).some((item) => item.text === '主网页发布的公告'))
await call('/qq-free/page-announcements', 'POST', { action: 'remove', id: paAdd.body.entry.id })
await call('/qq-free/page-announcements', 'POST', { action: 'remove', id: paOther.body.entry.id })
const paClean = await call('/qq-free/page-announcements', 'POST', { action: 'list' })
check('公告可删除', paClean.status === 200 && paClean.body.list.length === 1 && paClean.body.list[0].text === '主网页发布的公告')
await call('/qq-free/group-pages', 'POST', { action: 'save', groupOpenid: GROUP, say: false, joinApprove: false, memberManage: false, settings: false, expiresAt: '' })
const gpJoinDenied = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-approve', memberOpenid: 'MEMBERX1', approve: true },
})
const gpSettingDenied = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'save-blocks', features: [] },
})
check('分群审批/设置权限可关闭', gpJoinDenied.status === 403 && gpSettingDenied.status === 403)
const gpDenied = await httpCall(`${remoteBase}/gapi/say?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: '越权发言' },
})
check('分群无发言权限提示你无权限', gpDenied.status === 403 && gpDenied.json().error === '你无权限')
await call('/qq-free/group-pages', 'POST', { action: 'save', groupOpenid: GROUP, say: true, expiresAt: '' })
const gpAllowed = await httpCall(`${remoteBase}/gapi/say?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: '分群网页发言测试' },
})
check('分群有权限可发言', gpAllowed.status === 200 || String(gpAllowed.json().error ?? '').includes('上限'))
await call('/qq-free/config', 'POST', { dailyLimit: 0 })
const gpMention = await httpCall(`${remoteBase}/gapi/say?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: '分群网页 @ 成员测试', mention: 'MENTIONASKER1' },
})
const gpMentionFrame = sent.filter((item) => item.method === 'POST'
  && item.target.endsWith(`/v2/groups/${GROUP}/messages`)
  && String(item.body?.markdown?.content ?? '').includes('分群网页 @ 成员测试')).at(-1)
check('分群网页可 @ 指定成员', gpMention.status === 200 && String(gpMentionFrame?.body?.markdown?.content ?? '').includes('<qqbot-at-user id="MENTIONASKER1"/>'), `${gpMention.status} ${JSON.stringify(gpMention.json())}`)
const gpBadMention = await httpCall(`${remoteBase}/gapi/say?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { text: '越权 @', mention: '12345' },
})
check('分群网页 @ 成员 openid 不合法会报错', gpBadMention.status === 400 && /openid/.test(String(gpBadMention.json().error ?? '')), JSON.stringify(gpBadMention.json()))

// 分群网页发送图片
const tinyPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
check('分群网页有发送图片控件', (await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)).text.includes('id="mediaFile"'))
const beforeImage = sent.length
const gpImage = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: { action: 'media', type: 1, data: tinyPng, fileName: 'test.png' },
})
check('分群网页可发送图片', gpImage.status === 200
  && sent.slice(beforeImage).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/files`) && item.body?.file_type === 1), JSON.stringify(gpImage.json()))
const beforeImageCaption = sent.length
const gpImageCaption = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: { action: 'media', type: 1, data: tinyPng, fileName: 'cap.png', caption: '看图', mention: 'MENTIONASKER1' },
})
const captionFrame = sent.slice(beforeImageCaption).find((item) => item.method === 'POST'
  && item.target.endsWith(`/v2/groups/${GROUP}/messages`)
  && String(item.body?.markdown?.content ?? '').includes('看图'))
check('图片说明可以 @ 成员', gpImageCaption.status === 200
  && String(captionFrame?.body?.markdown?.content ?? '').includes('<qqbot-at-user id="MENTIONASKER1"/>'), JSON.stringify(captionFrame?.body))
const gpBadMediaMention = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: { action: 'media', type: 1, data: tinyPng, fileName: 'bad.png', mention: '123' },
})
check('发送图片时 @ 成员 openid 非法会报错', gpBadMediaMention.status === 400 && /openid/.test(String(gpBadMediaMention.json().error ?? '')))
await call('/qq-free/config', 'POST', { dailyLimit: 10 })
const mainStill = await httpCall(`${remoteBase}/api/state`, { headers: { authorization: 'Bearer test12' } })
check('主网页不受分群权限限制', mainStill.status === 200)
const gpChatBlock = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'save-blocks', all: false, features: ['chat'] },
})
const gpChatOverview = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('分群网页关闭功能立即生效', gpChatBlock.status === 200 && !gpChatBlock.json().request
  && (gpChatOverview.json().blocks?.features || []).includes('chat'))
const gpChatEnable = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'save-blocks', all: false, features: [] },
})
const gpChatAfterEnable = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('分群网页打开功能只生成申请', Boolean(gpChatEnable.json().request)
  && (gpChatAfterEnable.json().blocks?.features || []).includes('chat'))
check('申请里记录要打开的功能', (gpChatEnable.json().request.payload.unblock || []).includes('chat'))
check('分群网页能读到自己的待同意申请', (gpChatAfterEnable.json().pendingRequests || []).some((item) => item.kind === 'features'))
const chatApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpChatEnable.json().request.id })
check('同意申请后 AI 聊天重新打开', chatApprove.status === 200
  && !chatApprove.body.state.groupBlocks.some((item) => item.groupOpenid === GROUP && (item.features || []).includes('chat')))

// 新群默认「全部屏蔽」：分群网页应看到全部关闭，任何开启都要申请
await call('/qq-free/group-blocks', 'POST', { action: 'save', groupOpenid: GROUP, all: true, features: [] })
const gpAllBlocked = await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)
check('分群网页读到全部屏蔽', gpAllBlocked.json().blocks?.all === true)
check('分群网页有全部屏蔽说明位', (await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)).text.includes('id="allBlockedHint"'))
const gpAllFeatures = gpAllBlocked.json().features || []
const gpEnableAll = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'save-blocks', all: false, features: [] },
})
check('取消全部屏蔽只生成申请', Boolean(gpEnableAll.json().request)
  && (gpEnableAll.json().request.payload.unblock || []).length === gpAllFeatures.length)
const gpEnableOne = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' },
  body: { action: 'save-blocks', all: false, features: gpAllFeatures.filter((key) => key !== 'chat') },
})
check('全部屏蔽时打开单个功能也要申请', Boolean(gpEnableOne.json().request)
  && (gpEnableOne.json().request.payload.unblock || []).includes('chat'))
const gpBlockedVerify = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-verify-save', enabled: true },
})
check('全部屏蔽时不能直接打开人机验证', gpBlockedVerify.status === 400 && /全部功能/.test(String(gpBlockedVerify.json().error ?? '')))
const gpEnableOneApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpEnableOne.json().request.id })
check('同意后只打开申请里的功能', gpEnableOneApprove.status === 200
  && !gpEnableOneApprove.body.state.groupBlocks.some((item) => item.groupOpenid === GROUP && (item.features || []).includes('chat'))
  && gpEnableOneApprove.body.state.groupBlocks.some((item) => item.groupOpenid === GROUP && item.all !== true && (item.features || []).includes('auto')))
await call('/qq-free/group-blocks', 'POST', { action: 'save', groupOpenid: GROUP, all: false, features: [] })

// 人机验证：打开要申请，关闭立即生效
const gpVerifyReq = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-verify-save', enabled: true },
})
const beforeApprove = await call('/qq-free/state')
check('分群网页开启人机验证只生成申请', gpVerifyReq.status === 200 && Boolean(gpVerifyReq.json().request)
  && !(beforeApprove.body.joinVerify.groups || []).includes(GROUP))
const verifyApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpVerifyReq.json().request.id })
check('同意后本群生效人机验证', verifyApprove.status === 200 && (verifyApprove.body.state.joinVerify.groups || []).includes(GROUP))
const verifyDisable = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-verify-save', enabled: false },
})
check('分群网页关闭人机验证立即生效', verifyDisable.status === 200 && !verifyDisable.json().request
  && !((await call('/qq-free/state')).body.joinVerify.groups || []).includes(GROUP))

// 代管：添加要申请，移除立即生效
const gpManagerReq = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'manager-add', memberOpenid: 'MANAGER00001', name: '代管甲' },
})
check('分群网页添加代管只生成申请', gpManagerReq.status === 200 && gpManagerReq.json().request?.kind === 'manager'
  && !((await call('/qq-free/state')).body.groupManagers || []).some((item) => item.memberOpenid === 'MANAGER00001'))
const managerApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpManagerReq.json().request.id })
check('同意后代管生效', managerApprove.status === 200
  && (managerApprove.body.state.groupManagers || []).some((item) => item.memberOpenid === 'MANAGER00001'))
const managerRemove = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'manager-remove', memberOpenid: 'MANAGER00001' },
})
check('分群网页移除代管立即生效', managerRemove.status === 200 && !managerRemove.json().request
  && !((await call('/qq-free/state')).body.groupManagers || []).some((item) => item.memberOpenid === 'MANAGER00001'))

// 每个群独立的入群欢迎
const welcomeA = await call('/qq-free/welcome-group', 'POST', { action: 'save', groupOpenid: GROUP, enabled: true, text: 'A 群专属欢迎' })
check('保存本群欢迎', welcomeA.status === 200 && welcomeA.body.welcome.text === 'A 群专属欢迎')
await call('/qq-free/welcome-group', 'POST', { action: 'save', groupOpenid: 'OTHERGROUPOPENID1', enabled: true, text: 'B 群专属欢迎' })
const welcomes = (await call('/qq-free/state')).body.welcome.perGroup
check('两个群欢迎互不影响', welcomes[GROUP]?.text === 'A 群专属欢迎' && welcomes.OTHERGROUPOPENID1?.text === 'B 群专属欢迎', JSON.stringify(welcomes))
check('分群网页读到本群欢迎', (await httpCall(`${remoteBase}/gapi/overview?token=${encodeURIComponent(groupToken)}`)).json().welcome?.text === 'A 群专属欢迎')
const gpWelcomeEdit = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'welcome-save', enabled: true, text: '分群网页改的欢迎' },
})
check('分群网页可直接改本群欢迎（无需申请）', gpWelcomeEdit.status === 200 && gpWelcomeEdit.json().welcome?.text === '分群网页改的欢迎')
const beforeWelcome = sent.length
ws.emit({ op: 0, s: 77, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'WELCOMEMEMBER1' } })
await sleep(150)
const welcomeFrame = sent.slice(beforeWelcome).find((item) => item.method === 'POST'
  && item.target.endsWith(`/v2/groups/${GROUP}/messages`)
  && String(item.body?.content ?? '').includes('分群网页改的欢迎'))
check('入群欢迎用本群文案发送', Boolean(welcomeFrame), JSON.stringify(sent.slice(beforeWelcome).map((item) => item.body?.content)))

// 入群欢迎：关闭立即生效，打开要申请
const gpWelcomeOff = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'welcome-save', enabled: false, text: '先关掉' },
})
check('分群网页关闭本群欢迎立即生效', gpWelcomeOff.status === 200 && !gpWelcomeOff.json().request && gpWelcomeOff.json().welcome?.enabled === false)
const gpWelcomeOn = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'welcome-save', enabled: true, text: '申请打开的欢迎' },
})
check('分群网页打开本群欢迎需要申请', Boolean(gpWelcomeOn.json().request) && gpWelcomeOn.json().request.kind === 'welcome')
const welcomeApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpWelcomeOn.json().request.id })
check('同意后本群欢迎打开', welcomeApprove.status === 200 && welcomeApprove.body.state.welcome.perGroup[GROUP]?.enabled === true)

// 入群问答自动通过：分群网页打开要申请，关闭立即生效；主网页可直接保存
const gpJaReq = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-answer-save', enabled: true, question: '暗号是', answer: '开门' },
})
check('分群网页打开入群问答只生成申请', Boolean(gpJaReq.json().request) && gpJaReq.json().request.kind === 'joinAnswer'
  && gpJaReq.json().request.payload.answer === '开门')
const jaApprove = await call('/qq-free/group-requests', 'POST', { action: 'approve', id: gpJaReq.json().request.id })
check('同意后本群入群问答生效', jaApprove.status === 200
  && jaApprove.body.state.joinAnswers[GROUP]?.enabled === true
  && jaApprove.body.state.joinAnswers[GROUP]?.answer === '开门')
const gpJaOff = await httpCall(`${remoteBase}/gapi/action?token=${encodeURIComponent(groupToken)}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: { action: 'join-answer-save', enabled: false, question: '暗号是', answer: '开门' },
})
check('分群网页关闭入群问答立即生效', !gpJaOff.json().request && ((await call('/qq-free/state')).body.joinAnswers[GROUP] || {}).enabled === false)
const jaRemote = await httpCall(`${remoteBase}/api/joinAnswer`, {
  method: 'POST', headers: { authorization: 'Bearer test12', 'content-type': 'application/json' },
  body: { action: 'save', groupOpenid: GROUP, enabled: false, question: '改一下', answer: '新答案' },
})
check('主网页可保存入群问答', jaRemote.status === 200 && jaRemote.json().joinAnswer?.answer === '新答案')
await call('/qq-free/group-pages', 'POST', { action: 'save', groupOpenid: GROUP, say: true, expiresAt: '2020-01-01T00:00:00.000Z' })
const gpExpired = await httpCall(`${remoteBase}/g/${encodeURIComponent(groupToken)}`)
check('分群网页过期', gpExpired.status === 410)
await call('/qq-free/group-pages', 'POST', { action: 'remove', groupOpenid: GROUP })
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
