/**
 * GitHub Actions 用：从坚果云 WebDAV 下载 dsh-qq-free bundle，
 * 把源码写回仓库工作区。由 .github/workflows/sync-webdav.yml 调用。
 *
 * 环境变量：
 * - WEBDAV_URL   默认 https://dav.jianguoyun.com/dav/qq-free/dsh-qq-free-bundle.json
 * - WEBDAV_USER
 * - WEBDAV_PASS
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const url = process.env.WEBDAV_URL || 'https://dav.jianguoyun.com/dav/qq-free/dsh-qq-free-bundle.json'
const user = process.env.WEBDAV_USER || ''
const pass = process.env.WEBDAV_PASS || ''
if (!user || !pass) {
  console.error('缺少 WEBDAV_USER / WEBDAV_PASS')
  process.exit(1)
}

const auth = `Basic ${Buffer.from(`${user}:${pass}`, 'utf8').toString('base64')}`
const response = await fetch(url, { headers: { authorization: auth }, signal: AbortSignal.timeout(60_000) })
if (!response.ok) {
  console.error(`下载失败 HTTP ${response.status}`)
  process.exit(1)
}
const bundle = await response.json()
if (!bundle || typeof bundle.files !== 'object') {
  console.error('bundle 格式不对')
  process.exit(1)
}

const SAFE = /^(index\.js|channel\.js|remote\.js|remote-page\.js|client\.js|cloud\.js|github\.js|tunnel\.js|verification-image\.js|package\.json|cordis\.patch\.yml|icon\.svg|README\.md|LICENSE|NOTICE\.md|AUTHORS\.md|CHANGELOG\.md|docs\/|locale\/|tools\/)/
let written = 0
for (const [file, base64] of Object.entries(bundle.files)) {
  const relative = String(file).replace(/\\/g, '/')
  if (!SAFE.test(relative) || relative.includes('..') || relative.startsWith('/')) continue
  const target = join(process.cwd(), relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, Buffer.from(String(base64), 'base64'))
  written += 1
}
console.log(`已从 WebDAV 恢复 ${written} 个文件（bundle ${bundle.version || '?'} / ${bundle.updatedAt || '?'}）`)
