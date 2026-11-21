/**
 * WebDAV 云端同步：把插件源码打包成一个 JSON bundle 传到网盘，
 * 其他电脑配置同一个 WebDAV 后可以「从云端恢复」。
 *
 * 浏览器面板只负责触发；账号密码保存在插件数据目录的 config.json。
 *
 * @module @local/dsh-qq-free/cloud
 */

import { mkdirSync, readFileSync, readdirSync, statSync, watch, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const BUNDLE_NAME = 'dsh-qq-free-bundle.json'
const ROOT_FILES = [
  'index.js', 'channel.js', 'remote.js', 'remote-page.js', 'client.js', 'cloud.js', 'github.js',
  'package.json', 'cordis.patch.yml', 'icon.svg', 'README.md',
  'LICENSE', 'NOTICE.md', 'AUTHORS.md',
]
const ROOT_DIRS = ['docs', 'locale', 'tools']
const IGNORE = new Set(['node_modules', '.git', 'publish', '.DS_Store'])

function walk(dir, base, out) {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (IGNORE.has(entry.name)) continue
    if (entry.name.endsWith('.tmp') || entry.name.endsWith('.log')) continue
    const absolute = join(dir, entry.name)
    const relative = base ? `${base}/${entry.name}` : entry.name
    if (entry.isDirectory()) walk(absolute, relative, out)
    else if (entry.isFile()) out.push(relative)
  }
}

function collectFiles(pluginDir) {
  const files = []
  for (const file of ROOT_FILES) {
    try {
      if (statSync(join(pluginDir, file)).isFile()) files.push(file)
    } catch {
      // ignore
    }
  }
  for (const dir of ROOT_DIRS) walk(join(pluginDir, dir), dir, files)
  return files
}

function safeRelative(path) {
  const value = String(path ?? '').replace(/\\/g, '/')
  if (value.startsWith('/') || value.includes('..') || value.length === 0) return null
  if (!/^(index\.js|channel\.js|remote\.js|remote-page\.js|client\.js|cloud\.js|github\.js|package\.json|cordis\.patch\.yml|icon\.svg|README\.md|LICENSE|NOTICE\.md|AUTHORS\.md|docs\/|locale\/|tools\/)/.test(value)) return null
  return value
}

function basicAuth(user, password) {
  return `Basic ${Buffer.from(`${user}:${password}`, 'utf8').toString('base64')}`
}

