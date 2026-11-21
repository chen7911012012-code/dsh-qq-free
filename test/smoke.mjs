/**
 * 鏈湴鍐掔儫娴嬭瘯锛氱敤鍋囩殑 ctx / webServer / fetch / WebSocket 璺戜竴閬嶆彃浠堕€昏緫銆? * 杩愯锛歯ode test/smoke.mjs
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
    console.log(`  FAIL ${name}${detail ? ` 鈥?${detail}` : ''}`)
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
        yield { type: 'finish', reason: { kind: 'error', failure: { code: 'AUTH', message: '妯℃嫙閴存潈澶辫触' } } }
        return
      }
      const promptText = (options?.messages ?? [])
        .flatMap((message) => message.content ?? [])
        .map((part) => part.text ?? '')
        .join('\n')
      const isClassifier = String(options?.system ?? '').includes('鎰忓浘鍒嗙被鍣?)
      const pieces = isClassifier
        ? [promptText.includes('浣犲ソ') ? 'QUESTION' : 'CHAT']
        : ['浠婂ぉ', '涔熸槸', '鎽搁奔鐨勪竴澶?]
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
      return new Response(JSON.stringify({ username: '鐢宠浜?, avatar: 'https://example.com/avatar.png', allow_proactive_msg: true }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && target.endsWith('/files')) {
      return new Response(JSON.stringify({ file_uuid: 'f1', file_info: 'F1', ttl: 300, id: 'IMG-1' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'GET' && target.includes('/join_request_list')) {
      return new Response(JSON.stringify({
        list: [{ join_request_id: 'J2', member_openid: 'REQ2', username: '鍙︿竴涓汉', apply_at: '2026-11-20T09:00:00+08:00', risk_tips: '' }],
        next_cursor: '',
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'GET' && target.includes('/restrict_chat_setting')) {
      return new Response(JSON.stringify({ global_rule: { mode: 'none' }, members: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (method === 'POST' && target.includes('/batch_remove_members')) {
      return new Response(JSON.stringify({ remove_members_result: 'success' }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    if (body && typeof body.content === 'string' && body.content.includes('瑙﹀彂閰嶉')) {
      return new Response(JSON.stringify({ code: 11244, message: '涓诲姩娑堟伅鏁伴噺宸茶揪涓婇檺' }), { status: 400, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ id: `MSG-${sent.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new Response('not found', { status: 404 })
}

function call(path, method = 'GET', body) {
  const handler = routes.get(path)
  if (handler === undefined) throw new Error(`璺敱鏈敞鍐岋細${path}`)
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
          reject(new Error(`鍝嶅簲涓嶆槸 JSON锛?{text.slice(0, 120)}`))
        }
      },
    }
    Promise.resolve(handler(req, res)).catch(reject)
  })
}

const module = await import('../index.js')
check('妯″潡瀵煎嚭 apply', typeof module.apply === 'function')
await module.apply(ctx, {
  appId: '',
  appSecret: '',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  dailyLimit: 2,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
})
check('娉ㄥ唽浜?25 鏉?HTTP 璺敱', routes.size === 25, [...routes.keys()].join(', '))
check('娉ㄥ唽浜?3 涓伐鍏?, tools.length === 3)
const qaGuidance = sections.find((section) => section.name === 'qq-free:qa-guidance')
const qaLibrary = sections.find((section) => section.name === 'qq-free:qa-library')
check('娉ㄥ唽浜嗛棶绛旀彁绀鸿瘝', typeof qaGuidance?.text === 'string' && qaGuidance.text.includes('qq_qa_lookup'))
check('娉ㄥ唽浜嗗姩鎬侀棶绛斿簱鎻愮ず', typeof qaLibrary?.text === 'function' && qaLibrary.text({}) === '')

let result = await call('/qq-free/state')
check('鍒濆鐘舵€佸彲璇?, result.status === 200 && result.body.ok === true)
check('鍒濆鍑嵁鏈厤缃?, result.body.credential.configured === false)

result = await call('/qq-free/config', 'POST', {
  appId: '102757755',
  appSecret: 'secret-for-test',
  persona: '娴嬭瘯浜鸿',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
})
check('淇濆瓨閰嶇疆鎴愬姛', result.status === 200 && result.body.ok === true)
check('閰嶇疆宸插啓鍏?config.json', existsSync(join(dataRoot, '.qq-free', 'config.json')))
check('config.json 鍚?appSecret', readFileSync(join(dataRoot, '.qq-free', 'config.json'), 'utf8').includes('secret-for-test'))

result = await call('/qq-free/config', 'POST', { replyLogFile: join(dataRoot, 'qq-replies.md') })
check('璁剧疆鍥炲鏃ュ織璺緞', result.status === 200)

result = await call('/qq-free/cloud', 'POST', {
  action: 'save', enabled: false, url: 'https://example.com/dav', user: 'tester', password: 'secret', auto: true,
})
check('淇濆瓨 WebDAV 浜戠鍚屾閰嶇疆', result.status === 200 && result.body.state.cloud.user === 'tester' && result.body.state.cloud.hasPassword === true)

result = await call('/qq-free/github', 'POST', {
  action: 'save', enabled: false, owner: 'chen7911012012-code', repo: 'dsh-qq-free', token: 'test-token', auto: true,
})
check('淇濆瓨 GitHub 鐩磋繛閰嶇疆', result.status === 200 && result.body.state.github.owner === 'chen7911012012-code' && result.body.state.github.hasToken === true)

result = await call('/qq-free/targets', 'POST', { action: 'add', scope: 'group', openid: 'TESTGROUPOPENID12345', name: '娴嬭瘯缇? })
check('娣诲姞鐩爣鎴愬姛', result.status === 200)
const targetId = result.body.target.id
result = await call('/qq-free/targets', 'POST', { action: 'add', scope: 'group', openid: 'TESTGROUPOPENID22222', name: '娴嬭瘯缇?' })
const target2Id = result.body.target.id
check('娣诲姞绗簩涓洰鏍?, result.status === 200)

result = await call('/qq-free/generate', 'POST', { topic: '鍛ㄦ湯', send: true })
check('DeepSeek 鐢熸垚骞跺彂閫?, result.status === 200 && result.body.sent === true)
check('鍙戦€佽姹傚甫閴存潈', sent[0]?.authorization === 'QQBot TOKEN')
check('涓诲姩娑堟伅涓嶅甫 msg_id', sent[0] && !('msg_id' in sent[0].body))

result = await call('/qq-free/send', 'POST', { targetId, text: '绗簩鏉? })
check('绗簩鏉″彂閫佹垚鍔?, result.status === 200)
result = await call('/qq-free/send', 'POST', { targetId, text: '绗笁鏉? })
check('姣忔棩閰嶉鐢熸晥', result.status === 400 && /涓婇檺/.test(result.body.error))

result = await call('/qq-free/config', 'POST', { dailyLimit: 10 })
check('璋冮珮姣忔棩閰嶉', result.status === 200 && result.body.state.limits.dailyLimit === 10)

result = await call('/qq-free/boards', 'POST', { action: 'add', name: '娴嬭瘯鏉垮潡', targetIds: [targetId, target2Id] })
check('娣诲姞缇ゆ澘鍧?, result.status === 200 && result.body.board.targetIds.length === 2)
const boardId = result.body.board.id
result = await call('/qq-free/send', 'POST', { targetId: boardId, text: '鏉垮潡缇ゅ彂娴嬭瘯' })
check('鏉垮潡涓€娆″彂鍒板涓兢', result.status === 200 && Array.isArray(result.body.results) && result.body.results.length === 2)
result = await call('/qq-free/send', 'POST', { targetId, text: '甯鐨勫彂瑷€', mention: 'MENTION123456' })
const mentionCall = sent.filter((item) => item.target.endsWith('/messages')).at(-1)
check('鑷敱鍙戣█鍙?@ 缇ゆ垚鍛?, result.status === 200 && mentionCall?.body?.msg_type === 2 && mentionCall?.body?.markdown?.content.includes('<qqbot-at-user id="MENTION123456"/>'), JSON.stringify(mentionCall?.body))

const mediaUploadsBefore = sent.length
result = await call('/qq-free/send-media', 'POST', { targetId, type: 1, url: 'https://example.com/sticker.gif' })
const mediaUpload = sent.slice(mediaUploadsBefore).find((item) => item.target.endsWith('/files'))
const mediaMessage = sent.slice(mediaUploadsBefore).find((item) => item.target.endsWith('/messages') && item.body?.msg_type === 7)
check('鍙戦€佸獟浣擄紙鍥剧墖/琛ㄦ儏鍖咃級', result.status === 200 && mediaUpload?.body?.url === 'https://example.com/sticker.gif' && Boolean(mediaMessage?.body?.media?.file_info), result.body.error)

result = await call('/qq-free/send-media', 'POST', {
  targetId, type: 1, fileName: 'local.png', data: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
})
const localUpload = sent.filter((item) => item.target.endsWith('/files')).at(-1)
check('鍙戦€佹湰鍦伴€夊彇鐨勫浘鐗?, result.status === 200 && localUpload?.body?.file_name === 'local.png' && typeof localUpload?.body?.file_data === 'string' && localUpload.body.file_data.length > 20, JSON.stringify(result.body.error))

result = await call('/qq-free/send-media', 'POST', {
  targetId, type: 4, fileName: 'big.bin', data: 'data:application/octet-stream;base64,' + 'A'.repeat(200000),
})
check('澶ф枃浠惰姹備綋鍙笂浼狅紙>64KB锛?, result.status === 200, result.body.error)

result = await call('/qq-free/qa', 'POST', { action: 'add', question: '缇よ鏄粈涔?, answer: '涓嶈鍙戝箍鍛?, keywords: '缇よ' })
check('娣诲姞闂瓟鎴愬姛', result.status === 200)
result = await call('/qq-free/qa', 'POST', { action: 'add', question: '缇よ鏄粈涔?, answer: '涓嶈鍙戝箍鍛婏紙鏇存柊锛?, keywords: '缇よ' })
check('閲嶅闂鍙洿鏂颁笉鏂板', result.status === 200 && result.body.updated === true && (await call('/qq-free/qa')).body.entries.filter((entry) => entry.question === '缇よ鏄粈涔?).length === 1)
check('闂瓟搴撹繘鍏ョ郴缁熸彁绀?, qaLibrary.text({}).includes('缇よ鏄粈涔?))
const qaId = result.body.entry.id
result = await call('/qq-free/qa/lookup', 'POST', { question: '杩欎釜缇ょ殑缇よ鏄粈涔? })
check('闂瓟搴撳懡涓?, result.status === 200 && result.body.matched === true)
result = await call('/qq-free/qa/lookup', 'POST', { question: '浠婂ぉ鏅氶キ鍚冧粈涔?, fallback: true })
check('鏈懡涓洖閫€ DeepSeek', result.status === 200 && result.body.source === 'deepseek')
result = await call('/qq-free/qa', 'POST', { action: 'remove', id: qaId })
check('鍒犻櫎闂瓟鎴愬姛', result.status === 200 && result.body.stats.count === 0)

// 鈹€鈹€ AI 瀵硅瘽閫氶亾 鈹€鈹€
result = await call('/qq-free/channel', 'POST', { enabled: true })
check('鍚敤鍓嶈姹傜‘璁?, result.status === 409 && result.body.requiresConfirm === true)
result = await call('/qq-free/channel', 'POST', { enabled: true, confirm: true })
check('鍚敤閫氶亾', result.status === 200 && result.body.state.chat.enabled === true)
await sleep(120)
const ws = MockWebSocket.instances.at(-1)
check('寤虹珛缃戝叧杩炴帴', Boolean(ws) && ws.url === 'ws://mock-gateway')

if (ws) {
  ws.emit({ op: 10, d: { heartbeat_interval: 45000 } })
  await sleep(10)
  const identify = ws.sent.find((frame) => frame.op === 2)
  check('鍙戦€?Identify', identify?.d?.token === 'QQBot TOKEN')
  check('璁㈤槄缇ゆ垚鍛樹笌娑堟伅浜嬩欢', identify?.d?.intents === ((1 << 24) | (1 << 25)), String(identify?.d?.intents))
  ws.emit({ op: 0, s: 1, t: 'READY', d: { session_id: 'S1' } })
  check('READY 鍚庡凡杩炴帴', (await call('/qq-free/state')).body.chat.state === 'connected')

  const beforeC2C = sent.length
  ws.emit({ op: 0, s: 2, t: 'C2C_MESSAGE_CREATE', d: { id: 'EV-1', content: '浣犲ソ', author: { user_openid: 'USER1' } } })
  await sleep(150)
  check('绉佽亰鑷姩鍥炲', sent.slice(beforeC2C).some((item) => item.target.endsWith('/v2/users/USER1/messages') && item.body?.msg_id === 'EV-1'))

  const beforeDup = sent.length
  ws.emit({ op: 0, s: 3, t: 'C2C_MESSAGE_CREATE', d: { id: 'EV-1', content: '浣犲ソ', author: { user_openid: 'USER1' } } })
  await sleep(80)
  check('閲嶅浜嬩欢鍘婚噸', sent.length === beforeDup)

  result = await call('/qq-free/qa', 'POST', { action: 'add', question: '浣犲ソ', answer: '搴撶瓟妗堜笉搴斿嚭鐜? })
  check('鍔犲叆鍚屽悕闂瓟鐢ㄤ簬楠岃瘉寮哄埗 DeepSeek', result.status === 200)
  const beforeGroup = sent.length
  ws.emit({ op: 0, s: 4, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-2', content: '<@BOT> 浣犲ソ', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'ASKER1', member_role: 'member' } } })
  await sleep(150)
  const groupReply = sent.slice(beforeGroup).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-2')
  check('缇?@ 鑷姩鍥炲', Boolean(groupReply))
  check('缇ゅ洖澶嶇敤 Markdown @ 鎻愰棶浜?, groupReply?.body?.msg_type === 2 && groupReply.body.markdown.content.includes('<qqbot-at-user id="ASKER1"/>'), JSON.stringify(groupReply?.body))
  check('闂瓟搴撳懡涓椂浼樺厛浣跨敤搴撶瓟妗?, Boolean(groupReply) && groupReply.body.markdown.content.includes('搴撶瓟妗?) && !groupReply.body.markdown.content.includes('鎽搁奔'), JSON.stringify(groupReply?.body))
  check('闂瓟搴撳懡涓褰?source=library', (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '浣犲ソ' && entry.source === 'library'))

  ws.emit({ op: 0, s: 6, t: 'GROUP_ADD_ROBOT', d: { group_openid: 'NEWGROUPOPENID99999', group_name: '鏂扮兢' } })
  await sleep(120)
  check('鏈哄櫒浜鸿鎷夎繘鏂扮兢鍚庤嚜鍔ㄥ嚭鐜板湪鐩爣閲?, (await call('/qq-free/state')).body.targets.some((target) => target.openid === 'NEWGROUPOPENID99999'))

  const beforeChat = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-CHAT', content: '<@BOT> 浠婂ぉ濂界疮', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'ASKER1', member_role: 'member' } } })
  await sleep(180)
  const chatReply = sent.slice(beforeChat).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-CHAT')
  check('闂茶亰鐢ㄦ櫤鑳戒綋浜鸿鍥炲', Boolean(chatReply) && (await call('/qq-free/state')).body.chatLog.some((entry) => entry.question === '浠婂ぉ濂界疮' && entry.source === 'agent'))
  check('璁板綍缇ゆ垚鍛樼洰褰?, (await call('/qq-free/state')).body.members.some((member) => member.openid === 'ASKER1'))
  const chatState = (await call('/qq-free/state')).body
  check('闂瓟鍐欏叆瀵硅瘽璁板綍', chatState.chatLog.some((entry) => entry.question.includes('浣犲ソ') && entry.answer.length > 0))
  check('瀵硅瘽鍐欏叆宸ヤ綔鍖烘枃浠?, existsSync(join(dataRoot, 'qq-replies.md')) && readFileSync(join(dataRoot, 'qq-replies.md'), 'utf8').includes('浣犲ソ'))

  const beforePlain = sent.length
  ws.emit({ op: 0, s: 5, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-3', content: '璺汉娑堟伅', group_openid: GROUP, mentions: [] } })
  await sleep(80)
  check('鏅€氱兢娑堟伅涓嶅洖澶?, sent.length === beforePlain)

  result = await call('/qq-free/config', 'POST', { welcomeEnabled: true, welcomeText: '娆㈣繋 {member_openid}', welcomeGroups: [GROUP] })
  check('淇濆瓨鍏ョ兢娆㈣繋', result.status === 200 && result.body.state.welcome.enabled === true)
  const beforeWelcome = sent.length
  ws.emit({ op: 0, s: 6, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'NEW1' } })
  await sleep(150)
  const welcome = sent.slice(beforeWelcome).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('鍏ョ兢娆㈣繋宸插彂閫?, welcome?.body?.content === '娆㈣繋 NEW1' && !('msg_id' in welcome.body))

  const beforeJoin = sent.length
  ws.emit({
    op: 0, s: 7, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERREQ1',
      union_openid: 'UNIONREQ1',
      join_request_id: 'JOINREQ123456',
      username: '鐢宠浜?,
      apply_at: '2026-11-20T09:00:00+08:00',
      verify_info: { method: 'admin_review_qa', review_qa_list: [{ question: '浣犱负浠€涔堝姞缇?, answer: '鎯充氦娴? }] },
    },
  })
  await sleep(200)
  const joinCalls = sent.slice(beforeJoin)
  const avatarUpload = joinCalls.find((item) => item.target.endsWith(`/v2/groups/${GROUP}/files`))
  const joinNotice = joinCalls.find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('鐢宠澶村儚宸蹭笂浼?, Boolean(avatarUpload) && avatarUpload.body.url === 'https://example.com/avatar.png' && avatarUpload.body.srv_send_msg === true, JSON.stringify(avatarUpload?.body))
  check('鍏ョ兢鐢宠閫氱煡宸插彂鍒板搴旂兢', Boolean(joinNotice) && joinNotice.body.content.includes('鐢宠浜?), JSON.stringify(joinNotice?.body))
  check('閫氱煡鍚敵璇锋椂闂翠笌楠岃瘉绛旀', Boolean(joinNotice) && joinNotice.body.content.includes('鐢宠鏃堕棿') && joinNotice.body.content.includes('鍥炵瓟锛氭兂浜ゆ祦'), JSON.stringify(joinNotice?.body))
  check('閫氱煡鍙樉绀烘垚鍛?openid锛屼笉鏄剧ず缇?openid', Boolean(joinNotice) && joinNotice.body.content.includes('鎴愬憳 openid锛?) && !joinNotice.body.content.includes('缇?openid锛?), JSON.stringify(joinNotice?.body))
  check('閫氱煡涓嶅啀鍑虹幇 <@...> 鎴栫敵璇峰彿', Boolean(joinNotice) && !joinNotice.body.content.includes('<@') && !joinNotice.body.content.includes('鐢宠鍙?), JSON.stringify(joinNotice?.body))
  check('鍏ョ兢鐢宠宸茶褰?, (await call('/qq-free/state')).body.pendingJoins.length === 1)

  ws.emit({
    op: 0, s: 7, t: 'GROUP_JOIN_REQUEST',
    d: {
      group_openid: GROUP,
      member_openid: 'MEMBERREQ1',
      union_openid: 'UNIONREQ1',
      join_request_id: 'JOINREQ999999',
      username: '鐢宠浜猴紙鍐嶆鐢宠锛?,
      apply_at: '2026-11-21T00:00:00+08:00',
      verify_info: { verify_message: '鎯充氦娴?, review_qa_list: [{ question: '闂', answer: '鎯充氦娴? }] },
    },
  })
  await sleep(120)
  const dedupedJoin = (await call('/qq-free/state')).body.pendingJoins
  check('鍚屼竴涓?QQ 鐨勫叆缇ょ敵璇峰彧淇濈暀涓€鏉?, dedupedJoin.filter((entry) => entry.memberOpenid === 'MEMBERREQ1').length === 1
    && dedupedJoin.find((entry) => entry.memberOpenid === 'MEMBERREQ1')?.joinRequestId === 'JOINREQ999999')

  result = await call('/qq-free/group-admin', 'POST', { action: 'list', groupOpenid: GROUP })
  check('鎷夊彇鍏ョ兢鐢宠鍒楄〃', result.status === 200 && result.body.list.length === 1 && result.body.list[0].member_openid === 'REQ2')
  check('鏈悓鎰忕殑鐢宠涓嶈鑷姩鍒犻櫎', (await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ1'))

  const beforeDeny = sent.length
  ws.emit({
    op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-CMD0', content: '鍚屾剰 鐢宠浜?, group_openid: GROUP, mentions: [], author: { member_role: 'member' } },
  })
  await sleep(100)
  check('闈炵鐞嗗憳鍛戒护琚嫆缁?, sent.slice(beforeDeny).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-CMD0' && item.body?.content?.includes('鍙湁缇や富銆佺鐞嗗憳鎴栦唬绠?)))

  result = await call('/qq-free/group-managers', 'POST', { action: 'save', groupOpenid: GROUP, memberOpenid: 'DELEGATE1', name: '浠ｇ' })
  check('娣诲姞浠ｇ', result.status === 200 && result.body.state.groupManagers.some((entry) => entry.memberOpenid === 'DELEGATE1'))
  const beforeDelegate = sent.length
  ws.emit({
    op: 0, s: 8, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-DELEGATE', content: '缇や俊鎭?, group_openid: GROUP, mentions: [], author: { member_openid: 'DELEGATE1', member_role: 'member' } },
  })
  await sleep(150)
  const delegateReply = sent.slice(beforeDelegate).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-DELEGATE')
  check('浠ｇ鍙幏鍙栫兢淇℃伅', Boolean(delegateReply) && delegateReply.body.content.includes('缇?openid锛?) && delegateReply.body.content.includes(GROUP))
  await call('/qq-free/group-managers', 'POST', { action: 'remove', groupOpenid: GROUP, memberOpenid: 'DELEGATE1' })

  const beforeCommand = sent.length
  ws.emit({
    op: 0, s: 9, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-CMD1', content: '鍚屾剰 鐢宠浜?, group_openid: GROUP, mentions: [], author: { member_role: 'admin', member_nickname: '娴嬭瘯绠＄悊鍛? } },
  })
  await sleep(150)
  const commandReply = sent.slice(beforeCommand).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('缇ゅ唴绠＄悊鍛樸€屽悓鎰忋€嶇敓鏁?, sent.some((item) => item.target.includes('/approval_join_request/MEMBERREQ1') && item.body?.op === 'approve')
    && commandReply?.body?.msg_id === 'EV-CMD1' && commandReply?.body?.content.includes('宸茬敱 娴嬭瘯绠＄悊鍛?閫氳繃'), JSON.stringify(commandReply?.body))
  check('鍛戒护澶勭悊鍚庣敵璇峰凡绉婚櫎', !(await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ1'))

  result = await call('/qq-free/group-admin', 'POST', {
    action: 'approve', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1', joinRequestId: 'JOINREQ123456', operator: '娴嬭瘯绠＄悊鍛?,
  })
  check('閫氳繃鍏ョ兢鐢宠', result.status === 200 && sent.find((item) => item.target.includes('/approval_join_request/MEMBERREQ1'))?.body?.op === 'approve')
  check('瀹℃壒璁板綍鎿嶄綔浜?, result.body.operator === '娴嬭瘯绠＄悊鍛? && (await call('/qq-free/state')).body.lastApproval?.operator === '娴嬭瘯绠＄悊鍛?)

  result = await call('/qq-free/group-admin', 'POST', { action: 'mute', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1', minutes: 30 })
  const muteCall = sent.filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  check('绂佽█鎴愬憳', result.status === 200 && muteCall?.body?.members?.[0]?.op === 'add')

  result = await call('/qq-free/group-admin', 'POST', { action: 'unmute', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1' })
  const unmuteCall = sent.filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  check('瑙ｉ櫎绂佽█', result.status === 200 && unmuteCall?.body?.members?.[0]?.op === 'del')

  result = await call('/qq-free/group-admin', 'POST', { action: 'kick', groupOpenid: GROUP, memberOpenid: 'MEMBERREQ1' })
  check('韪㈠嚭鎴愬憳', result.status === 200 && sent.find((item) => item.target.includes('/batch_remove_members'))?.body?.member_openids?.[0] === 'MEMBERREQ1')

  result = await call('/qq-free/group-admin', 'POST', { action: 'mutes', groupOpenid: GROUP })
  check('鏌ヨ绂佽█鐘舵€?, result.status === 200 && result.body.mutes.global_rule.mode === 'none')

  const beforeMod = sent.length
  ws.emit({
    op: 0, s: 10, t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'EV-MUTE', content: '绂佽█ 30', group_openid: GROUP,
      mentions: [{ member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN1', member_role: 'admin' },
    },
  })
  await sleep(150)
  const modMute = sent.slice(beforeMod).filter((item) => item.target.includes('/restrict_chat_setting')).at(-1)
  const modReply = sent.slice(beforeMod).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-MUTE')
  check('缇ゅ唴 @鎴愬憳 绂佽█', modMute?.body?.members?.[0]?.member_openid === 'TARGET123456' && modReply?.body?.content.includes('宸茬瑷€'), JSON.stringify(modMute?.body))

  ws.emit({
    op: 0, s: 11, t: 'GROUP_MESSAGE_CREATE',
    d: {
      id: 'EV-KICK', content: '韪汉', group_openid: GROUP,
      mentions: [{ member_openid: 'TARGET123456', is_you: false }],
      author: { member_openid: 'ADMIN1', member_role: 'admin' },
    },
  })
  await sleep(150)
  const modKick = sent.filter((item) => item.target.includes('/batch_remove_members')).at(-1)
  check('缇ゅ唴 @鎴愬憳 韪汉', modKick?.body?.member_openids?.[0] === 'TARGET123456', JSON.stringify(modKick?.body))

  ws.emit({
    op: 0, s: 12, t: 'GROUP_JOIN_REQUEST',
    d: { group_openid: GROUP, member_openid: 'MEMBERREQ2', join_request_id: 'JOINREQ654321', username: '鍙︿竴浣? },
  })
  await sleep(120)
  const replacedJoin = (await call('/qq-free/state')).body.pendingJoins
  check('鏂扮敵璇疯鏃х敵璇蜂綔搴燂紝鍙繚鐣欎竴鏉?, replacedJoin.length === 1 && replacedJoin[0].memberOpenid === 'MEMBERREQ2')
  ws.emit({ op: 0, s: 13, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'MEMBERREQ2' } })
  await sleep(120)
  check('鎴愬憳鍏ョ兢鍚庤嚜鍔ㄦ竻鎺夌敵璇?, !(await call('/qq-free/state')).body.pendingJoins.some((entry) => entry.memberOpenid === 'MEMBERREQ2'))

  result = await call('/qq-free/config', 'POST', {
    moderationEnabled: true,
    moderationGroups: [GROUP],
    bannedWords: ['鍧忚瘝'],
    moderationMuteMinutes: 5,
  })
  check('淇濆瓨杩濈璇嶈缃?, result.status === 200 && result.body.state.moderation.words.includes('鍧忚瘝'))

  const emitBad = (id, content, role) => ws.emit({
    op: 0, s: 20 + Number(id.slice(-1)), t: 'GROUP_MESSAGE_CREATE',
    d: { id, content, group_openid: GROUP, mentions: [], author: { member_openid: 'BADUSER1', member_nickname: '鎹ｄ贡鐨?, member_role: role } },
  })
  const beforeBad = sent.length
  emitBad('EV-BAD1', '杩欓噷鏈夊潖璇?, 'member')
  await sleep(150)
  check('绗?1 娆¤繚瑙勬挙鍥炲苟璀﹀憡', sent.some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-BAD1'))
    && sent.slice(beforeBad).some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('绗?1 娆?)))
  emitBad('EV-BAD2', '鍙堟槸鍧忚瘝', 'member')
  await sleep(150)
  check('绗?2 娆¤繚瑙勭瑷€', sent.some((item) => item.method === 'POST' && item.target.includes('/restrict_chat_setting') && item.body?.members?.[0]?.member_openid === 'BADUSER1')
    && sent.some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('绗?2 娆?)))
  emitBad('EV-BAD3', '杩樻槸鍧忚瘝', 'member')
  await sleep(150)
  check('绗?3 娆¤繚瑙勮涪鍑?, sent.some((item) => item.target.includes('/batch_remove_members') && item.body?.member_openids?.[0] === 'BADUSER1')
    && sent.some((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.content?.includes('绗?3 娆?)))
  check('韪㈠嚭鍚庤繚瑙勬鏁版竻闆?, (await call('/qq-free/state')).body.moderation.strikes.every((entry) => entry.memberOpenid !== 'BADUSER1'))

  const beforeAdminBad = sent.length
  emitBad('EV-BAD4', '绠＄悊鍛樹篃鍙戝潖璇?, 'admin')
  await sleep(100)
  check('绠＄悊鍛樹笉琚繚绂佽瘝澶勭綒', !sent.slice(beforeAdminBad).some((item) => item.method === 'DELETE' && item.target.includes('/messages/EV-BAD4')))

  result = await call('/qq-free/blocklist', 'POST', { action: 'add', groupOpenid: GROUP, memberOpenid: 'BLOCKED1', name: '琚睆钄界殑浜? })
  check('娣诲姞灞忚斀鎴愬憳', result.status === 200 && result.body.state.blockedMembers.some((entry) => entry.memberOpenid === 'BLOCKED1'))
  const beforeBlocked = sent.length
  ws.emit({
    op: 0, s: 15, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-BLOCK1', content: '<@BOT> 浣犲ソ', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'BLOCKED1', member_nickname: '琚睆钄界殑浜?, member_role: 'member' } },
  })
  await sleep(150)
  check('灞忚斀鎴愬憳鐨勬秷鎭蹇界暐', sent.length === beforeBlocked)
  result = await call('/qq-free/blocklist', 'POST', { action: 'remove', groupOpenid: GROUP, memberOpenid: 'BLOCKED1' })
  check('鍙栨秷灞忚斀鎴愬憳', result.status === 200 && !result.body.state.blockedMembers.some((entry) => entry.memberOpenid === 'BLOCKED1'))

  result = await call('/qq-free/blocklist', 'POST', { action: 'add-mention', groupOpenid: GROUP, memberOpenid: 'MENTIONBLOCK1', name: '琚?@ 鐨勪汉' })
  check('娣诲姞 @ 灞忚斀', result.status === 200 && result.body.state.blockedMentions.some((entry) => entry.memberOpenid === 'MENTIONBLOCK1'))
  const beforeMentionBlocked = sent.length
  ws.emit({
    op: 0, s: 16, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-MBLOCK1', content: '<@MENTIONBLOCK1> <@BOT> 鍦ㄥ悧', group_openid: GROUP, mentions: [{ member_openid: 'MENTIONBLOCK1' }, { bot: true, is_you: true }], author: { member_openid: 'NORMALUSER1', member_nickname: '鏅€氫汉', member_role: 'member' } },
  })
  await sleep(150)
  check('@ 琚睆钄芥垚鍛樼殑娑堟伅琚拷鐣?, sent.length === beforeMentionBlocked)
  result = await call('/qq-free/blocklist', 'POST', { action: 'remove-mention', groupOpenid: GROUP, memberOpenid: 'MENTIONBLOCK1' })
  check('鍙栨秷 @ 灞忚斀', result.status === 200 && !result.body.state.blockedMentions.some((entry) => entry.memberOpenid === 'MENTIONBLOCK1'))

  const beforeInfo = sent.length
  ws.emit({
    op: 0, s: 17, t: 'GROUP_MESSAGE_CREATE',
    d: { id: 'EV-INFO', content: '<@TARGET123456> 鑾峰彇淇℃伅', group_openid: GROUP, mentions: [{ member_openid: 'TARGET123456', username: '鐩爣' }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } },
  })
  await sleep(150)
  const infoReply = sent.slice(beforeInfo).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.msg_id === 'EV-INFO')
  check('@鏌愪汉 鑾峰彇淇℃伅鏄剧ず openid 鍜屽叆缇ゆ椂闂?, Boolean(infoReply) && infoReply.body.content.includes('openid锛歍ARGET123456') && infoReply.body.content.includes('鍏ョ兢鏃堕棿'))

  result = await call('/qq-free/announcements', 'POST', {
    action: 'save', name: '娴嬭瘯鍏憡', groupOpenids: [GROUP], date: '', time: '09:00', text: '閲嶈閫氱煡', enabled: true,
  })
  check('淇濆瓨瀹氭椂缇ゅ叕鍛?, result.status === 200 && Array.isArray(result.body.state.announcements) && result.body.state.announcements.length === 1)
  const annId = result.body.state.announcements[0].id
  const beforeAnn = sent.length
  result = await call('/qq-free/announcements', 'POST', { action: 'run', id: annId })
  const annMessage = sent.slice(beforeAnn).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`))
  check('瀹氭椂鍏憡 @鎵€鏈変汉 鍙戦€?, result.status === 200 && annMessage?.body?.msg_type === 2 && annMessage?.body?.markdown?.content.includes('<qqbot-at-everyone />'), JSON.stringify(annMessage?.body))
  result = await call('/qq-free/announcements', 'POST', { action: 'remove', id: annId })
  check('鍒犻櫎瀹氭椂鍏憡', result.status === 200 && result.body.state.announcements.length === 0)

  result = await call('/qq-free/group-blocks', 'POST', { action: 'save', groupOpenid: GROUP, all: true, features: [] })
  check('淇濆瓨缇ゅ叏閮ㄥ睆钄?, result.status === 200 && result.body.state.groupBlocks.some((entry) => entry.groupOpenid === GROUP && entry.all === true))
  const beforeBlockAll = sent.length
  ws.emit({ op: 0, s: 18, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-BLOCKALL', content: '<@BOT> 浣犲ソ', group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'NORMALUSER1', member_role: 'member' } } })
  await sleep(150)
  check('缇ゅ叏閮ㄥ睆钄藉悗涓嶅洖澶?, sent.length === beforeBlockAll)
  result = await call('/qq-free/group-blocks', 'POST', { action: 'remove', groupOpenid: GROUP })
  check('鍙栨秷缇ゅ睆钄?, result.status === 200 && !result.body.state.groupBlocks.some((entry) => entry.groupOpenid === GROUP))

  result = await call('/qq-free/config', 'POST', { joinVerifyEnabled: true, joinVerifyGroups: [GROUP] })
  check('寮€鍚叆缇ら獙璇?, result.status === 200 && result.body.state.joinVerify.enabled === true)
  const beforeVerify = sent.length
  ws.emit({ op: 0, s: 30, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY01', username: '鏂颁汉涓€', member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(200)
  const verifyMessage = sent.slice(beforeVerify).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.markdown?.content?.includes('楠岃瘉鐮?))
  const verifyCode = /楠岃瘉鐮侊細(\d{6})/.exec(verifyMessage?.body?.markdown?.content ?? '')?.[1] ?? ''
  check('鏂版垚鍛樻敹鍒?@ 鍜岄獙璇佺爜', Boolean(verifyMessage) && verifyCode.length === 6 && verifyMessage.body.markdown.content.includes('qqbot-at-user id="VERIFY01"'))
  ws.emit({ op: 0, s: 31, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-VERIFY-OK', content: `<@BOT> ${verifyCode}`, group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'VERIFY01', member_role: 'member' } } })
  await sleep(150)
  check('楠岃瘉鐮佹纭笉韪汉', !sent.slice(beforeVerify).some((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY01')))

  const beforeWrong = sent.length
  ws.emit({ op: 0, s: 32, t: 'GROUP_MEMBER_ADD', d: { group_openid: GROUP, member_openid: 'VERIFY02', username: '鏂颁汉浜?, member_role: 'member', timestamp: new Date().toISOString() } })
  await sleep(200)
  const verifyMessage2 = sent.slice(beforeWrong).find((item) => item.target.endsWith(`/v2/groups/${GROUP}/messages`) && item.body?.markdown?.content?.includes('楠岃瘉鐮?))
  const verifyCode2 = /楠岃瘉鐮侊細(\d{6})/.exec(verifyMessage2?.body?.markdown?.content ?? '')?.[1] ?? ''
  const wrongCode = verifyCode2 === '000000' ? '111111' : '000000'
  ws.emit({ op: 0, s: 33, t: 'GROUP_MESSAGE_CREATE', d: { id: 'EV-VERIFY-BAD', content: `<@BOT> ${wrongCode}`, group_openid: GROUP, mentions: [{ bot: true, is_you: true }], author: { member_openid: 'VERIFY02', member_role: 'member' } } })
  await sleep(200)
  check('楠岃瘉鐮侀敊璇涪浜?, sent.slice(beforeWrong).some((item) => item.target.includes('/batch_remove_members') && JSON.stringify(item.body).includes('VERIFY02')))
  await call('/qq-free/config', 'POST', { joinVerifyEnabled: false, joinVerifyGroups: [] })
}

result = await call('/qq-free/channel', 'POST', { enabled: false, confirm: true })
check('鍋滄閫氶亾', result.status === 200 && result.body.state.chat.state === 'stopped')

const remotePort = 37000 + (process.pid % 500)
result = await call('/qq-free/remote', 'POST', { enabled: true, port: remotePort, token: 'test-token' })
check('鍚敤杩滅▼缃戦〉', result.status === 200 && result.body.state.remote.running === true && result.body.state.remote.token === 'test-token', result.body.error)
await sleep(200)
const remoteBase = `http://127.0.0.1:${remotePort}`
const pageRes = await httpCall(`${remoteBase}/`)
check('杩滅▼缃戦〉鍙墦寮€', pageRes.status === 200 && pageRes.text.includes('QQ 鑷敱鍙戣█'))
const unauth = await httpCall(`${remoteBase}/api/state`)
check('杩滅▼鎺ュ彛鎷掔粷鏃?token', unauth.status === 401)
const authRes = await httpCall(`${remoteBase}/api/state`, { headers: { authorization: 'Bearer test-token' } })
const authBody = authRes.json()
check('杩滅▼鎺ュ彛 token 鍙敤', authRes.status === 200 && authBody.ok === true && Array.isArray(authBody.targets))
const remoteSend = await httpCall(`${remoteBase}/api/send`, {
  method: 'POST',
  headers: { authorization: 'Bearer test-token', 'content-type': 'application/json' },
  body: { targetId, text: '杩滅▼缃戦〉鍙戦€佹祴璇? },
})
check('杩滅▼缃戦〉鍙彂瑷€', remoteSend.status === 200 && remoteSend.json().ok === true)
result = await call('/qq-free/remote', 'POST', { enabled: false })
check('鍋滄杩滅▼缃戦〉', result.status === 200 && result.body.state.remote.running === false)

llmFail = true
result = await call('/qq-free/generate', 'POST', { topic: '澶辫触' })
check('妯″瀷澶辫触鏈夋槑纭敊璇?, result.status === 400 && /AUTH/.test(result.body.error))
llmFail = false

for (const dispose of cleanups) if (typeof dispose === 'function') await dispose()
rmSync(dataRoot, { recursive: true, force: true })
console.log(failures === 0 ? '\n鍏ㄩ儴閫氳繃' : `\n${failures} 椤瑰け璐)
process.exit(failures === 0 ? 0 : 1)

