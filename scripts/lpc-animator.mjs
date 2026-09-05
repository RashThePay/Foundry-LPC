import { ID, flag, setting, Lifetime, t } from './core.mjs'

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
    const offset = state.directional === false ? 0 : Math.max(...Object.values(config.directions))
    if (
      !Number.isInteger(state.row) ||
      state.row < 0 ||
      !Number.isInteger(state.frames) ||
      state.frames < 1 ||
      (state.row + offset + 1) * config.frameHeight > height ||
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
export function movementState(previous, position, lastMotion, now) {
  const dx = position.x - previous.x,
    dy = position.y - previous.y
  const moving = Math.hypot(dx, dy) > 0.05
  return { dx, dy, lastMotion: moving ? now : lastMotion, walking: moving || now - lastMotion < 100 }
}

// Animate the native token mesh. It retains Foundry visibility, lighting, hit testing,
// drag previews and alpha; a second sprite in the token controls layer does not.
export class LPCAnimator {
  constructor() {
    this.entries = new Map()
    this.pending = new Map()
    this.failed = new Map()
    this.motionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')
    this.generation = 0
    this.life = new Lifetime()
    this.tick = () => this.update(performance.now())
  }
  install() {
    this.life.hook('canvasReady', () => {
      this.bindTicker()
      this.refreshAll()
    })
    this.life.hook('canvasTearDown', () => {
      this.unbindTicker()
      this.clear()
    })
    this.life.hook('drawToken', (token) => this.attach(token, true))
    this.life.hook('refreshToken', (token) => {
      if (!this.entries.has(token)) this.attach(token)
      else this.sync(token)
    })
    this.life.hook('destroyToken', (token) => this.detach(token))
    this.life.hook('updateToken', (document, change) => {
      if (change.flags?.[ID] || Object.keys(change).some((k) => k.includes(ID)))
        this.attach(document.object, true)
    })
    this.life.hook('updateActor', (actor, change) => {
      if (change.flags?.[ID] || Object.keys(change).some((k) => k.includes(ID)))
        for (const token of canvas.tokens?.placeables || [])
          if (token.actor?.id === actor.id) this.attach(token, true)
      if (change.system?.attributes?.hp?.value !== undefined)
        for (const token of canvas.tokens?.placeables || [])
          if (token.actor?.id === actor.id) {
            const entry = this.entries.get(token),
              hp = Number(actor.system.attributes.hp.value)
            if (entry && hp < entry.hp) this.play(token, 'hurt')
            if (entry) entry.hp = hp
          }
    })
    this.life.hook('dnd5e.postUseActivity', (activity) => {
      const token =
        activity.actor?.token?.object ||
        (canvas.tokens?.placeables || []).find((token) => token.actor?.id === activity.actor?.id)
      if (token)
        this.play(
          token,
          activity.item?.type === 'spell'
            ? 'cast'
            : activity.attack?.type?.value === 'ranged' || activity.actionType?.startsWith('r')
              ? 'shoot'
              : 'slash'
        )
    })
    this.life.hook('createChatMessage', (message) => {
      if (
        message.author?.id === game.user.id ||
        !message.isContentVisible ||
        message.rolls?.length ||
        message.speaker?.scene !== canvas.scene?.id
      )
        return
      const data = message.flags?.dnd5e
      if (!data?.activity?.id || data.messageType === 'roll') return
      const token = canvas.tokens?.get(message.speaker?.token)
      if (!token?.visible) return
      const item = token.actor?.items.get(data.item?.id),
        activity = item?.system.activities?.get(data.activity.id)
      if (activity)
        this.play(
          token,
          item.type === 'spell' ? 'cast' : activity.actionType?.startsWith('r') ? 'shoot' : 'slash'
        )
    })
    if (canvas?.ready) {
      this.bindTicker()
      this.refreshAll()
    }
  }
  bindTicker() {
    this.unbindTicker()
    this.ticker = canvas.app?.ticker
    this.ticker?.add(this.tick, this, 0)
  }
  unbindTicker() {
    this.ticker?.remove(this.tick, this)
    this.ticker = null
  }
  config(token) {
    const overrides={...(flag(token.document,'lpc')||{})}
    if(!overrides.src)delete overrides.src
    return foundry.utils.mergeObject(
      structuredClone(LPC_DEFAULTS),
      { ...(flag(token.actor, 'lpc') || {}), ...overrides },
      { inplace: false }
    )
  }
  enabled() {
    return (
      setting('spriteEffects') &&
      !setting('lowEffects') &&
      !setting('reducedMotion') &&
      !this.motionPreference?.matches
    )
  }
  async refreshAll() {
    this.clear()
    await Promise.all((canvas.tokens?.placeables || []).map((token) => this.attach(token)))
  }
  async attach(token, replace = false) {
    if (!token?.mesh || token.destroyed) return
    if (replace) this.detach(token)
    const config = this.config(token)
    const signature=JSON.stringify(config)
    if(!replace&&this.failed.get(token)===signature)return
    if (!config.src || config.enabled === false || !setting('spriteEffects')) {
      this.detach(token)
      return
    }
    if (this.entries.has(token)) return this.sync(token)
    if (this.pending.has(token)) return
    const generation = this.generation,
      job = {}
    this.pending.set(token, job)
    try {
      const source = await PIXI.Assets.load(config.src)
      if (
        generation !== this.generation ||
        this.pending.get(token) !== job ||
        token.destroyed ||
        token.document.parent?.id !== canvas.scene?.id
      )
        return
      const baseTexture = source.baseTexture || source
      validateSheet(source.width || baseTexture.width, source.height || baseTexture.height, config)
      this.entries.set(token, {
        token,
        baseTexture,
        config,
        direction: 'down',
        state: 'idle',
        cache: new Map(),
        originalTexture: token.mesh.texture,
        hp: Number(token.actor?.system?.attributes?.hp?.value),
        started: performance.now(),
        lastMotion: -Infinity,
        last: this.position(token),
        frame: null,
        actionUntil: 0
      })
      this.sync(token)
    } catch (error) {
      this.failed.set(token,signature)
      console.warn(`${ID} | LPC ${token.name}`, error)
      if (game.user.isGM) ui.notifications.warn(t('spriteLoadFailed', { name: token.name }))
    } finally {
      if (this.pending.get(token) === job) this.pending.delete(token)
    }
  }
  position(token) {
    return { x: token.mesh?.position?.x ?? token.x ?? 0, y: token.mesh?.position?.y ?? token.y ?? 0 }
  }
  frames(entry) {
    const key = `${entry.state}:${entry.direction}`
    if (entry.cache.has(key)) return entry.cache.get(key)
    const { config } = entry,
      state = config.states[entry.state],
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
  update(now) {
    for (const [token, entry] of this.entries) {
      if (token.destroyed || !token.mesh) {
        this.detach(token)
        continue
      }
      const position = this.position(token),
        motion = movementState(entry.last, position, entry.lastMotion, now)
      entry.last = position
      entry.lastMotion = motion.lastMotion
      entry.direction = directionFor(motion.dx, motion.dy, entry.direction)
      if (entry.actionUntil <= now) {
        const desired = motion.walking ? 'walk' : 'idle'
        if (entry.state !== desired) {
          entry.state = desired
          entry.started = now
        }
      }
      this.sync(token, now)
    }
  }
  sync(token, now = performance.now()) {
    const entry = this.entries.get(token)
    if (!entry || !token.mesh) return
    // A redraw can replace the native texture. Remember it before restoring our frame.
    if (
      entry.frame &&
      token.mesh.texture !== entry.frame &&
      ![...entry.cache.values()].some((frames) => frames.includes(token.mesh.texture))
    )
      entry.originalTexture = token.mesh.texture
    const frames = this.frames(entry),
      state = entry.config.states[entry.state]
    const index =
      this.enabled() && entry.state !== 'idle'
        ? Math.floor((Math.max(0, now - entry.started) * entry.config.fps) / 1000)
        : 0
    const frame = frames[state.loop ? index % frames.length : Math.min(index, frames.length - 1)]
    if (token.mesh.texture !== frame) {
      token.mesh.texture = frame
      const texture = token.document.texture || {}
      token.mesh.resize?.(token.w, token.h, {
        fit: texture.fit || 'contain',
        scaleX: texture.scaleX ?? 1,
        scaleY: texture.scaleY ?? 1
      })
    }
    entry.frame = frame
  }
  play(tokenOrId, state, { duration } = {}) {
    const token = typeof tokenOrId === 'string' ? canvas.tokens?.get(tokenOrId) : tokenOrId
    const entry = this.entries.get(token)
    if (!entry || !entry.config.states[state]) return false
    entry.state = state
    entry.started = performance.now()
    entry.actionUntil = ['walk', 'idle'].includes(state)
      ? 0
      : entry.started + (duration || (entry.config.states[state].frames / entry.config.fps) * 1000)
    this.sync(token)
    return true
  }
  detach(tokenOrId) {
    const token = typeof tokenOrId === 'string' ? canvas.tokens?.get(tokenOrId) : tokenOrId
    this.pending.delete(token)
    this.failed.delete(token)
    const entry = this.entries.get(token)
    if (!entry) return
    if (token.mesh && !token.mesh.destroyed && token.mesh.texture === entry.frame) {
      token.mesh.texture = entry.originalTexture
      token.renderFlags?.set({ refreshMesh: true })
    }
    for (const frames of entry.cache.values()) for (const texture of frames) texture.destroy(false)
    this.entries.delete(token)
  }
  clear() {
    this.generation++
    this.pending.clear()
    this.failed.clear()
    for (const token of this.entries.keys()) this.detach(token)
  }
  destroy() {
    this.life.clear()
    this.unbindTicker()
    this.clear()
  }
}
