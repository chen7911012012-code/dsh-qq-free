import { readFileSync } from 'node:fs'
const snapshot = JSON.parse(readFileSync('C:/Users/Administrator/Desktop/deepseek/qq-free/test/_live-snapshot.json', 'utf8'))
let captured = null
globalThis.window = { __ModuleLoader__: { load(spec) { captured = spec } } }
let index = 0
let seeds = []
const React = {
  createElement(type, props, ...children) { return { type, props, children } },
  useState(initial) {
    const i = index++
    const seed = seeds[i]
    const value = seed !== undefined ? seed : (typeof initial === 'function' ? initial() : initial)
    return [value, () => {}]
  },
  useEffect() {},
  useRef(value) { return { current: value } },
  useCallback(fn) { return fn },
}
await import('../client.js')
const module = captured.factory((id) => { if (id === 'react') return React; throw new Error('unexpected require ' + id) })
const registered = []
const slots = { inject(name, install) { const d = install(); return typeof d === 'function' ? d : () => {} }, register(spec, component) { registered.push({ slot: spec.name, spec, component }); return () => {} } }
module.apply({ slots, inject(deps, cb) { if (deps.includes('layout')) cb({ slots, layout: { selectPanel() {} } }) }, effect(fn) { fn() } })
const panel = registered.find((e) => e.slot === 'main')
for (const [label, seed] of [['full', snapshot], ['empty', {}]]) {
  index = 0
  seeds = [seed]
  try {
    const tree = panel.component({})
    console.log(label + ': rendered ok, children=' + (Array.isArray(tree?.children) ? tree.children.length : 'n/a'))
  } catch (error) {
    console.log(label + ': THREW ' + error.message)
  }
}