import assert from 'node:assert/strict'
import { planMove, sameOrder } from '../reorder.js'

/** Apply a plan to a queue, as the Host Inbox splice would. */
function apply(ids, plan) {
  const { start, deleteCount, insertedIds } = plan.splice
  const next = ids.slice()
  next.splice(start, deleteCount, ...insertedIds)
  return next
}

function move(ids, itemId, beforeId) {
  const plan = planMove(ids, itemId, beforeId)
  if (plan === null) return null
  return { order: apply(ids, plan), plan }
}

const base = ['a', 'b', 'c', 'd']

// Moving backwards and forwards.
assert.deepEqual(move(base, 'd', 'b').order, ['a', 'd', 'b', 'c'])
assert.deepEqual(move(base, 'b', 'd').order, ['a', 'c', 'b', 'd'])
assert.deepEqual(move(base, 'c', 'a').order, ['c', 'a', 'b', 'd'])
assert.deepEqual(move(base, 'a', null).order, ['b', 'c', 'd', 'a'])
assert.deepEqual(move(base, 'd', null), null, 'already last')
assert.deepEqual(move(base, 'a', 'b'), null, 'already first')
assert.deepEqual(move(base, 'b', 'a').order, ['b', 'a', 'c', 'd'], 'before its own predecessor')

// A contiguous splice always reproduces the planned order.
for (const itemId of base) {
  for (const beforeId of [...base, null]) {
    const result = move(base, itemId, beforeId)
    if (result === null) continue
    assert.deepEqual(apply(base, result.plan), result.order)
    assert.equal(result.plan.splice.insertedIds.length, result.plan.splice.deleteCount)
    assert.deepEqual(new Set(result.order), new Set(base))
  }
}

// Unknown identities and malformed requests are rejected.
assert.equal(planMove(base, 'zz', null), null)
assert.equal(planMove(base, 'a', 'zz'), null)
assert.equal(planMove([], 'a', null), null)
assert.equal(planMove(base, '', null), null)
assert.equal(planMove(base, 'a', undefined), null)

// Two rows and a self-anchor.
assert.deepEqual(move(['a', 'b'], 'b', 'a').order, ['b', 'a'])
assert.equal(planMove(['a', 'b'], 'a', 'a'), null)

// Client/Host race detection.
assert.equal(sameOrder(['a', 'b'], ['a', 'b']), true)
assert.equal(sameOrder(['a', 'b'], ['b', 'a']), false)
assert.equal(sameOrder(['a'], ['a', 'b']), false)
assert.equal(sameOrder(undefined, ['a']), false)

console.log('queue reorder: all assertions passed')
