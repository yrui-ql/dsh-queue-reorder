/**
 * Host half of the `dsh-queue-reorder` bundle.
 *
 * The message queue is durable Agent Inbox state: pending prompts live in the
 * `agent/inbox/spliced` event history and are claimed oldest-first when the
 * current turn reaches a step boundary. Moving one row therefore means
 * replacing one contiguous range of the pending `next-turn` list with the same
 * messages in a new order — one splice, one event, no message identity change.
 *
 * The Client drag gesture posts { sessionId, itemId, beforeId, expectedIds }
 * here; the Host re-reads the live order, rejects a stale drag, and applies the
 * splice through the Inbox's non-cancelling mutation path so a reorder is not
 * reported as discarded pending input.
 */
import { planMove, sameOrder } from './reorder.js'

/** Stable Loader identity. */
export const name = 'dsh-queue-reorder'

/** Services this Host plugin borrows; activation waits for both. */
export const inject = ['connection', 'agents']

/** Authenticated route on Connection's shared `/api` channel. */
const MOVE_PATH = '/api/queue.move'

/** One queued row is small; the whole request is bounded. */
const MAX_BODY_BYTES = 32 * 1024
const MAX_IDS = 500
const MAX_TEXT_LENGTH = 512

function jsonResponse(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

function failure(message, status) {
  return jsonResponse({ ok: false, error: message }, status)
}

/** A small JSON object body, or null when the request is not one. */
async function readBody(request) {
  let text
  try {
    text = await request.text()
  } catch {
    return null
  }
  if (text.length > MAX_BODY_BYTES) return null
  try {
    const value = JSON.parse(text)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
    return value
  } catch {
    return null
  }
}

/** Non-empty bounded string, or undefined. */
function text(value) {
  return typeof value === 'string' && value !== '' && value.length <= MAX_TEXT_LENGTH ? value : undefined
}

/** Ordered identity list, or undefined when malformed. */
function identityList(value) {
  if (!Array.isArray(value) || value.length > MAX_IDS) return undefined
  const ids = []
  for (const item of value) {
    if (typeof item !== 'string' || item === '') return undefined
    ids.push(item)
  }
  return ids
}

/**
 * Refuse queue mutation on a session whose subagent identity cannot accept it,
 * mirroring the Session controller's own ownership fence.
 */
function mutableAgent(ctx, agent) {
  const projections = ctx.get('sessionProjections')
  if (projections === undefined || agent.session === undefined) return true
  try {
    const identity = projections.snapshot(agent.session, ['subagent']).values.subagent
    if (identity !== undefined && identity.mode !== 'continuable') return false
  } catch {
    // A projection read that is unavailable cannot prove immutability; the
    // Inbox call below still fails closed on a missing pending list.
  }
  return true
}

/**
 * Move one still-pending message. Returns the new pending order on success.
 * @param {import('@deepseek-ai/cordis').Context} ctx - plugin context.
 * @param {{ sessionId: string, itemId: string, beforeId: string | null, expectedIds?: string[] }} request
 * @returns {Promise<{ ok: true, order: string[] } | { ok: false, status: number, error: string }>}
 */
export async function movePendingMessage(ctx, request) {
  const agent = ctx.agents.get(request.sessionId)
  if (agent === undefined) return { ok: false, status: 404, error: '这个会话当前没有运行中的 Agent，无法调整队列。' }
  if (!mutableAgent(ctx, agent)) return { ok: false, status: 409, error: '当前会话的子代理队列不可调整。' }

  let inbox
  let rows
  try {
    inbox = agent.inbox
    rows = inbox.nextTurn
  } catch {
    return { ok: false, status: 409, error: '这个会话的消息队列当前不可用。' }
  }
  if (!inbox || !Array.isArray(rows)) return { ok: false, status: 409, error: '这个会话的消息队列当前不可用。' }

  const ids = rows.map((message) => message.id)
  if (request.expectedIds !== undefined && !sameOrder(request.expectedIds, ids)) {
    return { ok: false, status: 409, error: '队列已经变化，请重新拖动。' }
  }

  const plan = planMove(ids, request.itemId, request.beforeId)
  if (plan === null) {
    // Already in the requested position (or the row was never pending): the
    // current order is the answer, not an error.
    if (ids.includes(request.itemId)) return { ok: true, order: ids }
    return { ok: false, status: 409, error: '这条消息已经不在待发送队列里了。' }
  }

  const byId = new Map(rows.map((message) => [message.id, message]))
  const inserted = plan.splice.insertedIds.map((id) => byId.get(id))
  if (inserted.some((message) => message === undefined)) {
    return { ok: false, status: 409, error: '队列已经变化，请重新拖动。' }
  }

  // `splice()` is the public Inbox move, but it records removed input as
  // cancelled; a reorder must not look like a cancellation to the goal, subagent
  // and question listeners. The same class exposes the shared mutation step
  // without that annotation, which is what the durable fold needs.
  if (typeof inbox.mutate !== 'function') {
    return { ok: false, status: 501, error: '当前 Harness 版本不支持调整队列顺序。' }
  }
  inbox.mutate('next-turn', plan.splice.start, plan.splice.deleteCount, inserted, false)
  return { ok: true, order: plan.order }
}

export function apply(ctx) {
  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: MOVE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          const body = await readBody(request)
          if (body === null) return failure('请求体必须是 JSON 对象。', 400)

          const sessionId = text(body.sessionId)
          const itemId = text(body.itemId)
          const expectedIds = body.expectedIds === undefined ? undefined : identityList(body.expectedIds)
          const beforeValid = body.beforeId === null || text(body.beforeId) !== undefined
          if (sessionId === undefined || itemId === undefined || !beforeValid || (body.expectedIds !== undefined && expectedIds === undefined)) {
            return failure('缺少队列坐标（sessionId / itemId / beforeId）。', 400)
          }

          const beforeId = body.beforeId === null ? null : text(body.beforeId)
          try {
            const result = await movePendingMessage(ctx, { sessionId, itemId, beforeId, expectedIds })
            if (!result.ok) return failure(result.error, result.status)
            return jsonResponse(result)
          } catch (error) {
            request.signal.throwIfAborted()
            const message = error instanceof Error && error.message !== '' ? error.message : '调整队列失败。'
            return failure(message, 500)
          }
        },
      }),
    'dsh-queue-reorder: POST /api/queue.move',
  )
}
