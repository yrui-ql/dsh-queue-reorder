/**
 * Client-half render harness: executes the browser module against a tiny React
 * and Cordis stand-in, then drives the gestures (expand, keyboard move, drop,
 * edit, remove, steer) and asserts the calls the real services would receive.
 *
 * This does not replace a browser check; it catches the render-time crashes and
 * wrong payloads that a static read cannot prove.
 */
import assert from 'node:assert/strict'

/* ---------- tiny React ---------- */

function createElement(type, config, ...children) {
  const props = { ...(config ?? {}) }
  if (children.length === 1) props.children = children[0]
  else if (children.length > 1) props.children = children
  return { type, props }
}

const hooks = []
let hookIndex = 0
let effects = []

const React = {
  createElement,
  useState(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
    const set = (next) => {
      hooks[index] = typeof next === 'function' ? next(hooks[index]) : next
    }
    return [hooks[index], set]
  },
  useRef(initial) {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = { current: initial }
    return hooks[index]
  },
  useMemo(fn) {
    return fn()
  },
  useCallback(fn) {
    return fn
  },
  useEffect(fn) {
    effects.push(fn)
  },
  useId() {
    const index = hookIndex++
    if (!(index in hooks)) hooks[index] = 'dqr-id-' + String(index)
    return hooks[index]
  },
}

/* ---------- element walkers ---------- */

function walk(node, out = []) {
  if (node === null || node === undefined || typeof node !== 'object') return out
  if (Array.isArray(node)) {
    for (const item of node) walk(item, out)
    return out
  }
  out.push(node)
  if (node.props !== undefined) walk(node.props.children, out)
  return out
}

function byClass(tree, token) {
  return walk(tree).filter((element) => typeof element.props?.className === 'string' && element.props.className.split(' ').some((name) => name.includes(token)))
}

function byLabel(tree, label) {
  return walk(tree).filter((element) => element.props?.['aria-label'] === label)
}

/* ---------- module load ---------- */

let factory = null
globalThis.window = {
  __ModuleLoader__: {
    load(definition) {
      assert.equal(definition.id, 'dsh-queue-reorder')
      factory = definition.factory
    },
  },
}
globalThis.document = {
  createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
  head: { appendChild() {} },
  elementFromPoint: () => null,
}

/* ---------- animation frame + DOM stand-ins ---------- */

const frames = []
let nextFrameId = 0
globalThis.requestAnimationFrame = (callback) => {
  nextFrameId += 1
  frames.push({ id: nextFrameId, callback })
  return nextFrameId
}
globalThis.cancelAnimationFrame = (id) => {
  const index = frames.findIndex((frame) => frame.id === id)
  if (index >= 0) frames.splice(index, 1)
}
function runFrame() {
  const frame = frames.shift()
  if (frame !== undefined) frame.callback()
}
/** A row stub for `document.elementFromPoint`. */
function rowNode(index, top, height = 36) {
  return {
    dataset: { queueIndex: String(index) },
    closest(selector) {
      return selector === '[data-queue-index]' ? this : null
    },
    getBoundingClientRect: () => ({ top, bottom: top + height, height, left: 40, right: 300, width: 260 }),
  }
}

await import(new URL('../client.js', import.meta.url).href)
assert.equal(typeof factory, 'function', 'client module registers a factory')

const plugin = factory((name) => {
  if (name === 'react') return React
  throw new Error('unexpected module: ' + name)
})

/* ---------- fake services ---------- */

const ACTION_CALLS = []
const MOVE_CALLS = []
const NOTICES = []

const t = (key, params) => (params === undefined ? key : key + '(' + JSON.stringify(params) + ')')

const conversation = {
  async updateQueue(itemId, action) {
    ACTION_CALLS.push({ itemId, action })
    return { accepted: true }
  },
  input: { for: () => ({ notify: (level, text) => NOTICES.push({ level, text }) }) },
}

