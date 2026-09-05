export function isTap(start, end, elapsed, cancelled) {
  return !cancelled && elapsed < 500 && Math.hypot(end.x - start.x, end.y - start.y) <= 14
}
export class Gestures {
  constructor(element, handlers) {
    this.element = element
    this.handlers = handlers
    this.points = new Map()
    this.cancelled = false
    this.listeners = Object.fromEntries(
      ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].map((type) => [
        type,
        (e) => this.handle(type, e)
      ])
    )
    for (const [type, listener] of Object.entries(this.listeners))
      element.addEventListener(type, listener, { capture: true, passive: false })
  }
  reset() {
    this.points.clear()
    this.cancelled = true
  }
  destroy() {
    for (const [type, listener] of Object.entries(this.listeners))
      this.element.removeEventListener(type, listener, true)
    this.reset()
  }
  handle(type, event) {
    if (event.button > 0 || this.handlers.blocked()) return
    event.preventDefault()
    event.stopImmediatePropagation()
    const point = { x: event.clientX, y: event.clientY }
    if (type === 'pointerdown') {
      if (!this.points.size) {
        this.start = point
        this.time = Date.now()
        this.cancelled = false
      } else this.cancelled = true
      this.points.set(event.pointerId, point)
      this.element.setPointerCapture?.(event.pointerId)
      return
    }
    const previous = this.points.get(event.pointerId)
    if (!previous) return
    if (type === 'pointercancel') {
      this.reset()
      return
    }
    if (type === 'pointermove') {
      const before = [...this.points.values()]
      this.points.set(event.pointerId, point)
      if (this.handlers.template?.(point)) {
        this.cancelled = true
        return
      }
      if (this.points.size > 1) {
        const after = [...this.points.values()]
        const distance = (pair) => Math.hypot(pair[1].x - pair[0].x, pair[1].y - pair[0].y)
        const midpoint = (pair) => ({ x: (pair[0].x + pair[1].x) / 2, y: (pair[0].y + pair[1].y) / 2 })
        this.handlers.zoom(distance(after) / Math.max(1, distance(before)), midpoint(after), midpoint(before))
        this.cancelled = true
      } else if (this.cancelled || Math.hypot(point.x - this.start.x, point.y - this.start.y) > 14) {
        this.cancelled = true
        this.handlers.pan(point.x - previous.x, point.y - previous.y)
      }
      return
    }
    this.points.delete(event.pointerId)
    if (!this.points.size && isTap(this.start, point, Date.now() - this.time, this.cancelled))
      this.handlers.tap(point)
  }
}
