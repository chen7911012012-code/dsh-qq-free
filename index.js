/**
 * QQ 官方机器人「自由发言」——Host 半边。
 *
 * 能力：
 * - 通过 QQ 开放平台 OpenAPI v2 主动发送群聊 / 私聊消息（无需被 @，即「自由发言」）；
 * - 用 DSH 的 llm 服务（默认 DeepSeek 账号路由）生成发言内容、网页试聊；
 * - 定时自动开口（间隔、主题、人设、静默时段、每日配额）；
 * - 注册 `qq_free_say` 工具，让任意 DSH 会话里的智能体都能让机器人在 QQ 说话；
 * - 把状态、目标、发送、日志暴露成同源 HTTP 路由，供 client.js 的网页面板使用。
 *
 * 只使用 node 内置模块，不引入任何 npm 依赖：插件以链接目录方式安装时，
 * 裸包导入在宿主里解析不到，所有 DSH 服务都通过 ctx.get() 取得。
 *
 * @module @local/dsh-qq-free
 */

import { randomBytes } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createChatChannel } from './channel.js'
import { createRemoteServer } from './remote.js'
import { createCloudSync } from './cloud.js'
import { createGitHubSync } from './github.js'

export const name = 'qq-free'

/** 数据目录：优先 profile 目录，其次 ~/.dsh。 */
function resolveDataDir() {
  const profileDir = process.env.DSH_PROFILE_DIR
  if (typeof profileDir === 'string' && profileDir.trim().length > 0) {
    return join(profileDir.trim(), '.qq-free')
  }
  const dshHome = process.env.DSH_HOME
  if (typeof dshHome === 'string' && dshHome.trim().length > 0) {
    return join(dshHome.trim(), 'qq-free')
  }
  return join(homedir(), '.dsh', 'qq-free')
}

const DATA_DIR = resolveDataDir()
const PLUGIN_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = join(DATA_DIR, 'config.json')
const STATE_FILE = join(DATA_DIR, 'state.json')
const QA_FILE = join(DATA_DIR, 'qa.json')

const MAX_LOG = 200
const MAX_TEXT = 1500

const DEFAULT_PERSONA = '你是一个真实、幽默、热心的 QQ 群友，说话简短自然，像在群里随手聊天，不用 Markdown，不列出条目。'

const DEFAULT_CONFIG = {
  appId: '',
  appSecret: '',
  apiBase: 'https://api.sgroup.qq.com',
  provider: 'deepseek-account',
  model: 'deepseek-flash',
  persona: '',
  defaultTarget: '',
  dailyLimit: 4,
  quietHoursStart: '23:00',
  quietHoursEnd: '08:00',
  autoEnabled: false,
  autoTarget: '',
  autoIntervalMinutes: 120,
  autoTopics: '',
  qaThreshold: 0.45,
  chatEnabled: false,
  chatPersona: '',
  chatAgentPersona: '',
  welcomeEnabled: false,
  welcomeText: '欢迎新成员加入本群！🎉',
  welcomeGroups: [],
  joinNoticeEnabled: true,
  joinNoticeAvatar: true,
  replyLogFile: 'qq-replies.md',
  chatUseQa: false,
  webEnabled: false,
  webPort: 8788,
  webToken: '',
  moderationEnabled: true,
  moderationGroups: [],
  bannedWords: [],
  moderationMuteMinutes: 10,
  cloudEnabled: false,
  cloudUrl: '',
  cloudUser: '',
  cloudPass: '',
  cloudAuto: true,
  githubEnabled: false,
  githubOwner: 'chen7911012012-code',
  githubRepo: 'dsh-qq-free',
  githubToken: '',
  githubAuto: true,
}

const EDITABLE_KEYS = new Set(Object.keys(DEFAULT_CONFIG))

function remoteUrls(port, token) {
  const suffix = token ? `?token=${encodeURIComponent(token)}` : ''
  const urls = [`http://127.0.0.1:${port}/${suffix}`]
  try {
    for (const entries of Object.values(networkInterfaces())) {
      for (const entry of entries ?? []) {
        if (entry.family === 'IPv4' && entry.internal === false) {
          urls.push(`http://${entry.address}:${port}/${suffix}`)
        }
      }
    }
  } catch {
    // ignore
  }
  return urls
}

/** 只挑出已知键，并做最基本的类型收敛。 */
function pickConfig(input) {
  const out = {}
  if (input === null || typeof input !== 'object') return out
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    if (!(key in input)) continue
    const value = input[key]
    if (value === undefined || value === null) continue
    if (key === 'dailyLimit' || key === 'autoIntervalMinutes') {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      if (key === 'autoIntervalMinutes') {
        out[key] = Math.max(5, Math.min(10080, Math.round(n)))
      } else {
        out[key] = Math.max(0, Math.min(200, Math.round(n)))
      }
    } else if (key === 'qaThreshold') {
      const n = Number(value)
      if (!Number.isFinite(n)) continue
      out[key] = Math.max(0, Math.min(1, n))
    } else if (key === 'autoEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'chatEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'welcomeEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'joinNoticeEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'joinNoticeAvatar') {
      out[key] = value === true || value === 'true'
    } else if (key === 'chatUseQa') {
      out[key] = value === true || value === 'true'
    } else if (key === 'webEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'webPort') {
      const port = Number(value)
      if (!Number.isFinite(port)) continue
      out[key] = Math.max(1024, Math.min(65535, Math.round(port)))
    } else if (key === 'welcomeGroups') {
      const list = Array.isArray(value) ? value : String(value).split(/[,，、\s]+/)
      out[key] = list.map((item) => String(item).trim()).filter(Boolean).slice(0, 20)
    } else if (key === 'moderationGroups' || key === 'bannedWords') {
      const list = Array.isArray(value) ? value : String(value).split(/[\n,，、]+/)
      out[key] = list.map((item) => String(item).trim()).filter(Boolean).slice(0, key === 'bannedWords' ? 500 : 30)
    } else if (key === 'moderationMuteMinutes') {
      const minutes = Number(value)
      if (!Number.isFinite(minutes)) continue
      out[key] = Math.max(1, Math.min(43200, Math.round(minutes)))
    } else if (key === 'moderationEnabled') {
      out[key] = value === true || value === 'true'
    } else if (key === 'cloudEnabled' || key === 'cloudAuto') {
      out[key] = value === true || value === 'true'
    } else if (key === 'githubEnabled' || key === 'githubAuto') {
      out[key] = value === true || value === 'true'
    } else {
      out[key] = String(value).slice(0, key === 'appSecret' ? 256 : 4000)
    }
  }
  return out
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    return parsed ?? fallback
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const tmp = `${file}.tmp`
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
    renameSync(tmp, file)
    return true
  } catch {
    return false
  }
}

/** 今天（本地时区）的日期键。 */
function todayKey(now = new Date()) {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function minutesOfDay(text) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(text ?? '').trim())
  if (match === null) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

/** 静默时段判定，支持跨午夜。 */
function inQuietHours(config, now = new Date()) {
  const start = minutesOfDay(config.quietHoursStart)
  const end = minutesOfDay(config.quietHoursEnd)
  if (start === null || end === null || start === end) return false
  const current = now.getHours() * 60 + now.getMinutes()
  return start < end ? current >= start && current < end : current >= start || current < end
}

function targetKey(target) {
  return `${target.scope}:${target.openid}`
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(iso)
  }
}