const registered = []
const ctx = {
  effect(fn) {
    fn()
    return () => {}
  },
  locale: { register() {}, bind: () => t },
  slots: {
    inject(_key, callback) {
      callback()
      return () => {}
    },
    register(options, component) {
      registered.push({ options, component })
      return () => {}
    },
  },
  sessions: {
    scope(sessionId) {
      if (sessionId !== 'session') return undefined
      return { get: (name) => (name === 'conversation' ? conversation : undefined) }
    },
  },
  get: (name) => (name === 'uiConversation' ? { imageUrl: async () => null } : undefined),
}

plugin.apply(ctx)

/* ---------- registration ---------- */

assert.equal(registered.length, 1)
const entry = registered[0]
assert.equal(entry.options.name, 'conversation.input.dock')
assert.equal(entry.options.id, 'queue')
assert.equal(entry.options.order, 20)
assert.equal(entry.options.priority, -1, 'a negative priority shadows the shipped dock')
assert.equal(entry.options.locale, 'dsh-queue-reorder')
assert.equal(typeof entry.options.inject, 'function')

const injected = entry.options.inject('session')
assert.equal(typeof injected.updateQueue, 'function')
assert.equal(typeof injected.moveItem, 'function')
assert.equal(typeof injected.notify, 'function')
assert.equal(typeof injected.loadImage, 'function')

/* ---------- render harness ---------- */

function makeProps(messages, snapshotPatch) {
  const snapshot = {
    pendingSubmissions: [],
    running: false,
    subagent: null,
    ...snapshotPatch,
  }
  const inbox = { 'next-turn': messages }
  return {
    ...injected,
    useProjection: (key) => (key === 'inbox' ? inbox : undefined),
    useSession: (selector) => selector(snapshot),
    renderFactorySlot: (_name, renderProps) => renderProps.text,
    t,
    updateQueue: injected.updateQueue,
    moveItem: async (payload) => {
      MOVE_CALLS.push(payload)
      return { ok: true, order: [] }
    },
    notify: injected.notify,
  }
}

const MESSAGES = [
  { id: 'm1', source: { kind: 'user', rpcId: 'r1' }, content: [{ type: 'text', text: 'first' }] },
  { id: 'm2', source: { kind: 'user', rpcId: 'r2' }, content: [{ type: 'text', text: 'second' }] },
  { id: 'm3', source: { kind: 'user', rpcId: 'r3' }, content: [{ type: 'text', text: 'third' }] },
]

function createHarness(props, domOverrides = {}) {
  hooks.length = 0
  const dom = { scrollTop: 0, clientHeight: 60, scrollHeight: 60, ...domOverrides }
  const listNode = {
    get scrollTop() {
      return dom.scrollTop
    },
    set scrollTop(value) {
      dom.scrollTop = value
    },
    get clientHeight() {
      return dom.clientHeight
    },
    get scrollHeight() {
      return dom.scrollHeight
    },
    getBoundingClientRect: () => ({ top: 100, bottom: 160, height: 60, left: 40, right: 300, width: 260 }),
    contains: () => true,
  }
  const render = () => {
    hookIndex = 0
    effects = []
    const tree = entry.component(props)
    for (const element of walk(tree)) {
      const ref = element.props?.ref
      if (ref !== null && typeof ref === 'object' && ref.current === null) ref.current = listNode
    }
    const cleanups = []
    for (const effect of effects) {
      const cleanup = effect()
      if (typeof cleanup === 'function') cleanups.push(cleanup)
    }
    return tree
  }
  return { props, render, cleanups: [], dom, listNode }
}

async function flush() {
  await Promise.resolve()
  await Promise.resolve()
}

/** Open the collapsed multi-message dock so its rows and actions render. */
function expand(harness) {
  const tree = harness.render()
  const header = walk(tree).find((element) => typeof element.props?.className === 'string' && element.props.className.includes('header'))
  header.props.onClick()
  return harness.render()
}

/* ---------- empty queue renders nothing ---------- */

const empty = createHarness(makeProps([]))
assert.equal(empty.render(), null)

/* ---------- expand, rows and grips ---------- */

