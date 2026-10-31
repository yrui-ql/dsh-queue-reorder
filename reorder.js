/**
 * Pure ordering math for the pending-message queue.
 *
 * A queue reorder must be durable and must not look like a cancellation: the
 * Agent Inbox records pending input through `agent/inbox/spliced` events, and a
 * single splice that replaces one contiguous range with the same messages in a
 * new order is exactly a move. This module only decides that range; the Host
 * half applies it to the live Inbox.
 */

/**
 * Plan one contiguous splice that moves `itemId` in `ids` to a new position.
 *
 * @param {readonly string[]} ids - current pending order (oldest first).
 * @param {string} itemId - identity to move.
 * @param {string | null} beforeId - insert the moved item before this identity;
 *   `null` appends it after the last pending message.
 * @returns {null | {
 *   order: string[],
 *   splice: { start: number, deleteCount: number, insertedIds: string[] },
 * }} `null` when the request is invalid or is already the current order.
 */
export function planMove(ids, itemId, beforeId) {
  if (!Array.isArray(ids) || ids.length === 0) return null
  if (typeof itemId !== 'string' || itemId === '') return null
  if (beforeId !== null && typeof beforeId !== 'string') return null

  const from = ids.indexOf(itemId)
  if (from < 0) return null

  // Remove first, then insert before the anchor: this keeps the move correct in
  // both directions without an off-by-one correction.
  const order = ids.slice()
  const [moved] = order.splice(from, 1)
  let insertAt = order.length
  if (beforeId !== null) {
    insertAt = order.indexOf(beforeId)
    if (insertAt < 0) return null
  }
  order.splice(insertAt, 0, moved)

  if (order.every((id, index) => id === ids[index])) return null

  // The moved item only travels between its old and new slot, so one contiguous
  // splice is enough: replace [lo, hi] with the same messages in the new order.
  const to = order.indexOf(moved)
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  return {
    order,
    splice: {
      start,
      deleteCount: end - start + 1,
      insertedIds: order.slice(start, end + 1),
    },
  }
}

/**
 * Compare a client-observed pending order with the current one.
 * @param {readonly string[]} expected - order the client acted on.
 * @param {readonly string[]} current - order read by the Host.
 * @returns {boolean} whether both describe the same pending rows.
 */
export function sameOrder(expected, current) {
  if (!Array.isArray(expected) || !Array.isArray(current)) return false
  if (expected.length !== current.length) return false
  for (let index = 0; index < expected.length; index += 1) {
    if (expected[index] !== current[index]) return false
  }
  return true
}