export function createCloudSync({ pluginDir, getConfig, logger, onFileChange }) {
  let watcher = null
  let timer = null
  let lastAt = ''
  let lastError = ''
  let lastAction = ''
  let pushing = false

  function remoteUrl() {
    const config = getConfig()
    const base = String(config.cloudUrl || '').trim().replace(/\/+$/, '')
    return base.length > 0 ? `${base}/${BUNDLE_NAME}` : ''
  }

  function headers() {
    const config = getConfig()
    return {
      authorization: basicAuth(String(config.cloudUser || ''), String(config.cloudPass || '')),
      'content-type': 'application/json; charset=utf-8',
    }
  }

  function buildBundle() {
    const files = collectFiles(pluginDir)
    const payload = {}
    for (const file of files) {
      try {
        payload[file] = readFileSync(join(pluginDir, file)).toString('base64')
      } catch {
        // ignore unreadable
      }
    }
    let version = ''
    try {
      version = JSON.parse(readFileSync(join(pluginDir, 'package.json'), 'utf8')).version || ''
    } catch {
      // ignore
    }
    return {
      format: 1,
      name: 'dsh-qq-free',
      version,
      updatedAt: new Date().toISOString(),
      files: payload,
    }
  }

  async function request(url, options) {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000) })
    const text = await response.text().catch(() => '')
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403
        ? '（账号或密码不对，或没有写入权限）'
        : ''
      throw new Error(`HTTP ${response.status} ${text.slice(0, 160)}${hint}`)
    }
    return text
  }

  async function test() {
    const config = getConfig()
    const base = String(config.cloudUrl || '').trim().replace(/\/+$/, '')
    if (base.length === 0) throw new Error('先填 WebDAV 地址')
    let response
    try {
      response = await fetch(base, {
        method: 'PROPFIND',
        headers: { ...headers(), depth: '0' },
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      throw new Error(`连不上：${error instanceof Error ? error.message : String(error)}`)
    }
    if (response.status === 401 || response.status === 403) throw new Error('账号或密码不对')
    if (response.status >= 400) throw new Error(`WebDAV 返回 HTTP ${response.status}`)
    lastAction = 'test'
    lastAt = new Date().toISOString()
    lastError = ''
    return { ok: true, status: response.status }
  }

  async function ensureCollection() {
    const config = getConfig()
    const base = String(config.cloudUrl || '').trim().replace(/\/+$/, '')
    if (base.length === 0) return
    let parsed
    try {
      parsed = new URL(base)
    } catch {
      return
    }
    const segments = parsed.pathname.split('/').filter(Boolean)
    let path = ''
    for (const segment of segments) {
      path += `/${encodeURIComponent(segment)}`
      try {
        const response = await fetch(`${parsed.origin}${path}/`, {
          method: 'MKCOL',
          headers: { authorization: basicAuth(String(config.cloudUser || ''), String(config.cloudPass || '')) },
          signal: AbortSignal.timeout(15_000),
        })
        // 201 新建；405/409 已存在；其它状态交给后面的 PUT 报错
        void response.status
      } catch {
        // 网络问题留给 PUT 报错
      }
    }
  }

  async function push() {
    const url = remoteUrl()
    if (url.length === 0) throw new Error('先在面板配置 WebDAV 地址')
    if (pushing) return { skipped: true }
    pushing = true
    try {
      await ensureCollection()
      const bundle = buildBundle()
      await request(url, { method: 'PUT', headers: headers(), body: JSON.stringify(bundle) })
      const count = Object.keys(bundle.files).length
      lastAction = 'push'
      lastAt = bundle.updatedAt
      lastError = ''
      logger.info(`qq-free cloud: 已上传 ${count} 个文件（${bundle.version}）`)
      return { ok: true, files: count, version: bundle.version, updatedAt: bundle.updatedAt }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      lastAction = 'push'
      logger.warn(`qq-free cloud: 上传失败 ${lastError}`)
      throw error
    } finally {
      pushing = false
    }
  }

  async function pull() {
    const url = remoteUrl()
    if (url.length === 0) throw new Error('先在面板配置 WebDAV 地址')
    let bundle
    try {
      const text = await request(url, { method: 'GET', headers: headers() })
      bundle = JSON.parse(text)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      lastError = message
      throw new Error(`下载失败：${message}`)
    }
    if (!bundle || typeof bundle.files !== 'object') throw new Error('云端 bundle 格式不对')
    const written = []
    const skipped = []
    for (const [file, base64] of Object.entries(bundle.files)) {
      const relative = safeRelative(file)
      if (relative === null) {
        skipped.push(file)
        continue
      }
      const absolute = join(pluginDir, relative)
      mkdirSync(dirname(absolute), { recursive: true })
      writeFileSync(absolute, Buffer.from(String(base64), 'base64'))
      written.push(relative)
    }
    lastAction = 'pull'
    lastAt = new Date().toISOString()
    lastError = ''
    logger.info(`qq-free cloud: 已恢复 ${written.length} 个文件`)
    return { ok: true, files: written.length, skipped, version: bundle.version, updatedAt: bundle.updatedAt }
  }

  function schedule() {
    const config = getConfig()
    if (!config.cloudEnabled || !config.cloudAuto) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void push().catch(() => {})
    }, 3000)
    timer.unref?.()
  }

  return {
    start() {
      if (watcher !== null) return
      try {
        watcher = watch(pluginDir, { recursive: true }, (event, filename) => {
          const name = String(filename ?? '').replace(/\\/g, '/')
          if (name.length === 0 || name.startsWith('publish/') || name.startsWith('.git/') || name.includes('node_modules')) return
          try { onFileChange?.(name) } catch { /* ignore */ }
          schedule()
        })
        watcher.on('error', () => {})
        logger.info('qq-free cloud: 文件监听已启动')
      } catch (error) {
        logger.warn(`qq-free cloud: 文件监听启动失败 ${error instanceof Error ? error.message : String(error)}`)
      }
    },
    stop() {
      if (watcher !== null) {
        try { watcher.close() } catch { /* ignore */ }
      }
      watcher = null
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
    test,
    push,
    pull,
    status() {
      const config = getConfig()
      return {
        enabled: config.cloudEnabled === true,
        auto: config.cloudAuto === true,
        url: String(config.cloudUrl || ''),
        user: String(config.cloudUser || ''),
        hasPassword: String(config.cloudPass || '').length > 0,
        lastAt,
        lastAction,
        lastError,
        bundle: BUNDLE_NAME,
      }
    },
  }
}
