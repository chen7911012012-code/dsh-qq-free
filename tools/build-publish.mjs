/**
 * 把本地插件 `@local/dsh-qq-free` 构建成可上架的 npm 包与插件市场索引。
 *
 * 产物：
 * - publish/dsh-qq-free/          可 publish 的包目录（包名改为 dsh-qq-free）
 * - publish/dsh-qq-free-<ver>.tgz npm pack 生成的压缩包
 * - publish/market/index.json     插件市场 format 1 索引（含一个插件条目）
 *
 * 用法：node tools/build-publish.mjs
 */

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = resolve(here, '..')
const publishDir = join(root, 'publish')
const outDir = join(publishDir, 'dsh-qq-free')
const marketDir = join(publishDir, 'market')

const PACKAGE_NAME = 'dsh-qq-free'
const sourcePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const version = sourcePackage.version
const now = new Date()

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(marketDir, { recursive: true })

// 1. 复制运行时文件（不复制 test/、tools/、publish/）
for (const entry of ['index.js', 'channel.js', 'remote.js', 'remote-page.js', 'cloud.js', 'client.js', 'cordis.patch.yml', 'icon.svg', 'README.md', 'LICENSE', 'NOTICE.md', 'AUTHORS.md', 'docs', 'locale']) {
  cpSync(join(root, entry), join(outDir, entry), { recursive: true })
}

// 2. 把包名从 @local/dsh-qq-free 改写为 dsh-qq-free
function rewrite(file) {
  const path = join(outDir, file)
  const before = readFileSync(path, 'utf8')
  const after = before.replaceAll('@local/dsh-qq-free', PACKAGE_NAME)
  writeFileSync(path, after, 'utf8')
}
for (const file of ['index.js', 'channel.js', 'remote.js', 'client.js', 'cordis.patch.yml']) rewrite(file)

// 3. 发布用 manifest
const manifest = {
  name: PACKAGE_NAME,
  version,
  description: sourcePackage.description,
  type: 'module',
  license: 'MIT',
  author: {
    name: '都有文明每天',
    email: '3645411938@qq.com',
    url: 'https://github.com/chen7911012012',
  },
  repository: {
    type: 'git',
    url: 'git+https://github.com/chen7911012012-code/dsh-qq-free.git',
  },
  homepage: 'https://github.com/chen7911012012-code/dsh-qq-free#readme',
  bugs: { url: 'https://github.com/chen7911012012-code/dsh-qq-free/issues' },
  keywords: ['deepseek-harness', 'dsh', 'dsh-plugin', 'qqbot', 'qq', 'deepseek', 'cordis', 'im'],
  engines: { node: '>=20' },
  exports: sourcePackage.exports,
  files: [
    'index.js',
    'channel.js',
    'remote.js',
    'remote-page.js',
    'cloud.js',
    'client.js',
    'cordis.patch.yml',
    'locale/*.json',
    'docs',
    'icon.svg',
    'README.md',
    'LICENSE',
    'NOTICE.md',
    'AUTHORS.md',
    'market/index.json',
  ],
  dsh: sourcePackage.dsh,
  publishConfig: { access: 'public' },
}
writeFileSync(join(outDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

// 4. 插件市场 format 1 索引
const title = {
  en: 'QQ free talk',
  zh: 'QQ 自动发言',
}
const description = {
  en: 'Let an official QQ bot speak without being mentioned: proactive messages, DeepSeek-written lines, scheduled auto talk, and a web console.',
  zh: '让 QQ 官方机器人不用被 @ 也能主动开口：主动消息、DeepSeek 现写、定时自动发言，附网页控制台。',
}
const cdnBase = `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${version}`

const market = {
  format: 1,
  title: {
    en: 'QQ free talk plugin index',
    zh: 'QQ 自动发言插件源',
  },
  description: {
    en: 'A DSH plugin index with the QQ free-talk bundle.',
    zh: '只收录 QQ 自动发言插件的 DSH 插件索引。',
  },
  metadata: {
    categories: {
      im: { title: { en: 'Messaging', zh: '消息与聊天' } },
    },
    labels: {
      qq: { title: { en: 'QQ', zh: 'QQ' } },
      deepseek: { title: { en: 'DeepSeek', zh: 'DeepSeek' } },
    },
    sortKeys: {
      published: { title: { en: 'Published', zh: '发布时间' }, order: 'desc' },
    },
  },
  plugins: [
    {
      name: PACKAGE_NAME,
      title,
      description,
      icon: `${cdnBase}/icon.svg`,
      author: '都有文明每天',
      homepage: 'https://github.com/chen7911012012-code/dsh-qq-free',
      repository: { url: 'https://github.com/chen7911012012-code/dsh-qq-free' },
      metadata: {
        category: 'im',
        keywords: ['qq', 'qqbot', 'deepseek', 'dsh', 'dsh-plugin', 'chat'],
        labels: ['qq', 'deepseek'],
        sortKeys: { published: Math.floor(now.getTime() / 1000) },
      },
      versions: [
        {
          version,
          publishTimestamp: Math.floor(now.getTime() / 1000),
          source: { type: 'npm' },
          engines: {},
        },
      ],
    },
  ],
}
writeFileSync(join(marketDir, 'index.json'), `${JSON.stringify(market, null, 2)}\n`, 'utf8')
mkdirSync(join(outDir, 'market'), { recursive: true })
writeFileSync(join(outDir, 'market', 'index.json'), `${JSON.stringify(market, null, 2)}\n`, 'utf8')

// 5. npm pack：验证真实会发布哪些文件
const pack = spawnSync('npm', ['pack', '--pack-destination', publishDir], {
  cwd: outDir,
  encoding: 'utf8',
  shell: true,
})
if (pack.status !== 0) {
  console.error(pack.stdout)
  console.error(pack.stderr)
  process.exit(pack.status ?? 1)
}
const tarball = pack.stdout.trim().split(/\r?\n/).filter(Boolean).pop()
console.log(`packed: ${tarball}`)
console.log(`package: ${outDir}`)
console.log(`index:   ${join(marketDir, 'index.json')}`)
console.log(`icon:    ${manifest.files.includes('icon.svg') ? 'included' : 'MISSING'}`)
console.log(`files:   ${existsSync(join(outDir, 'LICENSE')) ? 'LICENSE included' : 'LICENSE missing'}`)
