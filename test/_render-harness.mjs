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
const module = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error('unexpected require ' + id)
})

const registered = []
const slots = {
  inject(name, install) { const d = install(); return typeof d === 'function' ? d : () => {} },
  register(spec, component) { registered.push({ slot: spec.name, spec, component }); return () => {} },
}
module.apply({
  slots,
  inject(deps, cb) { if (deps.includes('layout')) cb({ slots, layout: { selectPanel() {} } }) },
  effect(fn) { fn() },
})

const panel = registered.find((entry) => entry.slot === 'main')
const wrapper = panel.component({})
const Inner = wrapper.type

function walk(node, out) {
  if (node === null || node === undefined) return
  if (typeof node === 'string' || typeof node === 'number') { out.texts.push(String(node)); return }
  if (Array.isArray(node)) { for (const item of node) walk(item, out); return }
  if (typeof node === 'object' && node.type) { out.nodes += 1; walk(node.children, out) }
}

for (const [label, seed] of [['full', snapshot], ['empty', {}]]) {
  index = 0
  seeds = [seed]
  try {
    const tree = Inner({})
    const out = { nodes: 0, texts: [] }
    walk(tree, out)
    console.log(label + ': ok nodes=' + out.nodes
      + ' has申请=' + out.texts.some((t) => t.includes('分群网页申请'))
      + ' has欢迎=' + out.texts.some((t) => t.includes('入群欢迎与群管理'))
      + ' texts=' + out.texts.length)
  } catch (error) {
    console.log(label + ': THREW ' + (error && error.message))
  }
}