export async function apply(ctx, config) {
  const logger = ctx.logger ?? console
  mkdirSync(DATA_DIR, { recursive: true })

  /** 行配置（patch）与网页写入的 config.json 合并后的生效配置。 */
  let liveConfig = {}
  let credentialSource = null
  function reloadConfig() {
    const rowConfig = pickConfig(config ?? {})
    const fileConfig = pickConfig(readJson(CONFIG_FILE, {}))
    liveConfig = { ...DEFAULT_CONFIG, ...rowConfig, ...fileConfig }
    credentialSource = rowConfig.appId && rowConfig.appSecret ? 'profile' : fileConfig.appId && fileConfig.appSecret ? 'panel' : null
    // 环境变量作为凭据兜底（与官方 QQ 插件使用同一组变量名）
    if (!liveConfig.appId && typeof process.env.QQBOT_APPID === 'string') liveConfig.appId = process.env.QQBOT_APPID.trim()
    if (!liveConfig.appSecret && typeof process.env.QQBOT_SECRET === 'string') liveConfig.appSecret = process.env.QQBOT_SECRET.trim()
    if (credentialSource === null && liveConfig.appId && liveConfig.appSecret) credentialSource = 'env'
    return liveConfig
  }
  reloadConfig()

  function saveConfigPatch(patch) {
    const next = pickConfig({ ...pickConfig(readJson(CONFIG_FILE, {})), ...patch })
    if (!writeJson(CONFIG_FILE, next)) throw new Error('保存设置失败')
    reloadConfig()
    return next
  }

  let state = readJson(STATE_FILE, {})
  if (state === null || typeof state !== 'object') state = {}
  state.targets = Array.isArray(state.targets) ? state.targets.filter((t) => t && typeof t.openid === 'string') : []
  state.log = Array.isArray(state.log) ? state.log.slice(-MAX_LOG) : []
  state.usage = state.usage !== null && typeof state.usage === 'object' ? state.usage : {}
  state.lastAutoAt = Number(state.lastAutoAt) || 0
  state.lastError = typeof state.lastError === 'string' ? state.lastError : ''
  state.pendingJoins = Array.isArray(state.pendingJoins) ? state.pendingJoins.slice(-50) : []
  state.chatLog = Array.isArray(state.chatLog) ? state.chatLog.slice(-200) : []
  state.lastApproval = state.lastApproval && typeof state.lastApproval === 'object' ? state.lastApproval : null
  state.members = Array.isArray(state.members)
    ? state.members.filter((item) => item && typeof item.openid === 'string' && typeof item.groupOpenid === 'string').slice(-300)
    : []
  state.strikes = state.strikes !== null && typeof state.strikes === 'object' ? state.strikes : {}
  state.boards = Array.isArray(state.boards)
    ? state.boards.filter((item) => item && typeof item.id === 'string' && Array.isArray(item.targetIds)).slice(-50)
    : []
  state.blockedMembers = Array.isArray(state.blockedMembers)
    ? state.blockedMembers.filter((item) => item && typeof item.groupOpenid === 'string' && typeof item.memberOpenid === 'string').slice(-500)
    : []
  state.blockedMentions = Array.isArray(state.blockedMentions)
    ? state.blockedMentions.filter((item) => item && typeof item.groupOpenid === 'string' && typeof item.memberOpenid === 'string').slice(-500)
    : []

  // 只保留今天的配额计数
  const today = todayKey()
  for (const key of Object.keys(state.usage)) {
    if (!key.startsWith(`${today}|`)) delete state.usage[key]
  }

  function persistState() {
    state.log = state.log.slice(-MAX_LOG)
    writeJson(STATE_FILE, state)
  }

  function rememberError(message) {
    state.lastError = message
    persistState()
  }

  function appendLog(entry) {
    state.log.push(entry)
    if (state.log.length > MAX_LOG) state.log = state.log.slice(-MAX_LOG)
    persistState()
  }

  let membersPersistTimer = null
  /** 记录最近在群里说过话的成员，供自由发言选择 @ 成员。 */
  function rememberMember({ groupOpenid, memberOpenid, username, memberRole }) {
    if (typeof groupOpenid !== 'string' || groupOpenid.length === 0) return
    if (typeof memberOpenid !== 'string' || memberOpenid.length === 0) return
    state.members = state.members.filter((item) => !(item.groupOpenid === groupOpenid && item.openid === memberOpenid))
    state.members.push({
      groupOpenid,
      openid: memberOpenid,
      name: String(username || memberOpenid).slice(0, 80),
      role: String(memberRole || ''),
      at: new Date().toISOString(),
    })
    if (state.members.length > 300) state.members = state.members.slice(-300)
    if (membersPersistTimer === null) {
      membersPersistTimer = setTimeout(() => {
        membersPersistTimer = null
        persistState()
      }, 5000)
      membersPersistTimer.unref?.()
    }
  }

  function resolveReplyLogFile() {
    const value = String(liveConfig.replyLogFile || 'qq-replies.md').trim() || 'qq-replies.md'
    return isAbsolute(value) ? value : join(process.cwd(), value)
  }

  /** 把一次问答写进工作区文件，方便在 DSH 工作区里直接查看。 */
  function appendReplyLogFile(entry) {
    const text = [
      `## ${formatTime(entry.at)} · ${entry.scope === 'group' ? '群' : '私聊'} ${entry.openid}`,
      `问（${entry.askerName || entry.asker || '成员'}）：${entry.question}`,
      `答（${entry.source}）：${entry.answer}`,
      '',
    ].join('\n')
    const targets = [resolveReplyLogFile(), join(DATA_DIR, 'qq-replies.md')]
    for (const file of targets) {
      try {
        mkdirSync(dirname(file), { recursive: true })
        appendFileSync(file, `${text}\n`, 'utf8')
        state.replyLogPath = file
        return
      } catch {
        // 工作区不可写时退到数据目录
      }
    }
  }

  function recordChatReply(entry) {
    state.chatLog.push(entry)
    if (state.chatLog.length > 200) state.chatLog = state.chatLog.slice(-200)
    appendReplyLogFile(entry)
    appendLog({
      at: entry.at,
      scope: entry.scope,
      openid: entry.openid,
      name: 'QQ AI 对话',
      text: entry.answer,
      ok: true,
      kind: 'chat',
    })
  }

  // ── 问答库 ───────────────────────────────────────────────────────────────

  let qa = readJson(QA_FILE, [])
  qa = Array.isArray(qa)
    ? qa.filter((entry) => entry && typeof entry.id === 'string' && typeof entry.question === 'string' && typeof entry.answer === 'string')
      .map((entry) => ({
        id: entry.id,
        question: String(entry.question).slice(0, 500),
        answer: String(entry.answer).slice(0, 5000),
        keywords: Array.isArray(entry.keywords) ? entry.keywords.map((k) => String(k).slice(0, 50)).filter(Boolean).slice(0, 10) : [],
        enabled: entry.enabled !== false,
        hits: Number(entry.hits) || 0,
        createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : new Date().toISOString(),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
      }))
    : []

  function saveQa() {
    writeJson(QA_FILE, qa)
  }

  /** 归一化：全角转半角、忽略大小写、去掉空白与标点。 */
  function normalizeText(text) {
    return String(text ?? '')
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, '')
  }

  /** 字符二元组，用于中文短文本的相似度。 */
  function bigrams(text) {
    const set = new Set()
    if (text.length <= 1) {
      if (text.length === 1) set.add(text)
      return set
    }
    for (let index = 0; index < text.length - 1; index += 1) set.add(text.slice(index, index + 2))
    return set
  }

  function diceSimilarity(left, right) {
    const a = bigrams(left)
    const b = bigrams(right)
    if (a.size === 0 || b.size === 0) return 0
    let intersection = 0
    for (const gram of a) if (b.has(gram)) intersection += 1
    return (2 * intersection) / (a.size + b.size)
  }

  /**
   * 在问答库里找最匹配的一条。
   * 命中规则：原文相同 > 关键词全中 > 互相包含 > 二元组相似度。
   */
  function findQaMatch(question) {
    const query = normalizeText(question)
    if (query.length === 0) return null
    const threshold = Number(liveConfig.qaThreshold) || DEFAULT_CONFIG.qaThreshold
    let best = null
    for (const entry of qa) {
      if (!entry.enabled) continue
      const target = normalizeText(entry.question)
      if (target.length === 0) continue
      const keywords = entry.keywords.map(normalizeText).filter((k) => k.length > 0)
      let score = 0
      if (target === query) score = 1
      else if (keywords.length > 0 && keywords.every((keyword) => query.includes(keyword))) score = 0.95
      else if (target.length >= 2 && (query.includes(target) || target.includes(query))) score = 0.85
      else score = diceSimilarity(query, target)
      if (best === null || score > best.score) best = { entry, score }
    }
    if (best === null || best.score < threshold) return null
    return best
  }

  function qaStats() {
    return {
      count: qa.length,
      enabled: qa.filter((entry) => entry.enabled).length,
      hits: qa.reduce((sum, entry) => sum + (Number(entry.hits) || 0), 0),
      threshold: Number(liveConfig.qaThreshold) || DEFAULT_CONFIG.qaThreshold,
    }
  }

  /**
   * 把问答库渲染进系统提示：不依赖智能体“记得调用工具”，
   * 被 @ 提问时模型始终能看到库里的答案。
   */
  function renderQaLibrary() {
    const entries = qa.filter((entry) => entry.enabled).slice(0, 30)
    if (entries.length === 0) return ''
    const lines = entries.map((entry, index) => {
      const question = entry.question.slice(0, 200)
      const answer = entry.answer.length > 300 ? `${entry.answer.slice(0, 300)}…` : entry.answer
      return `${index + 1}. 问：${question}\n   答：${answer}`
    })
    return '当前问答库（回答用户提问时优先使用这些答案，保持原意，不要编造；没有相近的再用常识回答）：\n'
      + lines.join('\n')
  }

  function addQaEntry({ question, answer, keywords }) {
    const now = new Date().toISOString()
    const entry = {
      id: `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      question: String(question ?? '').trim().slice(0, 500),
      answer: String(answer ?? '').trim().slice(0, 5000),
      keywords: Array.isArray(keywords) ? keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 10) : [],
      enabled: true,
      hits: 0,
      createdAt: now,
      updatedAt: now,
    }
    if (entry.question.length === 0) throw new Error('问题不能为空')
    if (entry.answer.length === 0) throw new Error('答案不能为空')
    const duplicate = qa.find((item) => normalizeText(item.question) === normalizeText(entry.question))
    if (duplicate !== undefined) {
      duplicate.answer = entry.answer
      if (entry.keywords.length > 0) duplicate.keywords = entry.keywords
      duplicate.updatedAt = now
      saveQa()
      return { entry: duplicate, updated: true }
    }
    qa.push(entry)
    saveQa()
    return { entry, updated: false }
  }

  function updateQaEntry(id, patch) {
    const entry = qa.find((item) => item.id === id)
    if (entry === undefined) throw new Error('没有找到这条问答')
    if (typeof patch.question === 'string') {
      const question = patch.question.trim().slice(0, 500)
      if (question.length === 0) throw new Error('问题不能为空')
      entry.question = question
    }
    if (typeof patch.answer === 'string') {
      const answer = patch.answer.trim().slice(0, 5000)
      if (answer.length === 0) throw new Error('答案不能为空')
      entry.answer = answer
    }
    if (Array.isArray(patch.keywords)) entry.keywords = patch.keywords.map((k) => String(k).trim()).filter(Boolean).slice(0, 10)
    if (typeof patch.enabled === 'boolean') entry.enabled = patch.enabled
    entry.updatedAt = new Date().toISOString()
    saveQa()
    return entry
  }

  // ── QQ OpenAPI ───────────────────────────────────────────────────────────

  const tokenCache = new Map()

  async function getAccessToken(cfg) {
    if (!cfg.appId || !cfg.appSecret) {
      throw new Error('还没有配置 QQ 机器人凭据：请在下面填写 AppID / AppSecret，或设置环境变量 QQBOT_APPID、QQBOT_SECRET')
    }
    const cacheKey = `${cfg.appId}:${cfg.appSecret.slice(0, 6)}`
    const cached = tokenCache.get(cacheKey)
    if (cached !== undefined && cached.expiresAt > Date.now() + 60_000) return cached.token
    const response = await fetch('https://bots.qq.com/app/getAppAccessToken', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': 'dsh-qq-free/1.0' },
      body: JSON.stringify({ appId: cfg.appId, clientSecret: cfg.appSecret }),
      signal: AbortSignal.timeout(15_000),
    })
    const text = await response.text()
    let body = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    if (!response.ok || body === null || typeof body.access_token !== 'string') {
      const detail = body === null ? text.slice(0, 200) : JSON.stringify(body).slice(0, 200)
      throw new Error(`获取 access_token 失败（HTTP ${response.status}）：${detail || '响应为空'}`)
    }
    const expiresAt = Date.now() + (Number(body.expires_in) || 7200) * 1000
    tokenCache.set(cacheKey, { token: body.access_token, expiresAt })
    return body.access_token
  }

  function usageFor(target, day = todayKey()) {
    return Number(state.usage[`${day}|${targetKey(target)}`]) || 0
  }

  function quotaExceeded(target) {
    const limit = Number(liveConfig.dailyLimit) || 0
    return limit > 0 && usageFor(target) >= limit
  }

  /**
   * 主动发送一条文本消息（不带 msg_id，属于「主动消息」，也就是自由发言）。
   * 返回平台响应里的消息 id。
   */
  async function sendText(target, text, meta = {}) {
    const cfg = liveConfig
    const trimmed = String(text ?? '').trim()
    if (trimmed.length === 0) throw new Error('消息内容不能为空')
    if (trimmed.length > MAX_TEXT) throw new Error(`消息过长（${trimmed.length} 字），最多 ${MAX_TEXT} 字`)
    if (target.scope !== 'group' && target.scope !== 'c2c') throw new Error(`未知的会话类型：${target.scope}`)
    if (!target.openid) throw new Error('缺少目标 openid')
    if (quotaExceeded(target) && meta.ignoreDailyLimit !== true) {
      throw new Error(`今天给这个会话的主动消息已达到上限（${liveConfig.dailyLimit} 条），可在「连接与模型」里调高每日配额`)
    }
    const token = await getAccessToken(cfg)
    const base = String(cfg.apiBase || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
    const path = target.scope === 'c2c' ? `/v2/users/${encodeURIComponent(target.openid)}/messages` : `/v2/groups/${encodeURIComponent(target.openid)}/messages`
    const mention = target.scope === 'group' ? String(meta.mention ?? '').trim() : ''
    if (mention.length > 0 && !/^[A-Za-z0-9_-]{8,}$/.test(mention)) throw new Error('@成员 openid 不合法')
    const mentionName = mention.length > 0
      ? (state.members.find((item) => item.groupOpenid === target.openid && item.openid === mention)?.name ?? '')
      : ''
    const post = (payload) => fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json',
        'user-agent': 'dsh-qq-free/1.5',
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    })
    let response
    let raw = ''
    let body = null
    try {
      const payload = mention.length > 0
        ? { markdown: { content: `<qqbot-at-user id="${mention}"/> ${trimmed}` }, msg_type: 2 }
        : { content: trimmed, msg_type: 0 }
      response = await post(payload)
      raw = await response.text()
      try {
        body = JSON.parse(raw)
      } catch {
        body = null
      }
      // Markdown @ 不可用时退化成「@昵称」文字，至少把消息发出去
      if (!response.ok && mention.length > 0) {
        response = await post({ content: mentionName ? `@${mentionName} ${trimmed}` : trimmed, msg_type: 0 })
        raw = await response.text()
        try {
          body = JSON.parse(raw)
        } catch {
          body = null
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const failure = `调用 QQ 开放平台失败：${message}`
      appendLog({
        at: new Date().toISOString(),
        scope: target.scope,
        openid: target.openid,
        name: target.name || (target.scope === 'c2c' ? '私聊' : '群聊'),
        text: trimmed,
        ok: false,
        error: failure,
        kind: meta.kind || 'manual',
      })
      state.lastError = failure
      throw new Error(failure)
    }
    if (!response.ok) {
      const code = body && (body.code ?? body.err_code)
      const message = (body && body.message) || raw.slice(0, 200) || response.statusText
      const suffix = code !== undefined ? `（平台错误码 ${code}）` : ''
      const failure = `QQ 平台拒绝了这次发送：HTTP ${response.status} ${message}${suffix}`
      appendLog({
        at: new Date().toISOString(),
        scope: target.scope,
        openid: target.openid,
        name: target.name || (target.scope === 'c2c' ? '私聊' : '群聊'),
        text: trimmed,
        ok: false,
        error: failure,
        kind: meta.kind || 'manual',
      })
      state.lastError = failure
      throw new Error(failure)
    }
    const messageId = body && typeof body.id === 'string' ? body.id : ''
    const entry = {
      at: new Date().toISOString(),
      scope: target.scope,
      openid: target.openid,
      name: target.name || (target.scope === 'c2c' ? '私聊' : '群聊'),
      text: trimmed,
      ok: true,
      messageId,
      kind: meta.kind || 'manual',
    }
    const key = `${todayKey()}|${targetKey(target)}`
    state.usage[key] = usageFor(target) + 1
    appendLog(entry)
    state.lastError = ''
    return { messageId, entry }
  }

  const MEDIA_LABELS = { 1: '图片', 2: '视频', 3: '语音', 4: '文件' }

  /**
   * 发送图片/视频/语音/文件：先上传拿 file_info，再发 msg_type=7。
   * 支持 http(s) URL（平台代下载）或本地路径（<=5MB，base64 直传）。
   */
  async function sendMedia(target, options = {}) {
    const cfg = liveConfig
    if (target.scope !== 'group' && target.scope !== 'c2c') throw new Error(`未知的会话类型：${target.scope}`)
    if (!target.openid) throw new Error('缺少目标 openid')
    if (quotaExceeded(target) && options.ignoreDailyLimit !== true) {
      throw new Error(`今天给这个会话的主动消息已达到上限（${liveConfig.dailyLimit} 条），可在「连接与模型」里调高每日配额`)
    }
    const fileType = [1, 2, 3, 4].includes(Number(options.type)) ? Number(options.type) : 1
    const token = await getAccessToken(cfg)
    const base = String(cfg.apiBase || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
    const targetPath = target.scope === 'c2c'
      ? `/v2/users/${encodeURIComponent(target.openid)}`
      : `/v2/groups/${encodeURIComponent(target.openid)}`

    let payload
    let label
    if (typeof options.path === 'string' && options.path.trim().length > 0) {
      const absPath = resolve(options.path.trim())
      let info
      try {
        info = statSync(absPath)
      } catch {
        throw new Error(`本地文件不存在或不可读：${absPath}`)
      }
      if (!info.isFile()) throw new Error('本地路径不是文件')
      if (info.size > 5 * 1024 * 1024) throw new Error('本地文件超过 5MB，请改用可访问的 http(s) URL')
      payload = { file_type: fileType, file_name: basename(absPath), file_data: readFileSync(absPath).toString('base64') }
      label = basename(absPath)
    } else if (typeof options.data === 'string' && options.data.length > 0) {
      const data = options.data.replace(/^data:[^;]+;base64,/i, '')
      const size = Math.floor((data.length * 3) / 4)
      if (size > 5 * 1024 * 1024) throw new Error('上传文件超过 5MB，QQ 接口不接受')
      const fileName = String(options.fileName || 'upload').slice(0, 120)
      payload = { file_type: fileType, file_name: fileName, file_data: data }
      label = fileName
    } else {
      const url = String(options.url ?? '').trim()
      if (!/^https?:\/\//i.test(url)) throw new Error('请填写 http(s) 媒体 URL 或本地文件路径')
      payload = { file_type: fileType, url }
      label = url
    }

    const uploadRes = await fetch(`${base}${targetPath}/files`, {
      method: 'POST',
      headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json', 'user-agent': 'dsh-qq-free/1.6' },
      body: JSON.stringify({ ...payload, srv_send_msg: false }),
      signal: AbortSignal.timeout(60_000),
    })
    const uploadRaw = await uploadRes.text()
    let uploadBody = null
    try {
      uploadBody = JSON.parse(uploadRaw)
    } catch {
      uploadBody = null
    }
    if (!uploadRes.ok || !uploadBody || typeof uploadBody.file_info !== 'string') {
      const message = uploadBody?.message || uploadRaw.slice(0, 200)
      throw new Error(`媒体上传失败：HTTP ${uploadRes.status} ${message}`)
    }

    const sendRes = await fetch(`${base}${targetPath}/messages`, {
      method: 'POST',
      headers: { authorization: `QQBot ${token}`, 'content-type': 'application/json', 'user-agent': 'dsh-qq-free/1.6' },
      body: JSON.stringify({ media: { file_info: uploadBody.file_info }, msg_type: 7 }),
      signal: AbortSignal.timeout(30_000),
    })
    const sendRaw = await sendRes.text()
    let sendBody = null
    try {
      sendBody = JSON.parse(sendRaw)
    } catch {
      sendBody = null
    }
    if (!sendRes.ok) {
      const message = sendBody?.message || sendRaw.slice(0, 200)
      throw new Error(`媒体发送失败：HTTP ${sendRes.status} ${message}`)
    }
    const messageId = sendBody && typeof sendBody.id === 'string' ? sendBody.id : ''
    state.usage[`${todayKey()}|${targetKey(target)}`] = usageFor(target) + 1
    appendLog({
      at: new Date().toISOString(),
      scope: target.scope,
      openid: target.openid,
      name: target.name || (target.scope === 'c2c' ? '私聊' : '群聊'),
      text: `[${MEDIA_LABELS[fileType]}] ${label}`,
      ok: true,
      messageId,
      kind: 'media',
    })
    return { messageId, fileInfo: uploadBody.file_info, type: fileType, label }
  }

  async function sendTargets(input, text, meta = {}) {
    const targets = resolveTargets(input)
    const results = []
    for (const target of targets) {
      const sent = await sendText(target, text, meta)
      results.push({ target, messageId: sent.messageId })
    }
    return results
  }

  async function sendMediaTargets(input, options, caption, mention) {
    const targets = resolveTargets(input)
    const results = []
    for (const target of targets) {
      const media = await sendMedia(target, options)
      results.push({ target, messageId: media.messageId, label: media.label })
      if (typeof caption === 'string' && caption.trim().length > 0) {
        await sendText(target, caption, { kind: 'media-caption', mention })
      }
    }
    return results
  }

  // ── DeepSeek / LLM ───────────────────────────────────────────────────────

  function getLlm() {
    const llm = ctx.get('llm')
    if (!llm || typeof llm.stream !== 'function') {
      throw new Error('当前 profile 没有可用的 llm 服务，无法调用 DeepSeek')
    }
    return llm
  }

  function providerIds() {
    try {
      const llm = ctx.get('llm')
      if (!llm || typeof llm.listProviders !== 'function') return []
      const list = llm.listProviders()
      if (!Array.isArray(list)) return []
      return list
        .map((item) => (item && typeof item === 'object' ? { id: String(item.id ?? ''), name: String(item.name ?? item.id ?? '') } : null))
        .filter((item) => item !== null && item.id.length > 0)
    } catch {
      return []
    }
  }

  function personaText() {
    const persona = String(liveConfig.persona ?? '').trim()
    return persona.length > 0 ? persona : DEFAULT_PERSONA
  }

  const DEFAULT_CHAT_AGENT_PERSONA = '你是一个群聊里的智能体助手，像真人一样自然接话：简短、口语化、有自己的判断，不端着，不机械列点；聊闲天时轻松一点，别长篇大论，也不要主动暴露自己是模型。'

  /** 先用一个小模型调用判断：这句话是在提问/求助，还是纯闲聊。 */
  async function classifyQuestion(text) {
    const value = String(text ?? '').trim()
    if (value.length === 0) return false
    try {
      const result = await generateText({
        system: '你是意图分类器。判断用户这句话是不是在提问、求助或询问信息。只输出一个词：QUESTION 或 CHAT。',
        prompt: value,
        maxTokens: 8,
      })
      return /question/i.test(result)
    } catch {
      // 判断失败时保守地按提问处理，保证走 DeepSeek 回答
      return true
    }
  }

  /** 调用模型，返回纯文本。 */
  async function generateText({ system, prompt, maxTokens = 400 }) {
    const llm = getLlm()
    const provider = String(liveConfig.provider || 'deepseek-account')
    const model = String(liveConfig.model || 'deepseek-flash')
    let output = ''
    let failure = null
    const stream = llm.stream({
      provider,
      model,
      system,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      maxTokens,
    })
    for await (const chunk of stream) {
      if (chunk === null || typeof chunk !== 'object') continue
      if (chunk.type === 'text-delta' && typeof chunk.text === 'string') output += chunk.text
      if (chunk.type === 'finish' && chunk.reason && (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted')) {
        failure = chunk.reason.failure ?? { message: '模型调用失败', code: 'UNKNOWN' }
      }
    }
    if (failure !== null) {
      throw new Error(`DeepSeek 调用失败（${failure.code ?? 'ERROR'}）：${failure.message ?? '未知错误'}`)
    }
    const text = output.trim()
    if (text.length === 0) throw new Error('DeepSeek 没有返回文本')
    return text
  }

  function stripQuotes(text) {
    return text
      .replace(/^```[a-zA-Z]*\n?/, '')
      .replace(/```$/, '')
      .trim()
      .replace(/^["'“”‘’「」]+|["'“”‘’「」]+$/g, '')
      .trim()
  }

  async function composeLine(topic) {
    const subject = String(topic ?? '').trim()
    const prompt = subject.length > 0
      ? `现在轮到你在群里主动开口。围绕「${subject}」说一句话。要求：口语化、自然、不超过 60 字，不要 @ 任何人，不要解释你在做什么，不要加引号。`
      : '现在轮到你在群里主动开口。随便聊一个轻松的话题，或者抛出一个能让大家接话的问题。要求：口语化、自然、不超过 60 字，不要 @ 任何人，不要解释你在做什么，不要加引号。'
    return stripQuotes(await generateText({ system: personaText(), prompt, maxTokens: 200 }))
  }

  // ── 入群欢迎 / 群管理 ───────────────────────────────────────────────────

  async function sendWelcome(data) {
    if (!liveConfig.welcomeEnabled) return
    const groupOpenid = String(data.group_openid ?? '')
    const memberOpenid = String(data.member_openid ?? '')
    if (groupOpenid.length === 0) return
    const only = Array.isArray(liveConfig.welcomeGroups) ? liveConfig.welcomeGroups : []
    if (only.length > 0 && !only.includes(groupOpenid)) return
    let text = String(liveConfig.welcomeText ?? '').trim()
    if (text.length === 0) return
    text = text
      .replaceAll('{member_openid}', memberOpenid)
      .replaceAll('{group_openid}', groupOpenid)
      .replaceAll('{member}', memberOpenid)
    try {
      await sendText({ scope: 'group', openid: groupOpenid, name: '入群欢迎' }, text, { kind: 'welcome', ignoreDailyLimit: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      state.lastError = `欢迎消息发送失败：${message}`
      persistState()
      logger.warn(`qq-free: 欢迎消息发送失败: ${message}`)
    }
  }

  function recordJoinRequest(data) {
    const entry = {
      groupOpenid: String(data.group_openid ?? ''),
      memberOpenid: String(data.member_openid ?? ''),
      unionOpenid: String(data.union_openid ?? ''),
      joinRequestId: String(data.join_request_id ?? ''),
      username: String(data.username ?? ''),
      avatar: String(data.avatar ?? ''),
      applyAt: String(data.apply_at ?? ''),
      applySource: String(data.apply_source ?? ''),
      riskTips: String(data.risk_tips ?? ''),
      verifyMethod: String(data.verify_info?.method ?? ''),
      verifyMessage: String(data.verify_info?.verify_message ?? ''),
      verifyQa: Array.isArray(data.verify_info?.review_qa_list)
        ? data.verify_info.review_qa_list
          .map((item) => ({ question: String(item.question ?? ''), answer: String(item.answer ?? '') }))
          .filter((item) => item.question.length > 0 || item.answer.length > 0)
        : [],
      receivedAt: new Date().toISOString(),
    }
    if (entry.groupOpenid.length === 0 || entry.memberOpenid.length === 0) return
    const key = entry.joinRequestId.length > 0 ? entry.joinRequestId : `${entry.groupOpenid}:${entry.memberOpenid}`
    state.pendingJoins = state.pendingJoins.filter((item) => {
      const itemKey = String(item.joinRequestId ?? '').length > 0 ? item.joinRequestId : `${item.groupOpenid}:${item.memberOpenid}`
      return itemKey !== key
    })
    state.pendingJoins.push(entry)
    state.pendingJoins = state.pendingJoins.slice(-50)
    persistState()
    logger.info(`qq-free: 收到入群申请 ${entry.username || entry.memberOpenid}`)
    if (liveConfig.joinNoticeEnabled) {
      void sendJoinNotice(entry).catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        state.lastError = `入群申请通知发送失败：${message}`
        persistState()
        logger.warn(`qq-free: 入群申请通知发送失败: ${message}`)
      })
    }
  }

  function joinNoticeCode(entry) {
    return String(entry.joinRequestId || entry.memberOpenid || '').slice(0, 8).toUpperCase()
  }

  function formatApplyTime(value) {
    const text = String(value ?? '').trim()
    if (text.length === 0) return ''
    const date = new Date(text)
    if (Number.isNaN(date.getTime())) return text
    return date.toLocaleString('zh-CN', { hour12: false })
  }

  function joinNoticeText(entry, avatarIncluded) {
    const name = entry.username || entry.memberOpenid
    const lines = [
      '📥 新入群申请',
      `昵称：${name}`,
      `成员 openid：${entry.memberOpenid}`,
      `群 openid：${entry.groupOpenid}`,
    ]
    const appliedAt = formatApplyTime(entry.applyAt)
    if (appliedAt.length > 0) lines.push(`申请时间：${appliedAt}`)
    if (entry.verifyMessage) lines.push(`验证消息：${entry.verifyMessage}`)
    for (const qa of entry.verifyQa ?? []) {
      if (qa.question) lines.push(`问题：${qa.question}`)
      if (qa.answer) lines.push(`回答：${qa.answer}`)
    }
    if (entry.riskTips) lines.push(`提示：${entry.riskTips}`)
    if (!avatarIncluded && entry.avatar) lines.push(`头像：${entry.avatar}`)
    lines.push(`管理员在群里回复「同意 ${name}」或「拒绝 ${name}」处理；也可到 DSH 面板操作。`)
    return lines.join('\n')
  }

  /** 申请人的头像：事件不带时，尝试用用户信息接口补一次（失败就省略）。 */
  async function fetchJoinAvatar(entry) {
    for (const openid of [entry.memberOpenid, entry.unionOpenid]) {
      if (!openid) continue
      try {
        const info = await groupApi('GET', `/v2/users/${encodeURIComponent(openid)}/info`)
        if (info && typeof info.avatar === 'string' && info.avatar.length > 0) return info.avatar
      } catch {
        // 无好友关系 / 无权限时跳过
      }
    }
    return ''
  }

  async function sendGroupImage(groupOpenid, url) {
    await groupApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/files`, {
      file_type: 1,
      url,
      srv_send_msg: true,
    })
  }

  async function sendJoinNotice(entry) {
    if (!entry.avatar) {
      entry.avatar = await fetchJoinAvatar(entry)
      if (entry.avatar) persistState()
    }
    let avatarIncluded = false
    if (entry.avatar && liveConfig.joinNoticeAvatar !== false) {
      try {
        await sendGroupImage(entry.groupOpenid, entry.avatar)
        avatarIncluded = true
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        logger.warn(`qq-free: 申请头像发送失败，改为文字链接: ${message}`)
      }
    }
    await sendText(
      { scope: 'group', openid: entry.groupOpenid, name: '入群申请通知' },
      joinNoticeText(entry, avatarIncluded),
      { kind: 'join-notice', ignoreDailyLimit: true },
    )
  }

  /**
   * 群内管理员命令：同意 / 拒绝 [申请号]。
   * 返回给群里的被动回复文本；非命令返回 null。
   */
  async function handleMemberAdd(data) {
    const groupOpenid = String(data.group_openid ?? '')
    const memberOpenid = String(data.member_openid ?? '')
    if (groupOpenid.length > 0 && memberOpenid.length > 0) {
      const before = state.pendingJoins.length
      state.pendingJoins = state.pendingJoins.filter((item) => !(item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid))
      if (state.pendingJoins.length !== before) persistState()
    }
    await sendWelcome(data)
  }

  async function handleGroupCommand(data) {
    const role = String(data.author?.member_role ?? '')
    if (role !== 'admin' && role !== 'owner') return null
    const raw = String(data.content ?? '')
    const text = raw
      .replace(/<@!?[^>]+>/g, '')
      .replace(/\s+/g, ' ')
      .trim()

    // 群内 @ 成员做禁言 / 解禁 / 踢人（官方接口不提供 QQ 号到 openid 的映射）
    const modMatch = /^(禁言|解禁|解除禁言|踢人|踢出|移出)\s*(\d+)?$/u.exec(text)
    if (modMatch !== null) {
      const action = modMatch[1]
      const mentions = Array.isArray(data.mentions) ? data.mentions : []
      const targetMention = mentions.find((mention) => mention && mention.is_you !== true && mention.member_openid)
      const targetOpenid = String(targetMention?.member_openid ?? '')
      if (targetOpenid.length === 0) return '请 @ 要操作的成员，例如「禁言 @某人 60」。'
      const groupOpenid = String(data.group_openid ?? data.group_id ?? '')
      const groupPath = `/v2/groups/${encodeURIComponent(groupOpenid)}`
      if (action === '踢人' || action === '踢出' || action === '移出') {
        await groupApi('POST', `${groupPath}/batch_remove_members`, { member_openids: [targetOpenid] })
        appendLog({
          at: new Date().toISOString(), scope: 'group', openid: groupOpenid, name: '群管理',
          text: `踢出 ${targetOpenid}`, ok: true, kind: 'group-admin',
        })
        return `已移出 ${targetOpenid}。`
      }
      const mute = action === '禁言'
      const minutes = mute ? Math.max(1, Math.min(43200, Number(modMatch[2]) || 60)) : 0
      const member = mute
        ? { op: 'add', member_openid: targetOpenid, mute_expire_at: new Date(Date.now() + minutes * 60_000).toISOString() }
        : { op: 'del', member_openid: targetOpenid, mute_expire_at: '' }
      try {
        await groupApi('POST', `${groupPath}/restrict_chat_setting`, { members: [member] })
      } catch (error) {
        if (!mute) throw error
        await groupApi('POST', `${groupPath}/restrict_chat_setting`, { members: [{ ...member, op: 'update' }] })
      }
      appendLog({
        at: new Date().toISOString(), scope: 'group', openid: groupOpenid, name: '群管理',
        text: `${mute ? '禁言' : '解禁'} ${targetOpenid}${mute ? ` ${minutes} 分钟` : ''}`, ok: true, kind: 'group-admin',
      })
      return mute ? `已禁言 ${targetOpenid} ${minutes} 分钟。` : `已解除 ${targetOpenid} 的禁言。`
    }

    const match = /^(同意|通过|拒绝|不同意)\s*(\S+)?$/u.exec(text)
    if (match === null) return null
    const approve = match[1] === '同意' || match[1] === '通过'
    const token = String(match[2] ?? '').trim()
    const groupOpenid = String(data.group_openid ?? data.group_id ?? '')
    const pending = state.pendingJoins.filter((entry) => entry.groupOpenid === groupOpenid)
    if (pending.length === 0) return '当前没有待处理的入群申请。'
    let entry = null
    if (token.length > 0) {
      const upper = token.toUpperCase()
      const lower = token.toLowerCase()
      const matches = pending.filter((item) => joinNoticeCode(item) === upper
        || String(item.memberOpenid).toUpperCase().startsWith(upper)
        || (item.username && String(item.username).toLowerCase().includes(lower)))
      if (matches.length === 0) return `没有找到「${token}」对应的入群申请。`
      if (matches.length > 1) return `「${token}」匹配到多条入群申请，请用更完整的昵称或用 DSH 面板处理。`
      entry = matches[0]
    } else if (pending.length === 1) {
      entry = pending[0]
    } else {
      const lines = pending.map((item) => `· ${item.username || item.memberOpenid}`)
      return `有多条待处理申请，请带上昵称回复，例如「同意 ${pending[0].username || pending[0].memberOpenid}」：\n${lines.join('\n')}`
    }
    const operator = String(data.author?.member_nickname ?? data.author?.username ?? data.author?.member_openid ?? '管理员')
    await groupApi('POST', `/v2/groups/${encodeURIComponent(groupOpenid)}/approval_join_request/${encodeURIComponent(entry.memberOpenid)}`, {
      op: approve ? 'approve' : 'decline',
      ...(entry.joinRequestId ? { join_request_id: entry.joinRequestId } : {}),
      ...(approve ? {} : { reject_reason: `管理员 ${operator} 在群内拒绝` }),
    })
    state.pendingJoins = state.pendingJoins.filter((item) => item !== entry)
    state.lastApproval = {
      at: new Date().toISOString(),
      operator,
      action: approve ? 'approve' : 'decline',
      memberOpenid: entry.memberOpenid,
      username: entry.username || '',
      groupOpenid,
    }
    persistState()
    appendLog({
      at: new Date().toISOString(),
      scope: 'group',
      openid: groupOpenid,
      name: '入群审批',
      text: `${operator} ${approve ? '通过' : '拒绝'} ${entry.username || entry.memberOpenid}`,
      ok: true,
      kind: 'join-approval',
    })
    return `已由 ${operator} ${approve ? '通过' : '拒绝'} ${entry.username || entry.memberOpenid} 的入群申请。`
  }

  async function groupApi(method, path, body) {
    const cfg = liveConfig
    const token = await getAccessToken(cfg)
    const base = String(cfg.apiBase || 'https://api.sgroup.qq.com').replace(/\/+$/, '')
    const response = await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `QQBot ${token}`,
        'content-type': 'application/json',
        'user-agent': 'dsh-qq-free/1.3',
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
      const code = parsed && (parsed.code ?? parsed.err_code)
      const message = (parsed && parsed.message) || text.slice(0, 200) || response.statusText
      const hint = code === 40103011 || code === 40103012
        ? '（需要群主在群设置/管理端给机器人打开对应权限）'
        : ''
      throw new Error(`群管理接口失败：HTTP ${response.status} ${message}${code !== undefined ? `（${code}）` : ''}${hint}`)
    }
    return parsed ?? {}
  }

  function assertGroupOpenid(value) {
    const groupOpenid = String(value ?? '').trim()
    if (!/^[A-Za-z0-9_-]{8,}$/.test(groupOpenid)) throw new Error('group_openid 不合法')
    return groupOpenid
  }

  function assertMemberOpenid(value) {
    const memberOpenid = String(value ?? '').trim()
    if (/^\d{5,12}$/.test(memberOpenid)) {
      throw new Error('官方接口不支持直接填 QQ 号：请用 member_openid，或在群里发「禁言 @某人 60」/「踢人 @某人」')
    }
    if (!/^[A-Za-z0-9_-]{8,}$/.test(memberOpenid)) throw new Error('member_openid 不合法')
    return memberOpenid
  }

  async function handleGroupModeration({ groupOpenid, messageId, memberOpenid, memberName, memberRole, content }) {
    if (!liveConfig.moderationEnabled) return null
    const groups = Array.isArray(liveConfig.moderationGroups) ? liveConfig.moderationGroups : []
    if (!groups.includes(groupOpenid)) return null
    if (memberRole === 'admin' || memberRole === 'owner') return null
    const words = (Array.isArray(liveConfig.bannedWords) ? liveConfig.bannedWords : [])
      .map((word) => String(word).trim().toLowerCase())
      .filter(Boolean)
    if (words.length === 0) return null
    const text = String(content ?? '').toLowerCase()
    const hit = words.find((word) => text.includes(word))
    if (!hit) return null

    const key = `${groupOpenid}:${memberOpenid}`
    const previous = state.strikes[key]
    const count = (Number(previous?.count) || 0) + 1
    state.strikes[key] = {
      count,
      name: memberName || memberOpenid,
      memberOpenid,
      groupOpenid,
      lastAt: new Date().toISOString(),
      lastWord: hit,
    }
    persistState()

    const groupPath = `/v2/groups/${encodeURIComponent(groupOpenid)}`
    try {
      await groupApi('DELETE', `${groupPath}/messages/${encodeURIComponent(messageId)}`)
    } catch (error) {
      logger.warn(`qq-free: 撤回违规消息失败: ${error instanceof Error ? error.message : String(error)}`)
    }

    const name = memberName || memberOpenid
    let reply = ''
    try {
      if (count === 1) {
        reply = `⚠️ ${name} 的消息含违禁词，已撤回（第 1 次，再犯将禁言）。`
      } else if (count === 2) {
        const minutes = Math.max(1, Math.min(43200, Number(liveConfig.moderationMuteMinutes) || 10))
        const member = {
          op: 'add',
          member_openid: memberOpenid,
          mute_expire_at: new Date(Date.now() + minutes * 60_000).toISOString(),
        }
        try {
          await groupApi('POST', `${groupPath}/restrict_chat_setting`, { members: [member] })
        } catch {
          await groupApi('POST', `${groupPath}/restrict_chat_setting`, { members: [{ ...member, op: 'update' }] })
        }
        reply = `⚠️ ${name} 的消息含违禁词，已撤回并禁言 ${minutes} 分钟（第 2 次）。`
      } else {
        await groupApi('POST', `${groupPath}/batch_remove_members`, { member_openids: [memberOpenid] })
        reply = `⚠️ ${name} 的消息含违禁词，已撤回并移出群聊（第 3 次）。`
        delete state.strikes[key]
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      reply = `⚠️ ${name} 的消息含违禁词，已撤回；后续处理失败：${message}`
    }
    persistState()
    appendLog({
      at: new Date().toISOString(),
      scope: 'group',
      openid: groupOpenid,
      name: '违禁词',
      text: `${name} 第 ${count} 次命中「${hit}」`,
      ok: true,
      kind: 'moderation',
    })
    return { handled: true, reply, count }
  }

  function isMemberBlocked(groupOpenid, memberOpenid) {
    return state.blockedMembers.some((item) => item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid)
  }

  function isMentionBlocked(groupOpenid, mentions) {
    if (!Array.isArray(mentions) || mentions.length === 0) return false
    return mentions.some((mention) => {
      if (!mention || mention.is_you === true) return false
      const openid = String(mention.member_openid ?? '')
      return openid.length > 0 && state.blockedMentions.some((item) => item.groupOpenid === groupOpenid && item.memberOpenid === openid)
    })
  }

  function handleBlocklist(body) {
    const action = String(body.action ?? 'list')
    if (action === 'add' || action === 'add-mention') {
      const target = action === 'add-mention' ? state.blockedMentions : state.blockedMembers
      const groupOpenid = assertGroupOpenid(body.groupOpenid)
      const memberOpenid = assertMemberOpenid(body.memberOpenid)
      const name = String(body.name ?? '').trim().slice(0, 60)
      const existing = target.find((item) => item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid)
      if (existing) {
        existing.name = name || existing.name
      } else {
        target.push({ groupOpenid, memberOpenid, name, addedAt: new Date().toISOString() })
      }
      if (target.length > 500) target.splice(0, target.length - 500)
      persistState()
      return { added: true }
    }
    if (action === 'remove' || action === 'remove-mention') {
      const target = action === 'remove-mention' ? state.blockedMentions : state.blockedMembers
      const groupOpenid = String(body.groupOpenid ?? '')
      const memberOpenid = String(body.memberOpenid ?? '')
      const before = target.length
      const filtered = target.filter((item) => !(item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid))
      if (filtered.length === before) throw new Error('没有找到这条屏蔽记录')
      if (action === 'remove-mention') state.blockedMentions = filtered
      else state.blockedMembers = filtered
      persistState()
      return { removed: true }
    }
    return { list: state.blockedMembers, mentions: state.blockedMentions }
  }

  async function handleGroupAdmin(body) {
    const action = String(body.action ?? '')
    const groupOpenid = assertGroupOpenid(body.groupOpenid)
    const groupPath = `/v2/groups/${encodeURIComponent(groupOpenid)}`

    if (action === 'list') {
      const data = await groupApi('GET', `${groupPath}/join_request_list?limit=20`)
      const list = Array.isArray(data.list) ? data.list : []
      const now = new Date().toISOString()
      for (const item of list) {
        const joinRequestId = String(item.join_request_id ?? '')
        const memberOpenid = String(item.member_openid ?? '')
        if (memberOpenid.length === 0) continue
        const existing = state.pendingJoins.find((entry) => entry.groupOpenid === groupOpenid
          && ((joinRequestId.length > 0 && entry.joinRequestId === joinRequestId)
            || (joinRequestId.length === 0 && entry.memberOpenid === memberOpenid)))
        if (existing) {
          existing.username = String(item.username ?? existing.username)
          existing.applyAt = String(item.apply_at ?? existing.applyAt)
          existing.verifyMessage = String(item.verify_info?.verify_message ?? existing.verifyMessage ?? '')
        } else {
          state.pendingJoins.push({
            groupOpenid,
            memberOpenid,
            unionOpenid: String(item.union_openid ?? ''),
            joinRequestId,
            username: String(item.username ?? ''),
            avatar: '',
            applyAt: String(item.apply_at ?? ''),
            applySource: String(item.apply_source ?? ''),
            riskTips: String(item.risk_tips ?? ''),
            verifyMethod: String(item.verify_info?.method ?? ''),
            verifyMessage: String(item.verify_info?.verify_message ?? ''),
            verifyQa: [],
            receivedAt: now,
          })
        }
      }
      persistState()
      return { list }
    }

    if (action === 'approve' || action === 'decline' || action === 'forget') {
      const memberOpenid = assertMemberOpenid(body.memberOpenid)
      if (action === 'forget') {
        state.pendingJoins = state.pendingJoins.filter((item) => !(item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid))
        persistState()
        return { forgotten: true }
      }
      const operator = String(body.operator ?? '管理员').trim().slice(0, 60) || '管理员'
      const payload = {
        op: action === 'approve' ? 'approve' : 'decline',
        ...(body.joinRequestId ? { join_request_id: String(body.joinRequestId) } : {}),
        ...(action === 'decline' && body.rejectReason ? { reject_reason: String(body.rejectReason).slice(0, 200) } : {}),
        ...(action === 'decline' && body.blacklist === true ? { add_to_member_blacklist: true } : {}),
      }
      await groupApi('POST', `${groupPath}/approval_join_request/${encodeURIComponent(memberOpenid)}`, payload)
      const entry = state.pendingJoins.find((item) => item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid)
      state.pendingJoins = state.pendingJoins.filter((item) => !(item.groupOpenid === groupOpenid && item.memberOpenid === memberOpenid))
      state.lastApproval = {
        at: new Date().toISOString(),
        operator,
        action: action === 'approve' ? 'approve' : 'decline',
        memberOpenid,
        username: entry?.username ?? '',
        groupOpenid,
      }
      persistState()
      appendLog({
        at: new Date().toISOString(),
        scope: 'group',
        openid: groupOpenid,
        name: '入群审批',
        text: `${operator} ${action === 'approve' ? '通过' : '拒绝'} ${entry?.username || memberOpenid}`,
        ok: true,
        kind: 'join-approval',
      })
      return { approved: action === 'approve', operator }
    }

    if (action === 'mutes') {
      return { mutes: await groupApi('GET', `${groupPath}/restrict_chat_setting`) }
    }

    if (action === 'mute' || action === 'unmute') {
      const memberOpenid = assertMemberOpenid(body.memberOpenid)
      const minutes = action === 'unmute' ? 0 : Math.max(1, Math.min(43200, Math.round(Number(body.minutes) || 0)))
      const muteExpireAt = minutes > 0 ? new Date(Date.now() + minutes * 60_000).toISOString() : ''
      const member = {
        op: action === 'unmute' ? 'del' : 'add',
        member_openid: memberOpenid,
        ...(minutes > 0 ? { mute_expire_at: muteExpireAt } : { mute_expire_at: '' }),
      }
      try {
        await groupApi('POST', `${groupPath}/restrict_chat_setting`, { members: [member] })
      } catch (error) {
        if (action === 'mute') {
          // 已在禁言中的成员用 update 更新到期时间
          await groupApi('POST', `${groupPath}/restrict_chat_setting`, {
            members: [{ ...member, op: 'update' }],
          })
        } else {
          throw error
        }
      }
      return { muted: action === 'mute', muteExpireAt }
    }

    if (action === 'kick') {
      const memberOpenid = assertMemberOpenid(body.memberOpenid)
      const result = await groupApi('POST', `${groupPath}/batch_remove_members`, {
        member_openids: [memberOpenid],
        ...(body.blacklist === true ? { add_to_member_blacklist: true } : {}),
      })
      return { result }
    }

    throw new Error(`未知群管理操作：${action}`)
  }

  // ── QQ AI 对话通道 ───────────────────────────────────────────────────────

  const chatChannel = createChatChannel({
    getConfig: () => liveConfig,
    getAccessToken: () => getAccessToken(liveConfig),
    searchQa: (question) => findQaMatch(question),
    recordQaHit: (entry) => {
      entry.hits = (Number(entry.hits) || 0) + 1
      saveQa()
    },
    classifyQuestion: (text) => classifyQuestion(text),
    generateReply: async ({ question, history, persona, mode, chatPersona }) => {
      const transcript = history
        .slice(-12)
        .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${message.text}`)
        .join('\n')
      const isChat = mode === 'chat'
      const system = isChat
        ? (String(chatPersona ?? '').trim() || DEFAULT_CHAT_AGENT_PERSONA)
        : (String(persona ?? '').trim() || personaText())
      const instruction = isChat
        ? '这是群聊里的闲聊，用你的智能体人设自然接一句，只输出回复本身，不要解释。'
        : '对方在提问，请准确、简洁地回答，只输出回答本身，不要寒暄。'
      const prompt = transcript.length > 0
        ? `以下是这段 QQ 对话的历史：\n${transcript}\n用户：${question}\n${instruction}`
        : `${question}\n${instruction}`
      return generateText({ system, prompt, maxTokens: 600 })
    },
    onReply: (entry) => recordChatReply(entry),
    onMemberAdd: (data) => handleMemberAdd(data),
    onJoinRequest: (data) => recordJoinRequest(data),
    onGroupCommand: (data) => handleGroupCommand(data),
    onMemberSeen: (data) => rememberMember(data),
    onGroupModeration: (data) => handleGroupModeration(data),
    onMemberBlocked: (data) => isMemberBlocked(data.groupOpenid, data.memberOpenid),
    onMentionBlocked: (data) => isMentionBlocked(data.groupOpenid, data.mentions),
    logger,
  })

  ctx.effect(() => {
    if (liveConfig.chatEnabled) {
      try {
        chatChannel.start()
      } catch (error) {
        logger.warn(`qq-free: AI 对话通道启动失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return () => chatChannel.stop()
  }, 'qq-free.chat-channel')

  const remoteApi = {
    targets(body) {
      const action = String(body.action ?? 'add')
      if (action === 'add') {
        const scope = body.scope === 'c2c' ? 'c2c' : 'group'
        const openid = String(body.openid ?? '').trim()
        if (!/^[A-Za-z0-9_-]{8,}$/.test(openid)) throw new Error('openid 不合法')
        const target = upsertTarget({ scope, openid, name: String(body.name ?? '').slice(0, 60) })
        if (!liveConfig.defaultTarget) saveConfigPatch({ defaultTarget: target.id })
        persistState()
        return { target }
      }
      if (action === 'remove') {
        const id = String(body.id ?? '')
        state.targets = state.targets.filter((target) => target.id !== id)
        state.boards = state.boards.map((board) => ({ ...board, targetIds: board.targetIds.filter((targetId) => targetId !== id) }))
        if (liveConfig.defaultTarget === id) saveConfigPatch({ defaultTarget: '' })
        persistState()
        return { removed: true }
      }
      throw new Error('未知操作')
    },
    boards(body) {
      const action = String(body.action ?? 'add')
      if (action === 'add') {
        const name = String(body.name ?? '').trim().slice(0, 40)
        const targetIds = Array.isArray(body.targetIds) ? body.targetIds.map((id) => String(id)) : []
        if (name.length === 0) throw new Error('板块名称不能为空')
        if (targetIds.length < 1 || targetIds.length > 3) throw new Error('板块需要 1–3 个群聊')
        const targets = targetIds.map((id) => findTarget(id)).filter((target) => target !== null)
        if (targets.length !== targetIds.length || targets.some((target) => target.scope !== 'group')) throw new Error('板块只能包含有效的群聊')
        const board = { id: `board-${Date.now().toString(36)}`, name, targetIds, createdAt: new Date().toISOString() }
        state.boards.push(board)
        persistState()
        return { board }
      }
      if (action === 'remove') {
        state.boards = state.boards.filter((board) => board.id !== String(body.id ?? ''))
        persistState()
        return { removed: true }
      }
      throw new Error('未知操作')
    },
    async auto(body) {
      if (body.run === true) return runAuto(true)
      saveConfigPatch({
        autoEnabled: body.enabled === true,
        autoTarget: String(body.targetId ?? ''),
        autoIntervalMinutes: Math.max(1, Math.min(1440, Number(body.intervalMinutes) || 120)),
        autoTopics: String(body.topics ?? '').slice(0, 2000),
      })
      return { saved: true }
    },
    qa(body) {
      const action = String(body.action ?? 'list')
      if (action === 'add') {
        const question = String(body.question ?? '').trim()
        const answer = String(body.answer ?? '').trim()
        if (question.length === 0 || answer.length === 0) throw new Error('问题和答案都要填')
        const entry = {
          id: `qa-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          question,
          answer,
          keywords: String(body.keywords ?? '').split(/[,，、\s]+/).filter(Boolean).slice(0, 10),
          enabled: true,
          hits: 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        }
        qa.unshift(entry)
        saveQa()
        return { entry }
      }
      if (action === 'remove') {
        const id = String(body.id ?? '')
        const before = qa.length
        qa = qa.filter((entry) => entry.id !== id)
        if (qa.length === before) throw new Error('没有找到这条问答')
        saveQa()
        return { removed: true }
      }
      if (action === 'lookup') return { match: findQaMatch(String(body.question ?? '')) }
      return { list: qa }
    },
    channel(body) {
      const enabled = body.enabled === true
      if (enabled && body.confirm !== true) throw new Error('启用通道前要先停用官方 QQ 插件，请确认')
      const patch = { chatEnabled: enabled }
      if (typeof body.persona === 'string') patch.chatPersona = body.persona.slice(0, 4000)
      if (typeof body.agentPersona === 'string') patch.chatAgentPersona = body.agentPersona.slice(0, 4000)
      if (typeof body.useQa === 'boolean') patch.chatUseQa = body.useQa
      saveConfigPatch(patch)
      if (enabled) chatChannel.start()
      else chatChannel.stop()
      return { enabled }
    },
    groupAdmin(body) {
      return handleGroupAdmin(body)
    },
    'group-admin'(body) {
      return handleGroupAdmin(body)
    },
    blocklist(body) {
      return handleBlocklist(body)
    },
    moderation(body) {
      if (String(body.action ?? 'save') === 'reset') {
        if (typeof body.key === 'string' && body.key.length > 0) delete state.strikes[body.key]
        else state.strikes = {}
        persistState()
        return { reset: true }
      }
      saveConfigPatch({
        moderationEnabled: body.enabled === true,
        bannedWords: Array.isArray(body.words) ? body.words : String(body.words ?? '').split(/[\n,，、]+/),
        moderationGroups: Array.isArray(body.groups) ? body.groups : String(body.groups ?? '').split(/[\n,，、\s]+/),
        moderationMuteMinutes: Number(body.muteMinutes) || 10,
      })
      return { saved: true }
    },
    welcome(body) {
      saveConfigPatch({
        welcomeEnabled: body.enabled === true,
        welcomeText: String(body.text ?? '').slice(0, 500),
        welcomeGroups: Array.isArray(body.groups) ? body.groups : String(body.groups ?? '').split(/[\n,，、\s]+/),
        joinNoticeEnabled: body.joinNoticeEnabled === true,
        joinNoticeAvatar: body.joinNoticeAvatar === true,
      })
      return { saved: true }
    },
    async cloud(body) {
      const action = String(body.action ?? 'status')
      if (action === 'save') {
        const patch = {
          cloudEnabled: body.enabled === true,
          cloudUrl: String(body.url ?? '').trim(),
          cloudUser: String(body.user ?? '').trim(),
          cloudAuto: body.auto !== false,
        }
        if (typeof body.password === 'string' && body.password.length > 0) patch.cloudPass = body.password
        if (body.clearPassword === true) patch.cloudPass = ''
        saveConfigPatch(patch)
        return { saved: true }
      }
      if (action === 'push') return cloud.push()
      if (action === 'pull') return cloud.pull()
      if (action === 'test') return cloud.test()
      return { status: cloud.status() }
    },
    async github(body) {
      const action = String(body.action ?? 'status')
      if (action === 'save') {
        const patch = {
          githubEnabled: body.enabled === true,
          githubOwner: String(body.owner ?? '').trim(),
          githubRepo: String(body.repo ?? '').trim(),
          githubAuto: body.auto !== false,
        }
        if (typeof body.token === 'string' && body.token.length > 0) patch.githubToken = body.token.trim()
        if (body.clearToken === true) patch.githubToken = ''
        saveConfigPatch(patch)
        return { saved: true }
      }
      if (action === 'push') return githubSync.pushAll()
      return { status: githubSync.status() }
    },
  }

  const remoteServer = createRemoteServer({
    getConfig: () => liveConfig,
    sendTargets: (input, text, meta) => sendTargets(input, text, meta),
    composeLine: (topic) => composeLine(topic),
    sendMediaTargets: (input, options, caption, mention) => sendMediaTargets(input, options, caption, mention),
    snapshot: () => snapshot(),
    api: remoteApi,
    logger,
  })

  ctx.effect(() => {
    if (liveConfig.webEnabled) remoteServer.start()
    return () => remoteServer.stop()
  }, 'qq-free.remote')

  const githubSync = createGitHubSync({
    pluginDir: PLUGIN_DIR,
    getConfig: () => liveConfig,
    logger,
  })

  const cloud = createCloudSync({
    pluginDir: PLUGIN_DIR,
    getConfig: () => liveConfig,
    logger,
    onFileChange: (name) => githubSync.schedule(name),
  })

  ctx.effect(() => {
    cloud.start()
    return () => cloud.stop()
  }, 'qq-free.cloud')

  // ── 目标（会话）管理 ─────────────────────────────────────────────────────

  function findTarget(idOrKey) {
    if (!idOrKey) return null
    return state.targets.find((t) => t.id === idOrKey || targetKey(t) === idOrKey) ?? null
  }

  function resolveTarget(input) {
    if (input && typeof input === 'object' && typeof input.openid === 'string' && input.openid.length > 0) {
      const scope = input.scope === 'c2c' ? 'c2c' : 'group'
      return { scope, openid: input.openid, name: String(input.name ?? '') }
    }
    const text = String(input ?? '').trim()
    if (text.length === 0) {
      const fallback = findTarget(liveConfig.defaultTarget) ?? state.targets[0] ?? null
      if (fallback === null) throw new Error('还没有可用的会话目标，请先在「会话目标」里添加一个群或私聊')
      return { scope: fallback.scope, openid: fallback.openid, name: fallback.name }
    }
    const saved = findTarget(text)
    if (saved !== null) return { scope: saved.scope, openid: saved.openid, name: saved.name }
    if (/^(group|c2c)-[a-z0-9]+$/i.test(text)) {
      throw new Error('这个会话目标已经不存在了，请刷新页面重新选择')
    }
    const direct = /^(group|c2c):(.+)$/.exec(text)
    if (direct !== null) return { scope: direct[1], openid: direct[2].trim(), name: '' }
    return { scope: 'group', openid: text, name: '' }
  }

  function findBoard(input) {
    const value = String(input ?? '').trim()
    if (value.length === 0) return null
    return state.boards.find((board) => board.id === value || board.name === value) ?? null
  }

  /** 目标可以是单个会话，也可以是板块（1–3 个群）。 */
  function resolveTargets(input) {
    const board = findBoard(input)
    if (board !== null) {
      const targets = board.targetIds
        .map((id) => findTarget(id))
        .filter((target) => target !== null)
      if (targets.length === 0) throw new Error('这个板块里没有有效的群聊目标')
      return targets
    }
    return [resolveTarget(input)]
  }

  function resolveSavedTargets(preferred) {
    const board = findBoard(preferred)
    if (board !== null) return resolveTargets(board.id)
    if (preferred) {
      const saved = findTarget(preferred)
      if (saved === null) throw new Error('自动发言的目标已经不存在了，请在「自动发言」里重新选择')
      return [{ scope: saved.scope, openid: saved.openid, name: saved.name }]
    }
    const fallback = findTarget(liveConfig.defaultTarget) ?? state.targets[0] ?? null
    if (fallback === null) throw new Error('还没有可用的会话目标，请先在「会话目标」里添加一个群或私聊')
    return [{ scope: fallback.scope, openid: fallback.openid, name: fallback.name }]
  }

  function upsertTarget(target) {
    const existing = state.targets.find((t) => t.scope === target.scope && t.openid === target.openid)
    if (existing !== undefined) {
      if (target.name) existing.name = target.name
      return existing
    }
    const created = {
      id: `${target.scope}-${Date.now().toString(36)}`,
      scope: target.scope,
      openid: target.openid,
      name: target.name || (target.scope === 'c2c' ? 'QQ 私聊' : 'QQ 群'),
      addedAt: new Date().toISOString(),
    }
    state.targets.push(created)
    persistState()
    return created
  }

  // ── 自动发言 ─────────────────────────────────────────────────────────────

  let autoBusy = false
  let lastAutoError = ''

  function autoDue(now = Date.now()) {
    const interval = Math.max(1, Number(liveConfig.autoIntervalMinutes) || 0) * 60_000
    return now - (Number(state.lastAutoAt) || 0) >= interval
  }

  async function runAuto(force = false) {
    if (autoBusy) return { ok: false, error: '自动发言正在执行' }
    if (!liveConfig.autoEnabled && !force) return { ok: false, error: '自动发言未开启' }
    if (!force && inQuietHours(liveConfig)) return { ok: false, error: '处于静默时段' }
    if (!force && !autoDue()) return { ok: false, error: '还没到下一句的时间' }
    const targets = resolveSavedTargets(liveConfig.autoTarget || liveConfig.defaultTarget)
    const available = targets.filter((target) => !quotaExceeded(target))
    if (available.length === 0) {
      lastAutoError = '已达到今日主动消息配额'
      return { ok: false, error: lastAutoError }
    }
    autoBusy = true
    try {
      const text = await composeLine(liveConfig.autoTopics)
      const sent = []
      let lastFailure = ''
      for (const target of available) {
        try {
          const result = await sendText(target, text, { kind: 'auto' })
          sent.push({ target, messageId: result.messageId })
        } catch (error) {
          lastFailure = error instanceof Error ? error.message : String(error)
        }
      }
      if (sent.length === 0) throw new Error(lastFailure || '自动发言发送失败')
      state.lastAutoAt = Date.now()
      lastAutoError = lastFailure
      persistState()
      logger.info(`qq-free: 自动发言 → ${sent.map((item) => `${item.target.scope}:${item.target.openid}`).join(', ')}`)
      return { ok: true, text, target: sent[0].target, targets: sent.map((item) => item.target) }
    } catch (error) {
      lastAutoError = error instanceof Error ? error.message : String(error)
      rememberError(lastAutoError)
      logger.warn(`qq-free: 自动发言失败: ${lastAutoError}`)
      return { ok: false, error: lastAutoError }
    } finally {
      autoBusy = false
    }
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      if (!liveConfig.autoEnabled || autoBusy) return
      if (inQuietHours(liveConfig)) return
      if (!autoDue()) return
      void runAuto(false)
    }, 30_000)
    timer.unref?.()
    return () => clearInterval(timer)
  }, 'qq-free.auto-timer')

  // ── HTTP 路由 ────────────────────────────────────────────────────────────

  function snapshot() {
    const cfg = liveConfig
    const llm = ctx.get('llm')
    const providers = providerIds()
    const today = todayKey()
    const usage = state.targets.map((target) => ({
      id: target.id,
      key: targetKey(target),
      used: Number(state.usage[`${today}|${targetKey(target)}`]) || 0,
    }))
    const autoTarget = findTarget(cfg.autoTarget) ?? findTarget(cfg.defaultTarget) ?? null
    const nextAt = state.lastAutoAt
      ? new Date(Number(state.lastAutoAt) + Math.max(1, Number(cfg.autoIntervalMinutes) || 0) * 60_000).toISOString()
      : null
    return {
      ok: true,
      credential: {
        configured: Boolean(cfg.appId && cfg.appSecret),
        appId: cfg.appId || '',
        source: credentialSource,
      },
      model: {
        provider: cfg.provider || '',
        model: cfg.model || '',
        available: Boolean(llm && typeof llm.stream === 'function'),
        providers,
      },
      persona: cfg.persona || '',
      defaultTarget: cfg.defaultTarget || '',
      targets: state.targets,
      auto: {
        enabled: Boolean(cfg.autoEnabled),
        targetId: autoTarget ? autoTarget.id : '',
        targetLabel: autoTarget ? `${autoTarget.name}（${autoTarget.scope === 'c2c' ? '私聊' : '群聊'}）` : '',
        intervalMinutes: Number(cfg.autoIntervalMinutes) || 0,
        topics: cfg.autoTopics || '',
        lastAt: state.lastAutoAt ? new Date(Number(state.lastAutoAt)).toISOString() : null,
        nextAt,
        quiet: inQuietHours(cfg),
        error: lastAutoError,
      },
      limits: {
        dailyLimit: Number(cfg.dailyLimit) || 0,
        quietHoursStart: cfg.quietHoursStart,
        quietHoursEnd: cfg.quietHoursEnd,
        maxText: MAX_TEXT,
      },
      usage,
      qa: qaStats(),
      chat: {
        enabled: Boolean(liveConfig.chatEnabled),
        persona: liveConfig.chatPersona || '',
        agentPersona: liveConfig.chatAgentPersona || '',
        useQa: liveConfig.chatUseQa === true,
        ...chatChannel.status(),
      },
      welcome: {
        enabled: Boolean(liveConfig.welcomeEnabled),
        text: liveConfig.welcomeText || '',
        groups: Array.isArray(liveConfig.welcomeGroups) ? liveConfig.welcomeGroups : [],
        joinNoticeEnabled: Boolean(liveConfig.joinNoticeEnabled),
        joinNoticeAvatar: liveConfig.joinNoticeAvatar !== false,
      },
      pendingJoins: state.pendingJoins.slice(-30).reverse(),
      blockedMembers: state.blockedMembers.slice(-100),
      blockedMentions: state.blockedMentions.slice(-100),
      boards: state.boards.map((board) => ({
        id: board.id,
        name: board.name,
        targetIds: board.targetIds,
        count: board.targetIds.length,
        targets: board.targetIds
          .map((id) => findTarget(id))
          .filter((target) => target !== null)
          .map((target) => ({ id: target.id, name: target.name, openid: target.openid })),
      })),
      moderation: {
        enabled: Boolean(liveConfig.moderationEnabled),
        groups: Array.isArray(liveConfig.moderationGroups) ? liveConfig.moderationGroups : [],
        words: Array.isArray(liveConfig.bannedWords) ? liveConfig.bannedWords : [],
        muteMinutes: Number(liveConfig.moderationMuteMinutes) || 10,
        strikes: Object.entries(state.strikes)
          .map(([key, value]) => ({ key, ...value }))
          .sort((left, right) => (Number(right.count) || 0) - (Number(left.count) || 0))
          .slice(0, 50),
      },
      lastApproval: state.lastApproval,
      chatLog: state.chatLog.slice(-50).reverse().map((entry) => ({ ...entry, atLabel: formatTime(entry.at) })),
      replyLogPath: state.replyLogPath || resolveReplyLogFile(),
      replyLogFile: liveConfig.replyLogFile || 'qq-replies.md',
      remote: {
        enabled: Boolean(liveConfig.webEnabled),
        port: Number(liveConfig.webPort) || 8788,
        token: liveConfig.webToken || '',
        urls: remoteUrls(Number(liveConfig.webPort) || 8788, liveConfig.webToken || ''),
        ...remoteServer.status(),
      },
      cloud: cloud.status(),
      github: githubSync.status(),
      members: state.members.slice(-200).map((item) => ({
        groupOpenid: item.groupOpenid,
        openid: item.openid,
        name: item.name,
        role: item.role,
      })),
      log: state.log.slice(-80).reverse().map((entry) => ({ ...entry, atLabel: formatTime(entry.at) })),
      lastError: state.lastError,
      dataDir: DATA_DIR,
    }
  }

  function sendJson(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }

  function trusted(req) {
    const origin = req.headers.origin
    if (origin === undefined) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  async function readJsonBody(req, limit = 64 * 1024) {
    const chunks = []
    let size = 0
    for await (const chunk of req) {
      size += chunk.length
      if (size > limit) throw new Error('请求体过大')
      chunks.push(chunk)
    }
    if (size === 0) return {}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  }

  function route(handler) {
    return async (req, res) => {
      if (!trusted(req)) {
        sendJson(res, 403, { ok: false, error: 'forbidden' })
        return
      }
      try {
        await handler(req, res)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        sendJson(res, 400, { ok: false, error: message })
      }
    }
  }

  function requirePost(req, res) {
    if (req.method === 'POST') return true
    sendJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }

  ctx.inject(['webServer'], (scoped) => {
    const webServer = scoped.webServer
    if (!webServer || typeof webServer.register !== 'function') return () => {}
    const disposers = []

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/state',
      handler: route((req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: 'method not allowed' })
          return
        }
        reloadConfig()
        sendJson(res, 200, snapshot())
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/config',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const submitted = body && typeof body === 'object' && body.config && typeof body.config === 'object' ? body.config : body
        const known = pickConfig(submitted)
        const unknown = Object.keys(submitted ?? {}).filter((key) => !EDITABLE_KEYS.has(key))
        if (unknown.length > 0) {
          sendJson(res, 400, { ok: false, error: `不支持的字段：${unknown.join(', ')}` })
          return
        }
        const current = pickConfig(readJson(CONFIG_FILE, {}))
        const next = { ...current, ...known }
        if (!writeJson(CONFIG_FILE, next)) {
          sendJson(res, 500, { ok: false, error: `无法写入配置文件：${CONFIG_FILE}` })
          return
        }
        reloadConfig()
        sendJson(res, 200, { ok: true, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/targets',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const action = String(body.action ?? 'add')
        if (action === 'add') {
          const raw = body.target ?? body
          const target = resolveTarget({
            scope: raw.scope,
            openid: String(raw.openid ?? '').trim(),
            name: String(raw.name ?? '').trim(),
          })
          if (!target.openid) throw new Error('openid 不能为空')
          if (!/^\d{6,}$/.test(target.openid) && !/^[A-Za-z0-9_-]{8,}$/.test(target.openid)) {
            throw new Error('openid 看起来不合法：官方开放平台的群 / 用户 openid 通常是长串十六进制或大写字母数字')
          }
          const saved = upsertTarget(target)
          if (!liveConfig.defaultTarget) {
            const current = pickConfig(readJson(CONFIG_FILE, {}))
            writeJson(CONFIG_FILE, { ...current, defaultTarget: saved.id })
            reloadConfig()
          }
          sendJson(res, 200, { ok: true, target: saved, state: snapshot() })
          return
        }
        if (action === 'remove') {
          const id = String(body.id ?? body.target ?? '')
          const before = state.targets.length
          const removed = state.targets.find((target) => target.id === id || targetKey(target) === id)
          state.targets = state.targets.filter((target) => target !== removed)
          if (state.targets.length === before) throw new Error('没有找到这个会话目标')
          // 清掉指向它的默认目标 / 自动发言目标，避免移除后静默改投别的会话
          const current = pickConfig(readJson(CONFIG_FILE, {}))
          const next = { ...current }
          if (removed !== undefined && next.defaultTarget === removed.id) next.defaultTarget = ''
          if (removed !== undefined && next.autoTarget === removed.id) next.autoTarget = ''
          if (next.defaultTarget !== current.defaultTarget || next.autoTarget !== current.autoTarget) {
            writeJson(CONFIG_FILE, next)
            reloadConfig()
          }
          persistState()
          sendJson(res, 200, { ok: true, state: snapshot() })
          return
        }
        throw new Error(`未知操作：${action}`)
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/send',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const text = String(body.text ?? '')
        const kind = String(body.kind ?? 'manual')
        const results = await sendTargets(body.targetId ?? body.target ?? '', text, { kind, mention: body.mention })
        sendJson(res, 200, {
          ok: true,
          messageId: results[0]?.messageId ?? '',
          target: results[0]?.target ?? null,
          results,
          state: snapshot(),
        })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/send-media',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req, 12 * 1024 * 1024)
        const results = await sendMediaTargets(
          body.targetId ?? body.target ?? '',
          { type: body.type, url: body.url, path: body.path, data: body.data, fileName: body.fileName },
          typeof body.caption === 'string' ? body.caption : '',
          body.mention,
        )
        sendJson(res, 200, {
          ok: true,
          messageId: results[0]?.messageId ?? '',
          results,
          state: snapshot(),
        })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/generate',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const generatedText = await composeLine(String(body.topic ?? body.prompt ?? ''))
        if (body.send === true) {
          const results = await sendTargets(body.targetId ?? body.target ?? '', generatedText, { kind: 'generated', mention: body.mention })
          sendJson(res, 200, {
            ok: true,
            text: generatedText,
            messageId: results[0]?.messageId ?? '',
            sent: true,
            target: results[0]?.target ?? null,
            results,
            state: snapshot(),
          })
          return
        }
        sendJson(res, 200, { ok: true, text: generatedText, sent: false })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/chat',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const messages = Array.isArray(body.messages) ? body.messages : []
        if (messages.length === 0) throw new Error('messages 不能为空')
        const transcript = messages
          .slice(-20)
          .map((message) => `${message.role === 'assistant' ? '助手' : '用户'}：${String(message.text ?? '')}`)
          .join('\n')
        const prompt = `下面是网页试聊记录，请以助手身份回复最后一条用户消息（只输出回复本身）：\n${transcript}`
        const text = await generateText({ system: personaText(), prompt, maxTokens: 600 })
        sendJson(res, 200, { ok: true, text })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/import',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const profileDir = process.env.DSH_PROFILE_DIR
        const candidates = [
          join(homedir(), '.dsh-qqbot', 'model-prefs.json'),
          ...(profileDir ? [join(profileDir, '.dsh-qqbot', 'model-prefs.json')] : []),
        ]
        let imported = 0
        let scanned = false
        let firstImported = null
        for (const file of candidates) {
          if (!existsSync(file)) continue
          scanned = true
          const prefs = readJson(file, {})
          const sessionIds = prefs && typeof prefs === 'object' && prefs.sessionIds && typeof prefs.sessionIds === 'object' ? prefs.sessionIds : {}
          for (const key of Object.keys(sessionIds)) {
            const match = /^qqbot:[^:]+:(group|c2c):([A-Za-z0-9_-]{8,})$/.exec(key)
            if (match === null) continue
            const scope = match[1]
            const openid = match[2]
            if (state.targets.some((target) => target.scope === scope && target.openid === openid)) continue
            const saved = upsertTarget({
              scope,
              openid,
              name: `${scope === 'group' ? 'QQ 群' : 'QQ 私聊'} ${openid.slice(-6)}`,
            })
            if (firstImported === null) firstImported = saved
            imported += 1
          }
        }
        if (!scanned) {
          throw new Error('没有找到官方 QQ 插件的数据文件（~/.dsh-qqbot/model-prefs.json），请手动添加 openid')
        }
        if (firstImported !== null) {
          const current = pickConfig(readJson(CONFIG_FILE, {}))
          if (!current.defaultTarget) writeJson(CONFIG_FILE, { ...current, defaultTarget: firstImported.id })
          reloadConfig()
        }
        persistState()
        sendJson(res, 200, { ok: true, imported, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/boards',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const action = String(body.action ?? 'add')
        if (action === 'add') {
          const name = String(body.name ?? '').trim().slice(0, 40)
          if (name.length === 0) throw new Error('板块名称不能为空')
          const targetIds = Array.isArray(body.targetIds) ? body.targetIds.map((id) => String(id)) : []
          if (targetIds.length < 1 || targetIds.length > 3) throw new Error('板块需要选择 1–3 个群聊')
          const targets = targetIds.map((id) => findTarget(id)).filter((target) => target !== null)
          if (targets.length !== targetIds.length) throw new Error('板块里有目标不存在，请刷新后重选')
          if (targets.some((target) => target.scope !== 'group')) throw new Error('板块只能包含群聊')
          const board = {
            id: `board-${Date.now().toString(36)}`,
            name,
            targetIds,
            createdAt: new Date().toISOString(),
          }
          state.boards.push(board)
          if (state.boards.length > 50) state.boards = state.boards.slice(-50)
          persistState()
          sendJson(res, 200, { ok: true, board, state: snapshot() })
          return
        }
        if (action === 'remove') {
          const id = String(body.id ?? '')
          const before = state.boards.length
          state.boards = state.boards.filter((board) => board.id !== id)
          if (state.boards.length === before) throw new Error('没有找到这个板块')
          persistState()
          sendJson(res, 200, { ok: true, state: snapshot() })
          return
        }
        throw new Error(`未知操作：${action}`)
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/blocklist',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const result = handleBlocklist(body)
        sendJson(res, 200, { ok: true, ...result, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/cloud',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const action = String(body.action ?? 'status')
        if (action === 'save') {
          const patch = {
            cloudEnabled: body.enabled === true,
            cloudUrl: String(body.url ?? '').trim(),
            cloudUser: String(body.user ?? '').trim(),
            cloudAuto: body.auto !== false,
          }
          if (typeof body.password === 'string' && body.password.length > 0) patch.cloudPass = body.password
          if (body.clearPassword === true) patch.cloudPass = ''
          saveConfigPatch(patch)
          sendJson(res, 200, { ok: true, state: snapshot() })
          return
        }
        if (action === 'push') {
          const result = await cloud.push()
          sendJson(res, 200, { ok: true, result, state: snapshot() })
          return
        }
        if (action === 'pull') {
          const result = await cloud.pull()
          sendJson(res, 200, { ok: true, result, state: snapshot() })
          return
        }
        if (action === 'test') {
          const result = await cloud.test()
          sendJson(res, 200, { ok: true, result, state: snapshot() })
          return
        }
        sendJson(res, 200, { ok: true, result: cloud.status(), state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/github',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const action = String(body.action ?? 'status')
        if (action === 'save') {
          const patch = {
            githubEnabled: body.enabled === true,
            githubOwner: String(body.owner ?? '').trim(),
            githubRepo: String(body.repo ?? '').trim(),
            githubAuto: body.auto !== false,
          }
          if (typeof body.token === 'string' && body.token.length > 0) patch.githubToken = body.token.trim()
          if (body.clearToken === true) patch.githubToken = ''
          saveConfigPatch(patch)
          sendJson(res, 200, { ok: true, state: snapshot() })
          return
        }
        if (action === 'push') {
          const result = await githubSync.pushAll()
          sendJson(res, 200, { ok: true, result, state: snapshot() })
          return
        }
        sendJson(res, 200, { ok: true, result: githubSync.status(), state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/moderation',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        if (String(body.action ?? 'reset') !== 'reset') throw new Error('未知操作')
        if (typeof body.key === 'string' && body.key.length > 0) delete state.strikes[body.key]
        else state.strikes = {}
        persistState()
        sendJson(res, 200, { ok: true, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/qa',
      handler: route(async (req, res) => {
        if (req.method === 'GET' || req.method === 'HEAD') {
          sendJson(res, 200, {
            ok: true,
            entries: [...qa].sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt))),
            stats: qaStats(),
          })
          return
        }
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const action = String(body.action ?? 'add')
        if (action === 'add') {
          const saved = addQaEntry({
            question: body.question,
            answer: body.answer,
            keywords: typeof body.keywords === 'string' ? body.keywords.split(/[,，、\s]+/).filter(Boolean) : body.keywords,
          })
          sendJson(res, 200, { ok: true, entry: saved.entry, updated: saved.updated, stats: qaStats() })
          return
        }
        if (action === 'update') {
          const entry = updateQaEntry(String(body.id ?? ''), {
            question: body.question,
            answer: body.answer,
            keywords: typeof body.keywords === 'string' ? body.keywords.split(/[,，、\s]+/).filter(Boolean) : body.keywords,
            enabled: body.enabled,
          })
          sendJson(res, 200, { ok: true, entry, stats: qaStats() })
          return
        }
        if (action === 'remove') {
          const id = String(body.id ?? '')
          const before = qa.length
          qa = qa.filter((entry) => entry.id !== id)
          if (qa.length === before) throw new Error('没有找到这条问答')
          saveQa()
          sendJson(res, 200, { ok: true, stats: qaStats() })
          return
        }
        throw new Error(`未知操作：${action}`)
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/qa/lookup',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const question = String(body.question ?? '').trim()
        if (question.length === 0) throw new Error('问题不能为空')
        const match = findQaMatch(question)
        if (match !== null) {
          match.entry.hits = (Number(match.entry.hits) || 0) + 1
          saveQa()
          sendJson(res, 200, {
            ok: true,
            matched: true,
            source: 'library',
            score: Number(match.score.toFixed(3)),
            question,
            answer: match.entry.answer,
            entry: match.entry,
            stats: qaStats(),
          })
          return
        }
        if (body.fallback === true) {
          const answer = await generateText({
            system: `${personaText()}\n你正在回答一个具体问题，要准确、简洁，直接给答案，不要寒暄。`,
            prompt: `请回答这个问题：${question}`,
            maxTokens: 600,
          })
          sendJson(res, 200, {
            ok: true,
            matched: false,
            source: 'deepseek',
            score: 0,
            question,
            answer,
            stats: qaStats(),
          })
          return
        }
        sendJson(res, 200, {
          ok: true,
          matched: false,
          source: 'none',
          score: 0,
          question,
          answer: '',
          stats: qaStats(),
        })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/channel',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const enabled = body.enabled === true
        if (enabled && body.confirm !== true) {
          sendJson(res, 409, {
            ok: false,
            requiresConfirm: true,
            error: '启用 AI 对话通道前，请先在「插件」里停用官方 QQ 机器人插件（@tencent-connect/dsh-qqbot），否则两个连接会抢消息、重复回复。确认已停用后再点一次。',
          })
          return
        }
        const current = pickConfig(readJson(CONFIG_FILE, {}))
        const next = { ...current, chatEnabled: enabled }
        if (typeof body.persona === 'string') next.chatPersona = body.persona.slice(0, 4000)
        if (typeof body.agentPersona === 'string') next.chatAgentPersona = body.agentPersona.slice(0, 4000)
        if (typeof body.useQa === 'boolean') next.chatUseQa = body.useQa
        if (!writeJson(CONFIG_FILE, next)) throw new Error('保存 AI 对话设置失败')
        reloadConfig()
        if (enabled) chatChannel.start()
        else chatChannel.stop()
        sendJson(res, 200, { ok: true, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/remote',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const current = pickConfig(readJson(CONFIG_FILE, {}))
        const next = { ...current }
        if ('enabled' in body) next.webEnabled = body.enabled === true
        if ('port' in body) {
          const port = Number(body.port)
          if (!Number.isFinite(port)) throw new Error('端口不合法')
          next.webPort = Math.max(1024, Math.min(65535, Math.round(port)))
        }
        if (body.regenerate === true) {
          next.webToken = randomBytes(16).toString('hex')
        } else if (typeof body.token === 'string' && body.token.trim().length > 0) {
          next.webToken = body.token.trim().slice(0, 128)
        }
        if (next.webEnabled && (!next.webToken || next.webToken.length === 0)) {
          next.webToken = randomBytes(16).toString('hex')
        }
        if (!writeJson(CONFIG_FILE, next)) throw new Error('保存远程发言设置失败')
        reloadConfig()
        if (next.webEnabled) remoteServer.start()
        else remoteServer.stop()
        sendJson(res, 200, { ok: true, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/group-admin',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        const result = await handleGroupAdmin(body)
        sendJson(res, 200, { ok: true, ...result, state: snapshot() })
      }),
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/qq-free/auto',
      handler: route(async (req, res) => {
        if (!requirePost(req, res)) return
        const body = await readJsonBody(req)
        if (body.runNow === true) {
          const result = await runAuto(true)
          sendJson(res, result.ok ? 200 : 400, { ...result, state: snapshot() })
          return
        }
        const patch = {}
        if ('enabled' in body) patch.autoEnabled = body.enabled === true
        if ('targetId' in body) patch.autoTarget = String(body.targetId ?? '')
        if ('intervalMinutes' in body) patch.autoIntervalMinutes = body.intervalMinutes
        if ('topics' in body) patch.autoTopics = String(body.topics ?? '')
        if (Object.keys(patch).length === 0) throw new Error('没有要更新的自动发言设置')
        const wasEnabled = Boolean(liveConfig.autoEnabled)
        const current = pickConfig(readJson(CONFIG_FILE, {}))
        if (!writeJson(CONFIG_FILE, { ...current, ...pickConfig(patch) })) throw new Error('保存自动发言设置失败')
        reloadConfig()
        if (patch.autoEnabled === true && !wasEnabled) {
          // 刚打开时从此刻开始计时，避免立刻往群里发一句
          state.lastAutoAt = Date.now()
          persistState()
        }
        sendJson(res, 200, { ok: true, state: snapshot() })
      }),
    }))

    logger.info(`qq-free: 网页控制台路由已注册（/qq-free/state）`)
    return () => {
      for (const dispose of disposers) dispose()
    }
  })

  // ── 智能体工具 ───────────────────────────────────────────────────────────

  const tools = ctx.get('tools')
  if (tools && typeof tools.register === 'function') {
    tools.register({
      name: 'qq_free_say',
      description:
        'Send a message to a QQ chat through the official QQ bot (a proactive message, no @ needed), '
        + 'optionally generated by DeepSeek from a prompt. Use when the user asks you to say something in a QQ group '
        + 'or private chat, to announce something, or to speak freely there. `target` accepts a saved target id, '
        + '"group:<openid>" / "c2c:<openid>", or is omitted to use the default target.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'Exact message text to send. Omit when `prompt` is provided.' },
          prompt: { type: 'string', description: 'Topic or instruction for DeepSeek to write the message. Used only when `text` is omitted.' },
          target: { type: 'string', description: 'Saved target id, "group:<openid>", or "c2c:<openid>". Omit for the default target.' },
          mention: { type: 'string', description: 'Optional group member openid to @ at the start of the message.' },
        },
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            target: { type: 'string' },
            text: { type: 'string' },
            messageId: { type: 'string' },
          },
          required: ['target', 'text'],
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: `已在 QQ 发送：${value.text}` }],
      },
      async execute(args) {
        const input = args && typeof args === 'object' ? args : {}
        let text = typeof input.text === 'string' ? input.text.trim() : ''
        if (text.length === 0) {
          const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
          if (prompt.length === 0) throw new Error('qq_free_say: 需要 `text` 或 `prompt` 之一')
          text = await composeLine(prompt)
        }
        const results = await sendTargets(input.target ?? '', text, { kind: 'tool', mention: input.mention })
        return {
          target: results.map((item) => `${item.target.scope}:${item.target.openid}`).join(', '),
          text,
          ...(results[0]?.messageId ? { messageId: results[0].messageId } : {}),
        }
      },
    })
    logger.info('qq-free: qq_free_say 工具已注册')

    tools.register({
      name: 'qq_qa_lookup',
      description:
        'Look up a question in the QQ Q&A library that the QQ free-talk plugin panel maintains. '
        + 'Call this first when a user in a QQ group or private chat asks a factual or FAQ question '
        + '(group rules, usage, prices, schedules, plugin behavior and similar). When matched is true, reply with '
        + 'the stored answer and keep its key facts; do not invent details. When matched is false, answer normally.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The user question, verbatim or lightly cleaned.' },
        },
        required: ['question'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            matched: { type: 'boolean' },
            answer: { type: 'string' },
            score: { type: 'number' },
            entryId: { type: 'string' },
          },
          required: ['matched', 'answer'],
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: value.matched ? `问答库命中：${value.answer}` : '问答库没有命中，按正常方式回答。',
        }],
      },
      async execute(args) {
        const question = String(args?.question ?? '').trim()
        if (question.length === 0) throw new Error('qq_qa_lookup: `question` 不能为空')
        const match = findQaMatch(question)
        if (match === null) return { matched: false, answer: '', score: 0 }
        match.entry.hits = (Number(match.entry.hits) || 0) + 1
        saveQa()
        return {
          matched: true,
          answer: match.entry.answer,
          score: Number(match.score.toFixed(3)),
          entryId: match.entry.id,
        }
      },
    })

    tools.register({
      name: 'qq_qa_save',
      description:
        'Add or update one entry in the QQ Q&A library, so the answer can be reused in QQ chats later. '
        + 'Use when the user asks you to remember a question and answer, or when a stable answer is worth keeping.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string', description: 'The question to remember.' },
          answer: { type: 'string', description: 'The answer to reply with.' },
          keywords: { type: 'string', description: 'Optional comma-separated keywords for looser matching.' },
        },
        required: ['question', 'answer'],
        additionalProperties: false,
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            updated: { type: 'boolean' },
            total: { type: 'integer' },
          },
          required: ['id', 'updated', 'total'],
          additionalProperties: false,
        },
        render: (_args, value) => [{
          type: 'text',
          text: `问答库${value.updated ? '已更新' : '已新增'}，共 ${value.total} 条。`,
        }],
      },
      async execute(args) {
        const keywords = typeof args?.keywords === 'string'
          ? args.keywords.split(/[,，、\s]+/).filter(Boolean)
          : []
        const saved = addQaEntry({ question: args?.question, answer: args?.answer, keywords })
        return { id: saved.entry.id, updated: saved.updated, total: qa.length }
      },
    })

    logger.info('qq-free: qq_qa_lookup / qq_qa_save 工具已注册')

    const systemPrompt = ctx.get('systemPrompt')
    if (systemPrompt && typeof systemPrompt.section === 'function') {
      const disposeGuidance = systemPrompt.section({
        name: 'qq-free:qa-guidance',
        order: 1200,
        text:
          '问答库：当用户在 QQ 群或私聊里提出问题时，优先对照系统提示里的「当前问答库」；'
          + '问题与某条高度相近就直接用该条的答案回答，保持原意、不要改写关键信息。'
          + '需要精确匹配或库内容被截断时，调用 qq_qa_lookup；用户要求你记住某个问答时，调用 qq_qa_save。',
      })
      const disposeLibrary = systemPrompt.section({
        name: 'qq-free:qa-library',
        order: 1201,
        interpolate: false,
        text: () => renderQaLibrary(),
      })
      ctx.effect(() => () => {
        disposeGuidance()
        disposeLibrary()
      }, 'qq-free.qa-prompt')
    }
  } else {
    logger.warn('qq-free: tools 服务不可用，qq_free_say / qq_qa_* 工具未注册')
  }

  logger.info(`qq-free: 已就绪（数据目录 ${DATA_DIR}）`)
}
