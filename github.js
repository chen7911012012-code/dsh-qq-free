/**
 * GitHub 直连同步：用 Contents API 把本地改动直接提交到仓库，
 * 不依赖 git 命令，和 WebDAV / GitHub Actions 互为兜底。
 *
 * 配置：githubEnabled / githubOwner / githubRepo / githubToken / githubAuto
 *
 * @module @local/dsh-qq-free/github
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT_FILES = [
  'index.js', 'channel.js', 'remote.js', 'remote-page.js', 'client.js', 'cloud.js', 'github.js', 'tunnel.js',
  'package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'NOTICE.md', 'AUTHORS.md', 'CHANGELOG.md',
  'index.html', '.gitignore',
]
const ROOT_DIRS = ['docs', 'locale', 'tools', 'test', 'market', '.github']
const IGNORE = new Set(['node_modules', '.git', 'publish', '.DS_Store'])
const ALLOWED = /^(index\.js|channel\.js|remote\.js|remote-page\.js|client\.js|cloud\.js|github\.js|tunnel\.js|package\.json|cordis\.patch\.yml|icon\.svg|README\.md|LICENSE|NOTICE\.md|AUTHORS\.md|CHANGELOG\.md|index\.html|\.gitignore|docs\/|locale\/|tools\/|test\/|market\/|\.github\/)/

function collect(pluginDir) {
  const files = []
  for (const file of ROOT_FILES) {
    try {
      if (statSync(join(pluginDir, file)).isFile()) files.push(file)
    } catch {
      // ignore
    }
  }
  function walk(dir, base) {
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (IGNORE.has(entry.name)) continue
      if (entry.name.endsWith('.tmp') || entry.name.endsWith('.log')) continue
      const abs = join(dir, entry.name)
      const rel = base ? `${base}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(abs, rel)
      else if (entry.isFile()) files.push(rel)
    }
  }
  for (const dir of ROOT_DIRS) walk(join(pluginDir, dir), dir)
  return [...new Set(files)]
}

function blobSha(buffer) {
  return createHash('sha1').update(`blob ${buffer.length}\0`).update(buffer).digest('hex')
}

function safePath(value) {
  const path = String(value ?? '').replace(/\\/g, '/')
  if (!ALLOWED.test(path) || path.includes('..') || path.startsWith('/')) return null
  return path
}

export function createGitHubSync({ pluginDir, getConfig, logger }) {
  let lastAt = ''
  let lastFile = ''
  let lastError = ''
  let lastAction = ''
  let timer = null
  const queue = new Set()
  let busy = false

  function configOk() {
    const config = getConfig()
    return config.githubEnabled === true
      && String(config.githubOwner || '').trim().length > 0
      && String(config.githubRepo || '').trim().length > 0
      && String(config.githubToken || '').trim().length > 0
  }

  function apiBase() {
    const config = getConfig()
    return `https://api.github.com/repos/${encodeURIComponent(String(config.githubOwner).trim())}/${encodeURIComponent(String(config.githubRepo).trim())}/contents`
  }

  function headers() {
    const config = getConfig()
    return {
      authorization: `Bearer ${String(config.githubToken || '').trim()}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'dsh-qq-free-sync',
    }
  }

  async function syncOne(relative) {
    const path = safePath(relative)
    if (path === null) return { skipped: true }
    const buffer = readFileSync(join(pluginDir, path))
    const url = `${apiBase()}/${path.split('/').map(encodeURIComponent).join('/')}`
    let sha = ''
    const existing = await fetch(url, { headers: headers(), signal: AbortSignal.timeout(20_000) })
    if (existing.ok) {
      const data = await existing.json()
      sha = String(data.sha || '')
      if (sha === blobSha(buffer)) return { skipped: true, path }
    } else if (existing.status !== 404) {
      throw new Error(`读取 ${path} 失败：HTTP ${existing.status}`)
    }
    const response = await fetch(url, {
      method: 'PUT',
      headers: { ...headers(), 'content-type': 'application/json' },
      body: JSON.stringify({
        message: `sync: update ${path} (${new Date().toISOString().slice(0, 19)}Z)`,
        content: buffer.toString('base64'),
        ...(sha ? { sha } : {}),
        branch: 'main',
        committer: { name: '都有文明每天', email: '3645411938@qq.com' },
        author: { name: '都有文明每天', email: '3645411938@qq.com' },
      }),
      signal: AbortSignal.timeout(30_000),
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`提交 ${path} 失败：HTTP ${response.status} ${text.slice(0, 160)}`)
    }
    lastAt = new Date().toISOString()
    lastFile = path
    lastAction = 'file'
    lastError = ''
    logger.info(`qq-free github: 已同步 ${path}`)
    return { ok: true, path }
  }

  async function pushAll() {
    if (!configOk()) throw new Error('先在面板启用 GitHub 同步并填 owner/repo/token')
    if (busy) return { skipped: true }
    busy = true
    const results = []
    try {
      for (const file of collect(pluginDir)) {
        try {
          results.push(await syncOne(file))
        } catch (error) {
          results.push({ path: file, error: error instanceof Error ? error.message : String(error) })
        }
      }
      const failed = results.filter((item) => item.error)
      lastAction = 'all'
      lastAt = new Date().toISOString()
      lastError = failed.length > 0 ? `${failed.length} 个文件失败：${failed[0].error}` : ''
      if (failed.length > 0) throw new Error(lastError)
      return { ok: true, synced: results.filter((item) => item.ok).length, total: results.length }
    } finally {
      busy = false
    }
  }

  function schedule(relative) {
    const path = safePath(relative)
    if (path === null) return
    const config = getConfig()
    if (config.githubEnabled !== true || config.githubAuto !== true || !configOk()) return
    queue.add(path)
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void flush()
    }, 2000)
    timer.unref?.()
  }

  async function flush() {
    if (busy || queue.size === 0) return
    busy = true
    const files = [...queue]
    queue.clear()
    try {
      for (const file of files) {
        try {
          await syncOne(file)
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error)
          lastAction = 'file'
          logger.warn(`qq-free github: ${lastError}`)
        }
      }
    } finally {
      busy = false
    }
  }

  return {
    schedule,
    pushAll,
    status() {
      const config = getConfig()
      return {
        enabled: config.githubEnabled === true,
        auto: config.githubAuto === true,
        owner: String(config.githubOwner || ''),
        repo: String(config.githubRepo || ''),
        hasToken: String(config.githubToken || '').length > 0,
        lastAt,
        lastFile,
        lastError,
        lastAction,
      }
    },
  }
}
