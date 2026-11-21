/**
 * 由 publish/INSTALL.md 生成简体中文 INSTALL.txt（UTF-8 BOM）和 INSTALL.html。
 * PDF 用 Edge 无头打印（见 tools/print-install-pdf.ps1 或手动命令）。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
const publish = join(root, 'publish')
const md = readFileSync(join(publish, 'INSTALL.md'), 'utf8')

const plain = md
  .split('\n')
  .filter((line) => !line.trim().startsWith('```'))
  .map((line) => {
    if (line.startsWith('### ')) return `\n【${line.slice(4)}】`
    if (line.startsWith('## ')) return `\n\n${line.slice(3)}\n${'='.repeat(20)}`
    if (line.startsWith('# ')) return `${line.slice(2)}\n${'='.repeat(24)}`
    if (line.startsWith('- ')) return `· ${line.slice(2)}`
    return line.replace(/\*\*/g, '').replace(/`/g, '')
  })
  .join('\n')
  .replace(/\n{3,}/g, '\n\n')
  .trim()

writeFileSync(join(publish, 'INSTALL.txt'), `\uFEFF${plain}\r\n`, 'utf8')

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
function inline(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
}

const lines = md.split('\n')
const body = []
let inCode = false
let listOpen = false
for (const line of lines) {
  if (line.trim().startsWith('```')) {
    if (!inCode) {
      if (listOpen) { body.push('</ul>'); listOpen = false }
      body.push('<pre><code>')
    } else {
      body.push('</code></pre>')
    }
    inCode = !inCode
    continue
  }
  if (inCode) {
    body.push(escapeHtml(line))
    continue
  }
  if (line.startsWith('### ')) {
    if (listOpen) { body.push('</ul>'); listOpen = false }
    body.push(`<h3>${inline(line.slice(4))}</h3>`)
    continue
  }
  if (line.startsWith('## ')) {
    if (listOpen) { body.push('</ul>'); listOpen = false }
    body.push(`<h2>${inline(line.slice(3))}</h2>`)
    continue
  }
  if (line.startsWith('# ')) {
    body.push(`<h1>${inline(line.slice(2))}</h1>`)
    continue
  }
  if (line.startsWith('- ')) {
    if (!listOpen) { body.push('<ul>'); listOpen = true }
    body.push(`<li>${inline(line.slice(2))}</li>`)
    continue
  }
  if (line.trim() === '') {
    if (listOpen) { body.push('</ul>'); listOpen = false }
    continue
  }
  if (listOpen) { body.push('</ul>'); listOpen = false }
  body.push(`<p>${inline(line)}</p>`)
}
if (listOpen) body.push('</ul>')

const html = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>dsh-qq-free 安装说明</title>
<style>
  body { font-family: "Microsoft YaHei", "SimSun", "PingFang SC", sans-serif; font-size: 11.5pt; line-height: 1.65; color: #1a1a1a; max-width: 760px; margin: 28px auto; padding: 0 18px; }
  h1 { font-size: 20pt; border-bottom: 2px solid #333; padding-bottom: 8px; }
  h2 { font-size: 15pt; margin-top: 22px; border-left: 4px solid #4d6bfe; padding-left: 8px; }
  h3 { font-size: 12.5pt; margin-top: 16px; }
  code { font-family: Consolas, "Courier New", monospace; background: #f2f3f5; padding: 1px 4px; border-radius: 3px; }
  pre { background: #f2f3f5; padding: 10px 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  ul { padding-left: 22px; }
  li { margin: 3px 0; }
  p { margin: 8px 0; }
</style>
</head>
<body>
${body.join('\n')}
</body>
</html>`

writeFileSync(join(publish, 'INSTALL.html'), html, 'utf8')
console.log('written INSTALL.txt / INSTALL.html')
