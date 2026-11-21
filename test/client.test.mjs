/**
 * 客户端模块的注册冒烟测试：用假 window / React / ctx 跑一遍 apply，
 * 确认槽位注册契约（main、sidebar.panellist、plugins.detail.actions、settings.section）没有写错。
 * 运行：node test/client.test.mjs
 */

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load(spec) { captured = spec },
  },
}

const React = {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(initial) { return [typeof initial === 'function' ? initial() : initial, () => {}] },
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

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
