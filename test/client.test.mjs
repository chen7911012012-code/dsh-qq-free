/**
 * 客户端模块的注册冒烟测试：用假 window / React / ctx 跑一遍 apply，
 * 确认槽位注册契约（main、sidebar.panellist、plugins.detail.actions、settings.section）没有写错，
 * 并用一份脱敏后的真实状态快照把面板完整渲染一遍（能抓到 JSX 里引用未声明变量这类运行期错误）。
 * 运行：node test/client.test.mjs
 */

import { readFileSync } from 'node:fs'

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { captured = spec },
  },
}

let stateIndex = 0
let stateSeeds = []
const React = {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(initial) {
    const i = stateIndex
    stateIndex += 1
    const seed = stateSeeds[i]
    const value = seed !== undefined ? seed : (typeof initial === 'function' ? initial() : initial)
    return [value, () => {}]
  },
  useEffect() {},
  useRef(value) { return { current: value } },
  useCallback(fn) { return fn },
}

await import('../client.js')

let failures = 0
function check(name, condition, detail = '') {
  if (condition) console.log(`  ok   ${name}`)
  else { failures += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

check('client 通过 ModuleLoader 注册', captured !== null)
check('模块 id 是包名', captured?.id === '@local/dsh-qq-free', captured?.id)

const module = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require: ${id}`)
})
check('factory 返回 apply', typeof module.apply === 'function')
check('factory 声明 slots 依赖', Array.isArray(module.inject) && module.inject.includes('slots'))

const registered = []
const slots = {
  inject(name, install) {
    const dispose = install()
    return typeof dispose === 'function' ? dispose : () => {}
  },
  register(spec, component) {
    registered.push({ slot: spec.name, spec, component })
    return () => {}
  },
}
const ctx = {
  slots,
  inject(deps, callback) {
    if (!deps.includes('layout')) return
    callback({ slots, layout: { selectPanel() {} } })
  },
  effect(fn) { fn() },
}

module.apply(ctx)
const slotsSeen = registered.map((entry) => entry.slot).sort()
check('注册了 settings.section', slotsSeen.includes('settings.section'))
check('注册了 main', slotsSeen.includes('main'))
check('注册了 sidebar.panellist', slotsSeen.includes('sidebar.panellist'))
check('注册了 plugins.detail.actions', slotsSeen.includes('plugins.detail.actions'))
check('main 的 key 是 qq-free', registered.find((entry) => entry.slot === 'main')?.spec.key === 'qq-free')
check('每个注册都有组件', registered.every((entry) => typeof entry.component === 'function'))

// 组件本身可调用（用假 hooks 展开一次），确认没有立即抛错
for (const entry of registered.filter((item) => ['main', 'settings.section'].includes(item.slot))) {
  try {
    const tree = entry.component({})
    check(`${entry.slot} 组件可渲染出元素`, tree !== null && tree !== undefined)
  } catch (error) {
    check(`${entry.slot} 组件可渲染出元素`, false, error.message)
  }
}

// 用真实快照把面板完整渲染一遍：React 组件里引用未声明的变量只会在渲染时炸，
// 单元测试里 data 为 null 会提前 return，所以必须喂一份真实结构的数据。
const snapshot = JSON.parse(readFileSync(new URL('./snapshot.fixture.json', import.meta.url), 'utf8'))
const main = registered.find((entry) => entry.slot === 'main')
try {
  const wrapper = main.component({})
  const Inner = wrapper.type
  stateIndex = 0
  stateSeeds = [snapshot]
  const tree = Inner({})
  let nodes = 0
  const walk = (node) => {
    if (node === null || node === undefined) return
    if (Array.isArray(node)) { for (const item of node) walk(item); return }
    if (typeof node === 'object' && node.type) { nodes += 1; walk(node.children) }
  }
  walk(tree)
  check('面板能用真实快照完整渲染', nodes > 100, `nodes=${nodes}`)
} catch (error) {
  check('面板能用真实快照完整渲染', false, error.message)
}

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
