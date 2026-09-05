import { ID, flag, setting, Lifetime } from './core.mjs'

export const LPC_DEFAULTS = Object.freeze({
  frameWidth: 64,
  frameHeight: 64,
  columns: 13,
  fps: 9,
  directions: { up: 0, left: 1, down: 2, right: 3 },
  states: {
    cast: { row: 0, frames: 7, loop: false },
    thrust: { row: 4, frames: 8, loop: false },
    walk: { row: 8, frames: 9, loop: true },
    slash: { row: 12, frames: 6, loop: false },
    shoot: { row: 16, frames: 13, loop: false },
    hurt: { row: 20, frames: 6, loop: false, directional: false },
    idle: { row: 8, frames: 1, loop: false, frame: 0 }
  }
})
export function validateSheet(width, height, config) {
  if (
    ![config.frameWidth, config.frameHeight, config.fps].every(
      (n) => Number.isFinite(Number(n)) && Number(n) > 0
    ) ||
    config.fps > 30
  )
    throw new Error('Invalid LPC frame dimensions or FPS.')
  for (const state of Object.values(config.states)) {
    const rows = state.directional === false ? 0 : Math.max(...Object.values(config.directions))
    if (
      !Number.isInteger(state.row) ||
      state.row < 0 ||
      !Number.isInteger(state.frames) ||
      state.frames < 1 ||
      (state.row + rows + 1) * config.frameHeight > height ||
      ((state.frame || 0) + state.frames) * config.frameWidth > width
    )
      throw new Error(`LPC sheet ${width}×${height} does not contain the configured frames.`)
  }
  return true
}
export function directionFor(dx, dy, current = 'down') {
  return !dx && !dy
    ? current
    : Math.abs(dx) > Math.abs(dy)
      ? dx < 0
        ? 'left'
        : 'right'
      : dy < 0
        ? 'up'
        : 'down'
}
export class LPCAnimator {
  constructor() {
    this.entries = new Map()
    this.pending = new Map()
    this.generation = 0
    this.life = new Lifetime()
  }
  install() {
    this.life.hook('canvasReady', () => this.refreshAll())
    this.life.hook('canvasTearDown', () => this.clear())
    this.life.hook('drawToken', (token) => this.attach(token))
    this.life.hook('refreshToken', (token) => this.sync(token))
    this.life.hook('destroyToken', (token) => this.detach(token.id))
    this.life.hook('updateToken', (document, change) => {
      if (change.flags?.[ID] || Object.keys(change).some((k) => k.includes(ID)))
        this.attach(document.object, true)
    })
    this.life.hook('updateActor', (actor, change) => {
      if (change.flags?.[ID] || Object.keys(change).some((k) => k.includes(ID)))
        for (const token of canvas.tokens?.placeables || [])
          if (token.actor?.id === actor.id) this.attach(token, true)
    })
    this.life.hook('moveToken', (document) => this.moving(document))
    this.life.hook('stopToken', (document) => this.stop(document))
    this.life.hook('dnd5e.postUseActivity', (activity) => {
      const token =
        activity.actor?.token?.object ||
        (canvas.tokens?.placeables || []).find((t) => t.actor?.id === activity.actor?.id)
      if (token)
        this.play(
          token,
          activity.item?.type === 'spell'
            ? 'cast'
            : activity.attack?.type?.classification === 'ranged'
              ? 'shoot'
              : 'slash'
        )
    })
    if (canvas?.ready) this.refreshAll()
  }
  config(token) {
    return foundry.utils.mergeObject(
      structuredClone(LPC_DEFAULTS),
      { ...(flag(token.actor, 'lpc') || {}), ...(flag(token.document, 'lpc') || {}) },
      { inplace: false }
    )
  }
  enabled() {
    return (
      setting('spriteEffects') &&
      !setting('reducedMotion') &&
      !globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    )
  }
  async refreshAll() {
    this.clear()
    await Promise.all((canvas.tokens?.placeables || []).map((token) => this.attach(token)))
  }
  async attach(token, replace = false) {
    if (!token?.mesh) return
    if (replace) this.detach(token.id)
    const config = this.config(token)
    if (!config.src || config.enabled === false || !setting('spriteEffects')) {
      this.detach(token.id)
      return
    }
    if (this.entries.has(token.id)) return this.sync(token)
    if (this.pending.has(token.id)) return
    const generation = this.generation,
      job = {}
    this.pending.set(token.id, job)
    try {
      const source = await PIXI.Assets.load(config.src)
      if (
        generation !== this.generation ||
        this.pending.get(token.id) !== job ||
        token.destroyed ||
        token.document.parent?.id !== canvas.scene?.id
      )
        return
      const baseTexture = source.baseTexture || source
      validateSheet(source.width || baseTexture.width, source.height || baseTexture.height, config)
      const entry = {
        token,
        baseTexture,
        config,
        direction: 'down',
        state: 'idle',
        cache: new Map(),
        originalAlpha: token.mesh.alpha
      }
      const sprite = new PIXI.AnimatedSprite(this.frames(entry, 'idle'))
      entry.sprite = sprite
      sprite.anchor.set(0.5)
      token.addChild(sprite)
      this.entries.set(token.id, entry)
      token.mesh.alpha = 0
      this.sync(token)
      this.play(token, 'idle')
    } catch (error) {
      console.warn(`${ID} | LPC ${token.name}`, error)
      if (game.user.isGM) ui.notifications.warn(`${token.name}: ${error.message}`)
    } finally {
      if (this.pending.get(token.id) === job) this.pending.delete(token.id)
    }
  }
  frames(entry, stateName) {
    const key = `${stateName}:${entry.direction}`
    if (entry.cache.has(key)) return entry.cache.get(key)
    const { config } = entry,
      state = config.states[stateName],
      row = state.row + (state.directional === false ? 0 : Number(config.directions[entry.direction]))
    const frames = Array.from(
      { length: state.frames },
      (_, index) =>
        new PIXI.Texture(
          entry.baseTexture,
          new PIXI.Rectangle(
            ((state.frame || 0) + index) * config.frameWidth,
            row * config.frameHeight,
            config.frameWidth,
            config.frameHeight
          )
        )
    )
    entry.cache.set(key, frames)
    return frames
  }
  sync(token) {
    const entry = this.entries.get(token?.id)
    if (!entry || !token.mesh) return
    entry.sprite.position.set(token.w / 2, token.h / 2)
    entry.sprite.width = token.w
    entry.sprite.height = token.h
    entry.sprite.visible = token.visible && !token.document.hidden
    entry.sprite.alpha = token.alpha ?? 1
    token.mesh.alpha = 0
  }
  moving(document) {
    const entry = this.entries.get(document.id)
    if (!entry) return
    entry.movement = true
    entry.last = { x: entry.token.x, y: entry.token.y }
    this.play(document.id, 'walk')
    clearInterval(entry.poll)
    entry.poll = setInterval(() => {
      if (!entry.movement) return
      const dx = entry.token.x - entry.last.x,
        dy = entry.token.y - entry.last.y
      const direction = directionFor(dx, dy, entry.direction)
      entry.last = { x: entry.token.x, y: entry.token.y }
      if (direction !== entry.direction) {
        entry.direction = direction
        this.play(document.id, 'walk')
      }
    }, 60)
  }
  async stop(document) {
    const entry = this.entries.get(document.id)
    if (!entry) return
    const movement = entry.token.movementAnimationPromise
    await movement?.catch?.(() => {})
    if (
      this.entries.get(document.id) !== entry ||
      (entry.token.movementAnimationPromise && entry.token.movementAnimationPromise !== movement)
    )
      return
    entry.movement = false
    clearInterval(entry.poll)
    this.play(document.id, 'idle')
  }
  play(tokenOrId, stateName, { duration } = {}) {
    const entry = this.entries.get(typeof tokenOrId === 'string' ? tokenOrId : tokenOrId?.id)
    if (!entry || !entry.config.states[stateName]) return false
    clearTimeout(entry.timer)
    entry.sprite.onComplete = null
    entry.state = stateName
    entry.sprite.textures = this.frames(entry, stateName)
    entry.sprite.loop = entry.config.states[stateName].loop === true
    entry.sprite.animationSpeed = Number(entry.config.fps) / 60
    if (stateName === 'idle' || !this.enabled()) {
      entry.sprite.gotoAndStop(0)
      return true
    }
    entry.sprite.onComplete = () => this.play(entry.token, entry.movement ? 'walk' : 'idle')
    entry.sprite.gotoAndPlay(0)
    if (duration) entry.timer = setTimeout(() => this.play(entry.token, 'idle'), duration)
    return true
  }
  detach(id) {
    this.pending.delete(id)
    const entry = this.entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    clearInterval(entry.poll)
    if (entry.token.mesh) entry.token.mesh.alpha = entry.originalAlpha
    entry.sprite.destroy({ children: true, texture: false, baseTexture: false })
    for (const frames of entry.cache.values()) for (const texture of frames) texture.destroy(false)
    this.entries.delete(id)
  }
  clear() {
    this.generation++
    this.pending.clear()
    for (const id of this.entries.keys()) this.detach(id)
  }
  destroy() {
    this.life.clear()
    this.clear()
  }
}
