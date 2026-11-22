/**
 * 远程自由发言网页：一个独立的小 HTTP 服务，手机/外网浏览器打开后用
 * token 登录即可控制机器人发言（文字 / @成员 / DeepSeek 生成 / 媒体）。
 *
 * 只依赖 node 内置模块；鉴权用配置里的 webToken。
 *
 * @module @local/dsh-qq-free/remote
 */

import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'

const MAX_BODY = 10 * 1024 * 1024

function tokenMatches(expected, supplied) {
  if (typeof expected !== 'string' || expected.length === 0) return false
  if (typeof supplied !== 'string' || supplied.length !== expected.length) return false
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))
  } catch {
    return false
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (size === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('请求体不是 JSON'))
      }
    })
    req.on('error', reject)
  })
}

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

import { REMOTE_PAGE } from './remote-page.js'
import { renderGroupPage } from './group-page.js'

export function createRemoteServer({ getConfig, sendTargets, composeLine, sendMediaTargets, snapshot, api, groupPage, logger }) {
  let server = null
  let boundPort = null
  let lastError = ''
  let requestCount = 0

  function authorized(req) {
    const expected = String(getConfig().webToken || '')
    const header = String(req.headers.authorization || '')
    const bearer = header.startsWith('Bearer ') ? header.slice(7).trim() : ''
    const url = new URL(req.url ?? '/', 'http://localhost')
    const supplied = bearer || String(url.searchParams.get('token') ?? '')
    return tokenMatches(expected, supplied)
  }

  function fullState() {
    const state = snapshot()
    return {
      ...state,
      qa: api?.qa ? api.qa({ action: 'list' }).list : [],
    }
  }

  async function handle(req, res) {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(REMOTE_PAGE)
      return
    }
    if (url.pathname.startsWith('/g/')) {
      const token = url.pathname.slice('/g/'.length)
      const resolved = groupPage?.resolve ? groupPage.resolve(token) : { status: 'missing' }
      if (resolved.status !== 'ok') {
        const message = resolved.status === 'expired' ? '这个分群网页链接已过期。' : '分群网页不存在。'
        res.writeHead(resolved.status === 'expired' ? 410 : 404, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(`<!doctype html><meta charset="utf-8"><title>分群网页</title><body style="font:16px system-ui;padding:40px">${message}</body>`)
        return
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(renderGroupPage(token))
      return
    }
    if (url.pathname === '/gapi/state' || url.pathname === '/gapi/say') {
      const token = String(url.searchParams.get('token') ?? '')
      const resolved = groupPage?.resolve ? groupPage.resolve(token) : { status: 'missing' }
      if (resolved.status !== 'ok') {
        json(res, resolved.status === 'expired' ? 410 : 401, { ok: false, error: resolved.status === 'expired' ? '链接已过期' : 'unauthorized' })
        return
      }
      if (url.pathname === '/gapi/state') {
        json(res, 200, {
          ok: true,
          group: resolved.page.group,
          permissions: resolved.page.permissions,
          expiresAt: resolved.page.expiresAt,
        })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      if (resolved.page.permissions?.say !== true) {
        json(res, 403, { ok: false, error: '你无权限' })
        return
      }
      const body = await readBody(req)
      const text = String(body.text ?? '')
      if (text.trim().length === 0) {
        json(res, 400, { ok: false, error: '消息不能为空' })
        return
      }
      const results = await groupPage.say(token, text)
      json(res, 200, { ok: true, results })
      return
    }
    if (!url.pathname.startsWith('/api/')) {
      json(res, 404, { ok: false, error: 'not found' })
      return
    }
    if (!authorized(req)) {
      json(res, 401, { ok: false, error: 'unauthorized' })
      return
    }
    requestCount += 1
    try {
      if (url.pathname === '/api/state' && req.method === 'GET') {
        const state = fullState()
        json(res, 200, {
          ok: true,
          chat: state.chat,
          targets: state.targets,
          boards: state.boards,
          members: state.members,
          auto: state.auto,
          qa: state.qa,
          moderation: state.moderation,
          welcome: state.welcome,
          pendingJoins: state.pendingJoins,
          blockedMembers: state.blockedMembers,
          blockedMentions: state.blockedMentions,
          log: state.log,
        })
        return
      }
      if (req.method !== 'POST') {
        json(res, 405, { ok: false, error: 'method not allowed' })
        return
      }
      const body = await readBody(req)
      const target = body.targetId || body.target || ''
      if (url.pathname === '/api/send') {
        const text = String(body.text ?? '')
        if (text.trim().length === 0) throw new Error('消息不能为空')
        const results = await sendTargets(target, text, { kind: 'remote', mention: body.mention })
        json(res, 200, { ok: true, messageId: results[0]?.messageId ?? '', results })
        return
      }
      if (url.pathname === '/api/generate') {
        const generated = await composeLine(String(body.topic ?? ''))
        const results = await sendTargets(target, generated, { kind: 'remote-deepseek', mention: body.mention })
        json(res, 200, { ok: true, text: generated, messageId: results[0]?.messageId ?? '', results })
        return
      }
      if (url.pathname === '/api/media') {
        const results = await sendMediaTargets(
          target,
          { type: body.type, url: body.url, data: body.data, fileName: body.fileName },
          typeof body.caption === 'string' ? body.caption : '',
          body.mention,
        )
        json(res, 200, { ok: true, messageId: results[0]?.messageId ?? '', results })
        return
      }
      const name = url.pathname.slice('/api/'.length)
      if (api && typeof api[name] === 'function') {
        const result = await api[name](body)
        json(res, 200, { ok: true, ...(result ?? {}), state: fullState() })
        return
      }
      json(res, 404, { ok: false, error: 'not found' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = message
      logger.warn(`qq-free remote: ${message}`)
      json(res, 400, { ok: false, error: message })
    }
  }

  return {
    start() {
      if (server !== null) return this.status()
      const config = getConfig()
      const port = Math.max(1024, Math.min(65535, Number(config.webPort) || 8788))
      lastError = ''
      server = createServer((req, res) => { void handle(req, res) })
      server.on('error', (error) => {
        lastError = error instanceof Error ? error.message : String(error)
        logger.warn(`qq-free remote: ${lastError}`)
        try { server?.close() } catch { /* ignore */ }
        server = null
        boundPort = null
      })
      server.listen(port, '0.0.0.0', () => {
        boundPort = port
        logger.info(`qq-free remote: http://0.0.0.0:${port}`)
      })
      return this.status()
    },
    stop() {
      if (server !== null) {
        try { server.close() } catch { /* ignore */ }
        try { server.closeAllConnections?.() } catch { /* ignore */ }
      }
      server = null
      boundPort = null
      return this.status()
    },
    status() {
      return {
        running: server !== null,
        port: boundPort,
        requests: requestCount,
        lastError,
      }
    },
  }
}
