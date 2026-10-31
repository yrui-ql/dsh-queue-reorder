/**
 * Host-half tests: the Inbox splice and the authenticated route shape.
 *
 * A fake Inbox records the single mutation the real `ReactLoopInbox` would
 * commit, so a reorder is proven to be one splice with no cancelled rows.
 */
import assert from 'node:assert/strict'
import { apply, movePendingMessage } from '../index.js'

/** Minimal Inbox over plain ids; `mutate` is the non-cancelling path the Host uses. */
function makeInbox(ids) {
  const messages = ids.map((id) => ({ id }))
  const calls = []
  const inbox = {
    calls,
    get nextTurn() {
      return messages
    },
    mutate(target, start, deleteCount, inserted, discardRemoved) {
      assert.equal(target, 'next-turn')
      calls.push({ start, deleteCount, inserted: inserted.map((message) => message.id), discardRemoved })
      messages.splice(start, deleteCount, ...inserted)
    },
  }
  return inbox
}

function contextFor(inbox) {
  const agent = inbox === undefined ? undefined : { inbox, session: { id: 'session' } }
  return {
    agents: { get: (id) => (id === 'session' ? agent : undefined) },
    get: () => undefined,
    effect: (fn) => {
      fn()
    },
    connection: {
      fetch: {
        register(route) {
          contextFor.route = route
          return () => {}
        },
      },
    },
  }
}

const inbox = makeInbox(['a', 'b', 'c'])
const ctx = contextFor(inbox)

// Move the newest message in front of the oldest: one contiguous splice.
const moved = await movePendingMessage(ctx, { sessionId: 'session', itemId: 'c', beforeId: 'a', expectedIds: ['a', 'b', 'c'] })
assert.deepEqual(moved, { ok: true, order: ['c', 'a', 'b'] })
assert.deepEqual(inbox.calls, [{ start: 0, deleteCount: 3, inserted: ['c', 'a', 'b'], discardRemoved: false }])
assert.deepEqual(inbox.nextTurn.map((message) => message.id), ['c', 'a', 'b'])

// Move the first message after the last one.
const second = await movePendingMessage(ctx, { sessionId: 'session', itemId: 'c', beforeId: null })
assert.equal(second.ok, true)
assert.deepEqual(second.order, ['a', 'b', 'c'])
assert.equal(inbox.calls.length, 2)

// A stale drag is rejected instead of reordering a changed queue.
const conflict = await movePendingMessage(ctx, { sessionId: 'session', itemId: 'a', beforeId: null, expectedIds: ['a', 'x', 'c'] })
assert.equal(conflict.ok, false)
assert.equal(conflict.status, 409)

// Unknown rows, unknown sessions and no-op positions.
assert.equal((await movePendingMessage(ctx, { sessionId: 'session', itemId: 'zz', beforeId: null })).status, 409)
assert.equal((await movePendingMessage(ctx, { sessionId: 'missing', itemId: 'a', beforeId: null })).status, 404)
const noop = await movePendingMessage(ctx, { sessionId: 'session', itemId: 'a', beforeId: 'a' })
assert.deepEqual(noop, { ok: true, order: ['a', 'b', 'c'] })

// The registered route validates input and maps failures to HTTP statuses.
apply(ctx)
const route = contextFor.route
assert.equal(route.path, '/api/queue.move')
assert.deepEqual(route.methods, ['POST'])

const post = (body) => route.fetch(new Request('http://127.0.0.1/api/queue.move', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
}))

const bad = await post({ sessionId: 'session' })
assert.equal(bad.status, 400)

const conflicted = await post({ sessionId: 'session', itemId: 'a', beforeId: null, expectedIds: ['zz'] })
assert.equal(conflicted.status, 409)
assert.equal((await conflicted.json()).ok, false)

const ok = await post({ sessionId: 'session', itemId: 'b', beforeId: 'a' })
assert.equal(ok.status, 200)
assert.deepEqual((await ok.json()).order, ['b', 'a', 'c'])

console.log('queue reorder host: all assertions passed')
