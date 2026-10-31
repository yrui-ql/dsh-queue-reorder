/**
 * Client half of the `dsh-queue-reorder` bundle.
 *
 * The shipped `conversation.input.dock` slot keys its cells by id, and re-using
 * the shipped `queue` id replaces that cell. This module therefore owns the
 * message-queue dock and adds one gesture the shipped dock does not have:
 * drag a queued message (or focus its grip and press ArrowUp / ArrowDown /
 * Home / End) to change the order in which pending messages will be sent.
 *
 * Everything else the shipped dock offered is kept: the collapsible count
 * header, text previews, image thumbnails and file chips, inline editing,
 * removal, "steer into the running turn", and the local send-in-progress rows
 * that appear before the Host queue admits a submission.
 *
 * The order itself is durable Host state. The drag only posts coordinates to
 * `/api/queue.move`; the Host applies one Inbox splice and the projection
 * refreshes this list.
 */
window.__ModuleLoader__.load({
  id: 'dsh-queue-reorder',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Locale namespace owned by this package. */
    const NS = 'dsh-queue-reorder'
    /** Class prefix so copied dock styles stay scoped. */
    const P = 'dqr_'
    const STYLE_ID = 'dsh-queue-reorder/styles'
    const EMPTY = []
    const TEXT_FACTS = { collapseWhitespace: true, trimWhitespace: true }

    /**
     * Drag auto-scroll: how close to a list edge (px) starts scrolling, and the
     * per-frame travel at the edge and at the start of the hot zone. The queue
     * list is short (180px), so a long queue needs this to be reachable while
     * dragging from one end to the other.
     */
    const SCROLL_EDGE = 34
    const SCROLL_MAX_STEP = 18
    const SCROLL_MIN_STEP = 3

    /**
     * One frame of auto-scroll travel for a pointer this far from the edge.
     * @param {number} distance - px from the list edge (negative outside it).
     * @returns {number} px to add to scrollTop, always at least SCROLL_MIN_STEP.
     */
    function scrollStep(distance) {
      const depth = Math.max(0, Math.min(SCROLL_EDGE, distance))
      return Math.round(SCROLL_MIN_STEP + (SCROLL_MAX_STEP - SCROLL_MIN_STEP) * (1 - depth / SCROLL_EDGE))
    }

    /**
     * Dock styles. The layout half mirrors the shipped queue dock so the new
     * cell still stacks on the composer; the grip, drop line and editor styles
     * are this plugin's own.
     */
    const CSS = `
.${P}dock{box-sizing:border-box;width:calc(100% - var(--dsh-composer-side-clearance) - var(--dsh-composer-side-clearance) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));max-width:calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) - var(--dsh-composer-dock-inset));margin:0 auto calc(0px - var(--dsh-composer-stack-gap) - 3px);padding:0 var(--dsh-composer-dock-inset);flex:none}
.${P}panel{isolation:isolate;border-radius:var(--dsw-radius-lg) var(--dsw-radius-lg) 0 0;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);width:100%;padding:2px 0;position:relative;overflow:hidden}
.${P}panel:before{z-index:-1;border-radius:inherit;background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);content:"";pointer-events:none;position:absolute;inset:0}
.${P}panel:after{border:.5px solid var(--dsw-alias-border-l1);border-radius:inherit;content:"";pointer-events:none;border-bottom:none;position:absolute;inset:0}
.${P}header{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:100%;height:36px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:none;align-items:center;gap:10px;padding:4px 12px;display:flex}
.${P}header:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.${P}header:disabled{cursor:default}
.${P}lead{color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.${P}count{min-width:0;font-family:Inter, var(--dsw-font-family);flex:auto;font-size:13px;font-weight:500;line-height:24px}
.${P}hint{color:var(--dsw-alias-label-tertiary);flex:none;white-space:nowrap;font-size:12px;line-height:18px}
.${P}chevron{width:14px;height:14px;color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.${P}list{max-height:180px;margin:0;padding:0;list-style:none;overflow-y:auto;overscroll-behavior:contain}
.${P}list[data-autoscroll="up"]{box-shadow:inset 0 18px 18px -18px var(--dsw-alias-brand-primary)}
.${P}list[data-autoscroll="down"]{box-shadow:inset 0 -18px 18px -18px var(--dsw-alias-brand-primary)}
.${P}row{box-sizing:border-box;border-radius:var(--dsw-radius-md);align-items:center;gap:10px;width:100%;min-height:36px;padding:4px 5px 4px 8px;display:flex;position:relative}
.${P}row+.${P}row{box-shadow:inset 0 1px 0 var(--dsw-alias-border-l1)}
.${P}row[data-dragging="yes"]{opacity:.4}
.${P}row[data-drop="before"]{box-shadow:inset 0 2px 0 var(--dsw-alias-brand-primary)}
.${P}row[data-drop="after"]{box-shadow:inset 0 -2px 0 var(--dsw-alias-brand-primary)}
.${P}grip{corner-shape:round;width:22px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:grab;background:0 0;border:none;border-radius:var(--dsw-radius-sm);flex:none;place-items:center;padding:0;display:grid;touch-action:none}
.${P}grip:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.${P}grip:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.${P}grip:active{cursor:grabbing}
.${P}grip:disabled{cursor:default;opacity:.4}
.${P}attachments{flex:none;gap:4px;min-width:0;max-width:55%;display:flex;overflow:hidden}
.${P}pendingRow .${P}attachments{flex-shrink:1}
.${P}file{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);box-sizing:border-box;flex:0 180px;align-items:center;gap:4px;min-width:74px;height:24px;padding:0 6px;display:inline-flex;overflow:hidden}
.${P}fileIcon{flex:none;width:16px;height:16px;display:inline-flex}
.${P}fileName{min-width:0;color:var(--dsw-alias-label-primary-dimmed);font:var(--dsw-font-xs-13);text-overflow:ellipsis;white-space:nowrap;overflow:hidden}
.${P}fileSize{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;font-size:10px}
.${P}thumb{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-xs);background:var(--dsw-alias-bg-base);object-fit:cover;width:24px;height:24px}
.${P}preview{min-width:0;font:var(--dsw-font-xs-13);font-family:Inter, var(--dsw-font-family);color:var(--dsw-alias-label-primary-dimmed);flex:auto}
.${P}actions{flex:none;align-items:center;gap:10px;display:flex}
.${P}status{color:var(--dsw-alias-label-tertiary);font:var(--dsw-font-xs-13);white-space:nowrap;flex:none}
.${P}action{corner-shape:round;width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:none;border-radius:999px;flex:none;place-items:center;padding:0;display:grid}
.${P}action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${P}action:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.${P}action:disabled{cursor:default;opacity:.45}
.${P}editor{min-width:0;flex:auto}
.${P}textarea{box-sizing:border-box;width:100%;min-height:32px;max-height:120px;resize:vertical;border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;padding:5px 8px}
.${P}textarea:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:-2px}
.${P}live{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}
`

    const ZH = {
      count: '{n} 条排队消息',
      sending: '发送中…',
      image: '排队消息图片',
      file: '排队文件 {name}',
      edit: '编辑排队消息',
      editUnsupported: '包含非文本内容，暂不支持编辑',
      save: '保存排队消息',
      cancelEdit: '取消编辑',
      remove: '删除排队消息',
      steer: '插话发送',
      steerUnavailable: '仅运行中可插话发送',
      editFailed: '编辑失败：这条消息可能已经开始发送。',
      removeFailed: '删除失败：这条消息可能已经开始发送。',
      steerFailed: '插话发送失败，请重试。',
      dragHint: '拖动调整发送顺序（拖到上下边缘自动滚动）；聚焦后可用 ↑ ↓ Home End 移动',
      gripLabel: '第 {pos} 条，共 {total} 条：拖动或用方向键调整发送顺序',
      hint: '拖动 ⠿ 调整发送顺序',
      moved: '已调整顺序：这条消息现在是第 {pos} 条，共 {total} 条',
      reorderFailed: '调整顺序失败，请重试。',
      unavailable: '当前环境不支持调整消息队列。',
    }

    const EN = {
      count: '{n} queued messages',
      sending: 'Sending…',
      image: 'Queued message image',
      file: 'Queued file {name}',
      edit: 'Edit queued message',
      editUnsupported: 'Contains non-text content; editing is not supported yet',
      save: 'Save queued message',
      cancelEdit: 'Cancel editing',
      remove: 'Remove queued message',
      steer: 'Steer queued message',
      steerUnavailable: 'Steering is available only while the agent is running',
      editFailed: 'Edit failed: this message may have already started sending.',
      removeFailed: 'Removal failed: this message may have already started sending.',
      steerFailed: 'Steering failed. Try again.',
      dragHint: 'Drag to change send order (auto-scrolls near the list edges); focus the grip and use ↑ ↓ Home End',
      gripLabel: 'Queued message {pos} of {total}: drag or use the arrow keys to reorder',
      hint: 'Drag ⠿ to reorder',
      moved: 'Order changed: this message is now number {pos} of {total}',
      reorderFailed: 'Could not reorder the queue. Try again.',
      unavailable: 'This environment cannot reorder the message queue.',
    }

    /* ---------- icons ---------- */

    function svg(size, children) {
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': '1.4',
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        focusable: 'false',
      }, children)
    }

    const iconQueue = () => svg(15, [
      h('path', { key: 'a', d: 'M2.6 4.2h10.8M2.6 8h10.8M2.6 11.8h10.8' }),
    ])
    const iconChevronDown = () => svg(14, [h('path', { key: 'a', d: 'M4.2 6.2 8 10l3.8-3.8' })])
    const iconChevronUp = () => svg(14, [h('path', { key: 'a', d: 'M4.2 9.8 8 6l3.8 3.8' })])
    const iconGrip = () => svg(14, [
      h('circle', { key: 'a', cx: 5.6, cy: 4.4, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      h('circle', { key: 'b', cx: 10.4, cy: 4.4, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      h('circle', { key: 'c', cx: 5.6, cy: 8, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      h('circle', { key: 'd', cx: 10.4, cy: 8, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      h('circle', { key: 'e', cx: 5.6, cy: 11.6, r: 1.05, fill: 'currentColor', stroke: 'none' }),
      h('circle', { key: 'f', cx: 10.4, cy: 11.6, r: 1.05, fill: 'currentColor', stroke: 'none' }),
    ])
    const iconEdit = () => svg(14, [h('path', { key: 'a', d: 'M9.7 3.1l3.2 3.2-6.6 6.6-3.6.4.4-3.6z' })])
    const iconTrash = () => svg(14, [
      h('path', { key: 'a', d: 'M3.4 4.6h9.2' }),
      h('path', { key: 'b', d: 'M6 4.6V3.2h4v1.4' }),
      h('path', { key: 'c', d: 'M4.6 4.6l.6 8h5.6l.6-8' }),
    ])
    const iconSend = () => svg(14, [h('path', { key: 'a', d: 'M2.8 8h10M8.4 3.6 12.8 8l-4.4 4.4' })])
    const iconCheck = () => svg(14, [h('path', { key: 'a', d: 'M3.2 8.4l3.2 3.2 6.4-7.2' })])
    const iconClose = () => svg(14, [h('path', { key: 'a', d: 'M4 4l8 8M12 4l-8 8' })])

    /* ---------- small helpers ---------- */

    /** Text of a row's content when every block is text, else null. */
    function textOf(content) {
      if (!Array.isArray(content) || content.some((block) => block === null || typeof block !== 'object' || block.type !== 'text')) return null
      return content.map((block) => block.text).join('')
    }

    /** Durable image/file references carried by one queued row. */
    function attachmentsOf(content) {
      const attachments = []
      if (!Array.isArray(content)) return attachments
      for (const block of content) {
        if (block === null || typeof block !== 'object') continue
        if ((block.type === 'image' || block.type === 'file') && block.attachment !== undefined) {
          attachments.push({ type: block.type, attachment: block.attachment })
        }
      }
      return attachments
    }

    /** Compact byte count for a file chip. */
    function sizeText(bytes) {
      const value = typeof bytes === 'number' && Number.isFinite(bytes) && bytes >= 0 ? bytes : 0
      if (value < 1024) return value + ' B'
      if (value < 1024 * 1024) return (value / 1024).toFixed(value < 10 * 1024 ? 1 : 0) + ' KB'
      return (value / (1024 * 1024)).toFixed(1) + ' MB'
    }

    /** Trimmed single-line text for an announcement. */
    function condense(text, max) {
      const flat = String(text).replace(/\s+/g, ' ').trim()
      return flat.length > max ? flat.slice(0, max) + '…' : flat
    }

    /** POST a small JSON object and surface the route's own failure text. */
    async function postJson(route, body) {
      const response = await fetch(route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      let payload = null
      try {
        payload = await response.json()
      } catch {}
      if (payload !== null && typeof payload === 'object' && payload.ok === false) {
        throw new Error(typeof payload.error === 'string' && payload.error !== '' ? payload.error : 'HTTP ' + String(response.status))
      }
      if (!response.ok) throw new Error('HTTP ' + String(response.status))
      return payload === null ? {} : payload
    }

    /* ---------- pieces ---------- */

    function QueueFile({ attachment, label }) {
      return h('span', { className: P + 'file', 'aria-label': label, title: attachment.name }, [
        h('span', { key: 'i', className: P + 'fileIcon', 'aria-hidden': 'true' }, iconQueue()),
        h('span', { key: 'n', className: P + 'fileName' }, attachment.name),
        h('span', { key: 's', className: P + 'fileSize' }, sizeText(attachment.bytes)),
      ])
    }

    function QueueThumb({ attachment, loadImage, label }) {
      const [url, setUrl] = React.useState(null)
      React.useEffect(() => {
        let alive = true
        Promise.resolve()
          .then(() => loadImage(attachment))
          .then((resolved) => {
            if (alive && typeof resolved === 'string') setUrl(resolved)
          }, () => {})
        return () => {
          alive = false
        }
      }, [attachment, loadImage])
      if (url === null) return h('span', { className: P + 'thumb', 'aria-hidden': 'true' })
      return h('img', { className: P + 'thumb', src: url, alt: label })
    }

    /**
     * The message-queue strip.
     *
     * @param props - composed slot props: standard session hooks, the localized
     *   `t`, `renderFactorySlot`, and the injected queue operations.
     */
    function QueueDock(props) {
      const {
        useSession,
        useProjection,
        renderFactorySlot,
        t,
        updateQueue,
        notify,
        loadImage,
        moveItem,
      } = props

      const inbox = useProjection('inbox')
      const pendingSubmissions = useSession((snapshot) => snapshot.pendingSubmissions) ?? EMPTY
      const running = useSession((snapshot) => snapshot.running === true)
      const subagent = useSession((snapshot) => snapshot.subagent)
      const queueMutable = subagent === null || subagent === undefined || (subagent.address !== undefined && subagent.address.mode === 'continuable')

      const queue = React.useMemo(() => {
        const rows = inbox !== null && inbox !== undefined && Array.isArray(inbox['next-turn']) ? inbox['next-turn'] : EMPTY
        const inChat = new Set(pendingSubmissions.filter((item) => item.placement === 'transcript').map((item) => item.requestId))
        if (inChat.size === 0) return rows
        return rows.filter(({ source }) => source === undefined || source === null || source.kind !== 'user' || !('rpcId' in source) || !inChat.has(source.rpcId))
      }, [inbox, pendingSubmissions])

      const pendingQueue = React.useMemo(() => {
        const admitted = new Set(queue.map(({ source }) => (source.kind === 'user' && 'rpcId' in source ? source.rpcId : null)).filter((id) => id !== null))
        return pendingSubmissions.filter((submission) => submission.placement === 'queued' && !admitted.has(submission.requestId))
      }, [pendingSubmissions, queue])

      const rowCount = queue.length + pendingQueue.length
      const [collapsed, setCollapsed] = React.useState(true)
      const [editing, setEditing] = React.useState(null)
      const [busy, setBusy] = React.useState(null)
      const [movingId, setMovingId] = React.useState(null)
      const [dragId, setDragId] = React.useState(null)
      const [dropPos, setDropPos] = React.useState(null)
      const [live, setLive] = React.useState('')
      const dragRef = React.useRef(null)
      const listRef = React.useRef(null)
      const pointerRef = React.useRef({ x: null, y: null })
      const scrollFrameRef = React.useRef(0)
      const [autoScrollHint, setAutoScrollHint] = React.useState(null)
      const listId = React.useId ? React.useId() : 'dqr-queue-list'
      const hintId = (React.useId ? React.useId() : 'dqr-hint') + '-hint'

      React.useEffect(() => {
        if (rowCount === 0 && !collapsed) setCollapsed(true)
        if (editing !== null && (!queueMutable || !queue.some((row) => row.id === editing.id))) setEditing(null)
      }, [collapsed, editing, queue, queueMutable, rowCount])

      /** Cancel the auto-scroll frame and clear its edge affordance. */
      const stopAutoScroll = React.useCallback(() => {
        const frame = scrollFrameRef.current
        scrollFrameRef.current = 0
        if (frame !== 0 && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frame)
        setAutoScrollHint((current) => (current === null ? current : null))
      }, [])

      const clearDrag = React.useCallback(() => {
        dragRef.current = null
        pointerRef.current = { x: null, y: null }
        setDragId(null)
        setDropPos(null)
        stopAutoScroll()
      }, [stopAutoScroll])

      /** Move the drop marker onto whatever queue row currently sits under the pointer. */
      const pointDropTarget = React.useCallback((list, x, y) => {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') return
        if (typeof x !== 'number' || typeof y !== 'number') return
        const hit = document.elementFromPoint(x, y)
        if (hit === null || hit === undefined || typeof hit.closest !== 'function') return
        const row = hit.closest('[data-queue-index]')
        if (row === null || row === undefined) return
        if (typeof list.contains === 'function' && !list.contains(row)) return
        const index = Number(row.dataset === undefined ? NaN : row.dataset.queueIndex)
        if (!Number.isInteger(index) || index < 0) return
        const rect = row.getBoundingClientRect()
        const position = y > rect.top + rect.height / 2 ? index + 1 : index
        setDropPos((current) => (current === position ? current : position))
      }, [])

      /**
       * Run one rAF loop for the duration of a drag. While the pointer is near
       * the top or bottom edge of the scrollable list, scroll it by a speed that
       * grows toward the edge; because the pointer may be stationary, the loop
       * (not a dragover event) drives the scroll. Every scrolled frame also
       * re-resolves the row under the pointer so the drop line stays correct
       * while content moves underneath it.
       */
      const startAutoScroll = React.useCallback(() => {
        if (typeof requestAnimationFrame !== 'function') return
        if (scrollFrameRef.current !== 0) return
        const tick = () => {
          scrollFrameRef.current = 0
          if (dragRef.current === null) {
            setAutoScrollHint(null)
            return
          }
          const list = listRef.current
          if (list === null || list === undefined) {
            setAutoScrollHint(null)
            return
          }
          const rect = list.getBoundingClientRect()
          const { x, y } = pointerRef.current
          let direction = null
          let step = 0
          const scrollable = list.scrollHeight - list.clientHeight > 0
          const overList = typeof x === 'number' && typeof y === 'number'
            && x >= rect.left - 64 && x <= rect.right + 64
          if (scrollable && overList) {
            if (y < rect.top + SCROLL_EDGE) {
              direction = 'up'
              step = -scrollStep(y - rect.top)
            } else if (y > rect.bottom - SCROLL_EDGE) {
              direction = 'down'
              step = scrollStep(rect.bottom - y)
            }
          }
          if (step !== 0) {
            const max = Math.max(0, list.scrollHeight - list.clientHeight)
            const next = Math.max(0, Math.min(max, list.scrollTop + step))
            if (next !== list.scrollTop) {
              list.scrollTop = next
              pointDropTarget(list, x, y)
            }
          }
          setAutoScrollHint((current) => (current === direction ? current : direction))
          scrollFrameRef.current = requestAnimationFrame(tick)
        }
        scrollFrameRef.current = requestAnimationFrame(tick)
      }, [pointDropTarget])

      React.useEffect(() => () => stopAutoScroll(), [stopAutoScroll])

      const applyAction = React.useCallback(async (itemId, action, failureText) => {
        setBusy(itemId)
        try {
          await updateQueue(itemId, action)
          return true
        } catch {
          notify('error', failureText)
          return false
        } finally {
          setBusy((current) => (current === itemId ? null : current))
        }
      }, [notify, updateQueue])

      const saveEdit = React.useCallback(async () => {
        if (editing === null || editing.text.trim() === '') return
        const ok = await applyAction(editing.id, { kind: 'edit', content: [{ type: 'text', text: editing.text }] }, t('editFailed'))
        if (!ok) setEditing(null)
      }, [applyAction, editing, t])

      const moveRow = React.useCallback(async (itemId, beforeId) => {
        if (!queueMutable || movingId !== null || itemId === beforeId) return
        const expectedIds = (inbox !== null && inbox !== undefined && Array.isArray(inbox['next-turn']) ? inbox['next-turn'] : EMPTY).map((row) => row.id)
        setMovingId(itemId)
        setLive('')
        try {
          await moveItem({ itemId, beforeId, expectedIds })
          const rest = queue.filter((row) => row.id !== itemId)
          let position = rest.length
          if (beforeId !== null) {
            const at = rest.findIndex((row) => row.id === beforeId)
            position = at < 0 ? rest.length : at
          }
          setLive(t('moved', { pos: position + 1, total: queue.length }))
        } catch (error) {
          const message = error instanceof Error && error.message !== '' ? error.message : t('reorderFailed')
          notify('error', message)
          setLive(message)
        } finally {
          setMovingId(null)
        }
      }, [inbox, moveItem, movingId, notify, queue, queueMutable, t])

      const startEdit = React.useCallback((row) => {
        const text = textOf(row.content)
        if (text === null) return
        setEditing({ id: row.id, text })
      }, [])

      /** Insertion position belonging to a pointer over one row. */
      const positionOf = React.useCallback((event, index) => {
        const rect = event.currentTarget.getBoundingClientRect()
        return event.clientY > rect.top + rect.height / 2 ? index + 1 : index
      }, [])

      const onDragOverRow = React.useCallback((event, index) => {
        if (dragRef.current === null) return
        event.preventDefault()
        if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
        const position = positionOf(event, index)
        setDropPos((current) => (current === position ? current : position))
      }, [positionOf])

      const onDropRow = React.useCallback((event, index) => {
        event.preventDefault()
        const dragging = dragRef.current
        if (dragging === null) {
          clearDrag()
          return
        }
        const from = queue.findIndex((row) => row.id === dragging)
        const position = positionOf(event, index)
        clearDrag()
        if (from < 0 || position === from || position === from + 1) return
        const beforeId = position < queue.length ? queue[position].id : null
        moveRow(dragging, beforeId)
      }, [clearDrag, moveRow, positionOf, queue])

      /** Keyboard reordering on the grip: one step with the arrows, or the ends. */
      const onGripKeyDown = React.useCallback((event, row, index) => {
        let beforeId
        if (event.key === 'ArrowUp') {
          if (index === 0) return
          beforeId = queue[index - 1].id
        } else if (event.key === 'ArrowDown') {
          if (index === queue.length - 1) return
          beforeId = index + 2 < queue.length ? queue[index + 2].id : null
        } else if (event.key === 'Home') {
          if (index === 0) return
          beforeId = queue[0].id
        } else if (event.key === 'End') {
          if (index === queue.length - 1) return
          beforeId = null
        } else {
          return
        }
        event.preventDefault()
        moveRow(row.id, beforeId)
      }, [moveRow, queue])

      if (rowCount === 0) return null

      const interactionActive = queueMutable && (editing !== null || busy !== null || movingId !== null)
      const expanded = !collapsed || interactionActive
      const listVisible = rowCount === 1 || expanded
      const canReorder = queueMutable && queue.length > 1

      const dropState = (index) => {
        if (!canReorder || dropPos === null) return undefined
        if (dropPos === index) return 'before'
        if (dropPos === queue.length && index === queue.length - 1) return 'after'
        return undefined
      }

      const previewOf = (text) => {
        if (typeof renderFactorySlot !== 'function') {
          return h('span', { className: P + 'preview' }, condense(text, 160))
        }
        return h('span', { className: P + 'preview' }, renderFactorySlot('conversation.user.text', {
          text,
          facts: TEXT_FACTS,
          interactive: false,
          ellipsis: true,
        }))
      }

      const actionButton = (key, label, title, disabled, onClick, children) =>
        h('button', {
          key,
          type: 'button',
          className: P + 'action',
          'aria-label': label,
          title,
          disabled,
          onClick,
        }, children)

      const rows = []

      if (listVisible) {
        queue.forEach((row, index) => {
          const attachments = attachmentsOf(row.content)
          const text = textOf(row.content)
          const rowDrop = dropState(index)
          const children = []

          if (canReorder) {
            children.push(h('button', {
              key: 'grip',
              type: 'button',
              className: P + 'grip',
              draggable: movingId === null,
              disabled: movingId !== null || busy !== null,
              'aria-label': t('gripLabel', { pos: index + 1, total: queue.length }),
              'aria-describedby': hintId,
              title: t('dragHint'),
              onDragStart: (event) => {
                dragRef.current = row.id
                setDragId(row.id)
                pointerRef.current = { x: event.clientX, y: event.clientY }
                if (event.dataTransfer !== null && event.dataTransfer !== undefined) {
                  event.dataTransfer.effectAllowed = 'move'
                  event.dataTransfer.setData('text/plain', row.id)
                }
              },
              onDragEnd: clearDrag,
              onKeyDown: (event) => onGripKeyDown(event, row, index),
            }, iconGrip()))
          } else if (rowCount === 1) {
            children.push(h('span', { key: 'lead', className: P + 'lead', 'aria-hidden': 'true' }, iconQueue()))
          }

          if (editing !== null && editing.id === row.id) {
            children.push(h('div', { key: 'editor', className: P + 'editor' }, h('textarea', {
              className: P + 'textarea',
              value: editing.text,
              rows: 2,
              autoFocus: true,
              'aria-label': t('edit'),
              onChange: (event) => setEditing({ id: row.id, text: event.target.value }),
              onKeyDown: (event) => {
                if (event.key === 'Escape') {
                  event.preventDefault()
                  setEditing(null)
                } else if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  saveEdit()
                }
              },
            })))
          } else {
            if (attachments.length > 0) {
              children.push(h('span', { key: 'attachments', className: P + 'attachments' }, attachments.map((item, attachmentIndex) =>
                item.type === 'image'
                  ? h(QueueThumb, {
                    key: item.attachment.attachmentId + ':' + attachmentIndex,
                    attachment: item.attachment,
                    loadImage,
                    label: t('image'),
                  })
                  : h(QueueFile, {
                    key: item.attachment.attachmentId + ':' + item.attachment.name + ':' + attachmentIndex,
                    attachment: item.attachment,
                    label: t('file', { name: item.attachment.name }),
                  }),
              )))
            }
            children.push(previewOf(text === null ? '' : text))
          }

          if (queueMutable) {
            children.push(h('div', { key: 'actions', className: P + 'actions' },
              editing !== null && editing.id === row.id
                ? [
                  actionButton('save', t('save'), t('save'), busy !== null || editing.text.trim() === '', saveEdit, iconCheck()),
                  actionButton('cancel', t('cancelEdit'), t('cancelEdit'), busy !== null, () => setEditing(null), iconClose()),
                ]
                : [
                  actionButton('edit', t('edit'), text === null ? t('editUnsupported') : t('edit'), busy !== null || movingId !== null || text === null, () => startEdit(row), iconEdit()),
                  actionButton('remove', t('remove'), t('remove'), busy !== null || movingId !== null, () => { applyAction(row.id, { kind: 'remove' }, t('removeFailed')) }, iconTrash()),
                  actionButton('steer', t('steer'), running ? t('steer') : t('steerUnavailable'), busy !== null || movingId !== null || !running, () => { applyAction(row.id, { kind: 'steer' }, t('steerFailed')) }, iconSend()),
                ],
            ))
          }

          rows.push(h('li', {
            key: row.id,
            className: P + 'row',
            'data-queue-index': index,
            'data-dragging': dragId === row.id ? 'yes' : undefined,
            'data-drop': rowDrop,
            onDragOver: (event) => onDragOverRow(event, index),
            onDrop: (event) => onDropRow(event, index),
          }, children))
        })

        pendingQueue.forEach((submission) => {
          const attachments = Array.isArray(submission.attachments) ? submission.attachments : []
          rows.push(h('li', {
            key: submission.requestId,
            className: P + 'row ' + P + 'pendingRow',
            'data-submission-echo': '',
          }, [
            h('span', { key: 'lead', className: P + 'lead', 'aria-hidden': 'true' }, iconQueue()),
            attachments.length > 0
              ? h('span', { key: 'attachments', className: P + 'attachments' }, attachments.map((attachment, attachmentIndex) =>
                attachment.type === 'image'
                  ? h('img', {
                    key: 'img:' + attachmentIndex,
                    className: P + 'thumb',
                    src: attachment.value.previewUrl,
                    alt: t('image'),
                  })
                  : h(QueueFile, {
                    key: 'file:' + attachmentIndex,
                    attachment: attachment.value,
                    label: t('file', { name: attachment.value.name }),
                  }),
              ))
              : null,
            h('span', { key: 'preview', className: P + 'preview' }, condense(String(submission.text ?? ''), 160)),
            h('span', { key: 'status', className: P + 'status', role: 'status' }, t('sending')),
            queueMutable
              ? h('div', { key: 'actions', className: P + 'actions' }, [
                actionButton('edit', t('edit'), t('sending'), true, undefined, iconEdit()),
                actionButton('remove', t('remove'), t('sending'), true, undefined, iconTrash()),
                actionButton('steer', t('steer'), t('sending'), true, undefined, iconSend()),
              ])
              : null,
          ]))
        })
      }

      return h('div', {
        className: P + 'dock',
        'data-queue-dock': '',
        'data-queue-reorder': '',
        onDragOver: (event) => {
          if (dragRef.current === null) return
          pointerRef.current = { x: event.clientX, y: event.clientY }
          event.preventDefault()
          if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.dropEffect = 'move'
          startAutoScroll()
        },
        onDragLeave: (event) => {
          const next = event.relatedTarget
          if (next !== null && next !== undefined && event.currentTarget.contains(next)) return
          pointerRef.current = { x: null, y: null }
          setAutoScrollHint(null)
        },
      },
        h('div', { className: P + 'panel' }, [
          rowCount > 1
            ? h('button', {
              key: 'header',
              type: 'button',
              className: P + 'header',
              'aria-controls': listId,
              'aria-expanded': expanded,
              disabled: interactionActive,
              onClick: () => setCollapsed((value) => !value),
            }, [
              h('span', { key: 'lead', className: P + 'lead', 'aria-hidden': 'true' }, iconQueue()),
              h('span', { key: 'count', className: P + 'count' }, t('count', { n: rowCount })),
              expanded && canReorder ? h('span', { key: 'hint', className: P + 'hint' }, t('hint')) : null,
              !listVisible && pendingQueue.length > 0 ? h('span', { key: 'status', className: P + 'status', role: 'status' }, t('sending')) : null,
              h('span', { key: 'chevron', className: P + 'chevron', 'aria-hidden': 'true' }, expanded ? iconChevronDown() : iconChevronUp()),
            ])
            : null,
          h('ul', {
            key: 'list',
            id: listId,
            ref: listRef,
            className: P + 'list',
            hidden: !listVisible,
            'data-dragging': dragId === null ? undefined : 'yes',
            'data-autoscroll': autoScrollHint === null ? undefined : autoScrollHint,
            onDragOver: (event) => {
              if (dragRef.current === null) return
              pointerRef.current = { x: event.clientX, y: event.clientY }
              event.preventDefault()
            },
            onDragLeave: (event) => {
              const next = event.relatedTarget
              if (next !== null && next !== undefined && event.currentTarget.contains(next)) return
              setDropPos(null)
            },
          }, rows),
          h('span', { key: 'live', className: P + 'live', role: 'status', 'aria-live': 'polite' }, live),
          h('span', { key: 'hint-ids', id: hintId, className: P + 'live' }, t('dragHint')),
        ]),
      )
    }

    /* ---------- plugin ---------- */

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'dsh-queue-reorder: dictionaries')

      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-queue-reorder'
        tag.dataset.pluginCss = STYLE_ID
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'dsh-queue-reorder: styles')

      const bound = ctx.locale.bind(NS)

      /** The session-scoped conversation service; the shipped queue dock uses the same endpoint. */
      const conversationFor = (sessionId) => {
        const scoped = ctx.sessions.scope(sessionId)
        if (scoped === undefined) return undefined
        return scoped.get('conversation')
      }

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: 'queue',
        order: 20,
        // Lower priority wins a cell: the shipped dock registers at 0, so a
        // negative priority is what makes this registration its replacement.
        priority: -1,
        locale: NS,
        inject: (sessionId) => {
          const updateQueue = async (itemId, action) => {
            const conversation = conversationFor(sessionId)
            if (conversation === undefined) throw new Error(bound('unavailable'))
            return conversation.updateQueue(itemId, action)
          }
          const notify = (level, text) => {
            try {
              const scoped = ctx.sessions.scope(sessionId)
              const conversation = scoped === undefined ? undefined : scoped.get('conversation')
              if (conversation !== undefined) conversation.input.for(scoped).notify(level, text)
            } catch {
              // A missing conversation service only costs the notice.
            }
          }
          const loadImage = async (attachment) => {
            const uiConversation = typeof ctx.get === 'function' ? ctx.get('uiConversation') : undefined
            if (uiConversation === undefined || typeof uiConversation.imageUrl !== 'function') return null
            return uiConversation.imageUrl(sessionId, attachment)
          }
          const moveItem = (payload) => postJson('api/queue.move', { sessionId, ...payload })
          return { updateQueue, notify, loadImage, moveItem }
        },
      }, QueueDock))
    }

    return {
      inject: ['slots', 'locale', 'sessions'],
      apply,
    }
  },
})
