import { esc, t } from './core.mjs'
export class PromptQueue {
  constructor() {
    this.seen = new Set()
    this.tail = Promise.resolve()
  }
  show(id, title, description, open) {
    if (this.seen.has(id)) return this.tail
    this.seen.add(id)
    this.tail = this.tail
      .catch(() => {})
      .then(async () => {
        const accepted = await foundry.applications.api.DialogV2.confirm({
          window: { title },
          content: `<p>${esc(description)}</p>`,
          yes: { label: t('openRequest') },
          no: { label: t('later') },
          rejectClose: false
        })
        if (accepted) await open()
      })
      .catch((error) => console.warn('foundry-lpc-mobile | Incoming prompt', error))
    return this.tail
  }
}
export function edgeIndicator(point, bounds, margin = 30) {
  if (point.x >= bounds.left && point.x <= bounds.right && point.y >= bounds.top && point.y <= bounds.bottom)
    return null
  const center = { x: (bounds.left + bounds.right) / 2, y: (bounds.top + bounds.bottom) / 2 }
  const dx = point.x - center.x,
    dy = point.y - center.y
  const halfWidth = Math.max(1, (bounds.right - bounds.left) / 2 - margin),
    halfHeight = Math.max(1, (bounds.bottom - bounds.top) / 2 - margin)
  const scale = Math.min(
    halfWidth / Math.max(0.001, Math.abs(dx)),
    halfHeight / Math.max(0.001, Math.abs(dy))
  )
  return { x: center.x + dx * scale, y: center.y + dy * scale, angle: (Math.atan2(dy, dx) * 180) / Math.PI }
}
