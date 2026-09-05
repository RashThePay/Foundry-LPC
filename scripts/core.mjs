export const ID = 'foundry-lpc-mobile'
export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  )
export const t = (key, data = {}) => game.i18n.format(`FLPCM.UI.${key}`, data)
export const setting = (key) => game.settings.get(ID, key)
export const flag = (document, key) => document?.getFlag?.(ID, key)
export const list = (collection) => [...(collection?.contents || collection || [])]
export const textOnly = (html) => {
  const node = document.createElement('div')
  node.innerHTML = html || ''
  return node.textContent || ''
}
export function remaining(uses) {
  const max = Number(uses?.max)
  if (!Number.isFinite(max) || max <= 0) return null
  return { value: Math.max(0, uses.value != null ? Number(uses.value) : max - Number(uses.spent || 0)), max }
}
export function turnKey(combat, sceneId) {
  return `${sceneId || ''}:${combat?.id || ''}:${combat?.round || 0}:${combat?.turn ?? -1}`
}
export function permitted({
  owner,
  paused,
  combat,
  tokenId,
  exception,
  key,
  kind = 'move',
  activation = 'action',
  policy = 'turn'
}) {
  if (!owner || paused) return false
  if (!combat?.started) return true
  if (kind === 'action' && !['action', 'bonus'].includes(activation)) return true
  return (
    (kind === 'move' && policy === 'free') ||
    combat.combatant?.tokenId === tokenId ||
    (exception?.key === key && exception[kind] === true)
  )
}
export function pruneFavorites(favorites, entries) {
  const valid = new Set(entries.map((e) => `${e.item.id}:${e.activity.id}`))
  return [...new Set(favorites || [])].filter((key) => valid.has(key)).slice(0, 3)
}
export class Lifetime {
  constructor() {
    this.cleanups = []
  }
  on(target, event, callback, options) {
    target?.addEventListener(event, callback, options)
    this.cleanups.push(() => target?.removeEventListener(event, callback, options))
  }
  hook(event, callback) {
    const id = Hooks.on(event, callback)
    this.cleanups.push(() => Hooks.off(event, id))
  }
  interval(callback, ms) {
    const id = setInterval(callback, ms)
    this.cleanups.push(() => clearInterval(id))
  }
  clear() {
    for (const fn of this.cleanups.splice(0).reverse()) fn()
  }
}
export function button(command, label, attributes = '') {
  return `<button type="button" data-command="${command}" ${attributes}>${esc(t(label))}</button>`
}
export function choices(values, selected) {
  return values
    .map(
      ([value, label]) =>
        `<option value="${esc(value)}" ${value === selected ? 'selected' : ''}>${esc(label)}</option>`
    )
    .join('')
}