const client = createHarness(makeProps(MESSAGES))
let tree = client.render()
const headers = walk(tree).filter((element) => typeof element.props?.className === 'string' && element.props.className.includes('header'))
assert.equal(headers.length, 1, 'collapsed header renders for multiple messages')
assert.equal(headers[0].props['aria-expanded'], false)
assert.match(headers[0].props.children[1].props.children, /count/)

headers[0].props.onClick()
tree = client.render()
const rows = byClass(tree, 'dqr_row').filter((element) => element.type === 'li')
assert.equal(rows.length, 3)
const grips = byClass(tree, 'dqr_grip')
assert.equal(grips.length, 3)
assert.equal(grips[0].props.draggable, true)

/* ---------- keyboard moves ---------- */

const event = (key) => ({ key, preventDefault() {}, currentTarget: null })
await grips[0].props.onKeyDown(event('ArrowDown'))
await flush()
assert.deepEqual(MOVE_CALLS.at(-1), { itemId: 'm1', beforeId: 'm3', expectedIds: ['m1', 'm2', 'm3'] })

tree = client.render()
await byClass(tree, 'dqr_grip')[1].props.onKeyDown(event('ArrowUp'))
await flush()
assert.deepEqual(MOVE_CALLS.at(-1), { itemId: 'm2', beforeId: 'm1', expectedIds: ['m1', 'm2', 'm3'] })

tree = client.render()
await byClass(tree, 'dqr_grip')[2].props.onKeyDown(event('Home'))
await flush()
assert.deepEqual(MOVE_CALLS.at(-1), { itemId: 'm3', beforeId: 'm1', expectedIds: ['m1', 'm2', 'm3'] })

tree = client.render()
await byClass(tree, 'dqr_grip')[0].props.onKeyDown(event('End'))
await flush()
assert.deepEqual(MOVE_CALLS.at(-1), { itemId: 'm1', beforeId: null, expectedIds: ['m1', 'm2', 'm3'] })

/* ---------- drag and drop ---------- */

tree = client.render()
const dragGrip = byClass(tree, 'dqr_grip')[1]
let transferred = null
dragGrip.props.onDragStart({
  dataTransfer: {
    set effectAllowed(value) {},
    setData(_type, value) {
      transferred = value
    },
  },
})
assert.equal(transferred, 'm2')
const rowList = byClass(tree, 'dqr_row').filter((element) => element.type === 'li')
const dropEvent = {
  preventDefault() {},
  clientY: 0,
  currentTarget: {
    getBoundingClientRect: () => ({ top: 10, height: 20 }),
  },
}
rowList[0].props.onDrop(dropEvent)
await flush()
assert.deepEqual(MOVE_CALLS.at(-1), { itemId: 'm2', beforeId: 'm1', expectedIds: ['m1', 'm2', 'm3'] })

/* ---------- inline edit, remove, steer ---------- */

tree = client.render()
byLabel(tree, 'edit')[0].props.onClick()
tree = client.render()
const textarea = walk(tree).find((element) => element.type === 'textarea')
assert.equal(textarea.props.value, 'first')
textarea.props.onChange({ target: { value: 'changed' } })
tree = client.render()
await byLabel(tree, 'save')[0].props.onClick()
await flush()
assert.deepEqual(ACTION_CALLS.at(-1), { itemId: 'm1', action: { kind: 'edit', content: [{ type: 'text', text: 'changed' }] } })

/* A successful edit keeps the editor open until the projection replaces the row,
 * so removal and steering are exercised on fresh harnesses. */
const removal = createHarness(makeProps(MESSAGES))
tree = expand(removal)
await byLabel(tree, 'remove')[0].props.onClick()
await flush()
assert.deepEqual(ACTION_CALLS.at(-1), { itemId: 'm1', action: { kind: 'remove' } })

/* Steer is only enabled while a turn runs. */
const idle = createHarness(makeProps(MESSAGES))
tree = expand(idle)
assert.equal(byLabel(tree, 'steer')[0].props.disabled, true)
const running = createHarness(makeProps(MESSAGES, { running: true }))
tree = expand(running)
await byLabel(tree, 'steer')[0].props.onClick()
await flush()
assert.deepEqual(ACTION_CALLS.at(-1), { itemId: 'm1', action: { kind: 'steer' } })

/* ---------- local send-in-progress row ---------- */

const pending = createHarness(makeProps([], {
  pendingSubmissions: [{ requestId: 'p1', placement: 'queued', text: 'waiting', attachments: [] }],
}))
tree = pending.render()
assert.equal(byClass(tree, 'dqr_row').filter((element) => element.type === 'li').length, 1)
assert.ok(walk(tree).some((element) => element.props?.children === 'sending'), 'send-in-progress status is visible')

/* ---------- drag auto-scroll for a long queue ---------- */

const LONG = Array.from({ length: 8 }, (_, index) => ({
  id: 'L' + index,
  source: { kind: 'user', rpcId: 'lr' + index },
  content: [{ type: 'text', text: 'message ' + index }],
}))

const auto = createHarness(makeProps(LONG), { scrollTop: 120, clientHeight: 60, scrollHeight: 320 })
tree = expand(auto)
const listEl = walk(tree).find((element) => typeof element.props?.className === 'string' && element.props.className.includes('dqr_list'))
const listNode = listEl.props.ref.current
assert.equal(listNode.scrollTop, 120)
const dockEl = walk(tree).find((element) => element.props !== undefined && 'data-queue-dock' in element.props)
const dragEvent = (clientX, clientY) => ({
  clientX,
  clientY,
  preventDefault() {},
  relatedTarget: null,
  dataTransfer: null,
})

// Dragging upward near the top edge scrolls the list without pointer movement.
const longGrips = byClass(tree, 'dqr_grip')
// The frame loop starts on the first drag movement (a dragover), not on the
// grab itself, so grabbing a row that happens to sit near an edge cannot scroll
// the list before the user has moved.
longGrips[0].props.onDragStart({
  clientX: 120,
  clientY: 130,
  dataTransfer: { effectAllowed: '', setData() {} },
})
assert.equal(frames.length, 0, 'a grab alone does not start auto-scroll')

dockEl.props.onDragOver(dragEvent(120, 108))
assert.equal(frames.length, 1, 'the first drag movement starts the auto-scroll frame')
globalThis.document.elementFromPoint = () => rowNode(0, 120)
runFrame()
assert.ok(listNode.scrollTop < 120, 'pointer near the top edge scrolls up')
const scrolledOnce = listNode.scrollTop

tree = auto.render()
const autoList = walk(tree).find((element) => typeof element.props?.className === 'string' && element.props.className.includes('dqr_list'))
assert.equal(autoList.props['data-autoscroll'], 'up')
assert.equal(byClass(tree, 'dqr_row').filter((element) => element.props?.['data-drop'] === 'before').length, 1, 'drop marker follows the row under the pointer')

// Repeated frames keep scrolling until the top, then stay clamped.
while (listNode.scrollTop > 0 && frames.length > 0) runFrame()
assert.equal(listNode.scrollTop, 0, 'top edge clamps at scrollTop 0')
runFrame()
assert.equal(listNode.scrollTop, 0)

// The bottom edge scrolls the other way.
dockEl.props.onDragOver(dragEvent(120, 154))
runFrame()
assert.ok(listNode.scrollTop > 0, 'pointer near the bottom edge scrolls down')

// A pointer away from the list horizontally does not scroll.
const beforeShift = listNode.scrollTop
dockEl.props.onDragOver(dragEvent(900, 110))
runFrame()
assert.equal(listNode.scrollTop, beforeShift, 'auto-scroll ignores pointers outside the list width')

// Dropping or ending the drag cancels the loop.
longGrips[0].props.onDragEnd()
assert.equal(frames.length, 0, 'drag end cancels the pending auto-scroll frame')

globalThis.document.elementFromPoint = () => null

console.log('queue reorder client: all assertions passed')
