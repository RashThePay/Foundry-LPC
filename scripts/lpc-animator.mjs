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
    hurt: { row: 20, frames: 6, loop: false },
    idle: { row: 8, frames: 1, loop: true, frame: 0 }
  }
})

const MODULE_ID = 'foundry-lpc-mobile'

function mergedConfig(token) {
  const actorConfig = token.actor?.getFlag(MODULE_ID, 'lpc') || {}
  const tokenConfig = token.document?.getFlag(MODULE_ID, 'lpc') || {}
  return foundry.utils.mergeObject(foundry.utils.deepClone(LPC_DEFAULTS), { ...actorConfig, ...tokenConfig }, { inplace: false, recursive: true })
}

function directionFor(dx, dy, current = 'down') {
  if (!dx && !dy) return current
  if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right'
  return dy < 0 ? 'up' : 'down'
}

export class LPCAnimator {
  constructor() {
    this.entries = new Map()
  }

  install() {
    Hooks.on('canvasReady', () => this.refreshAll())
    Hooks.on('drawToken', token => this.attach(token))
    Hooks.on('refreshToken', token => this.sync(token))
    Hooks.on('destroyToken', token => this.detach(token.id))
    Hooks.on('preUpdateToken', (document, change) => this.beforeMove(document, change))
    Hooks.on('updateToken', document => this.afterMove(document))
    Hooks.on('updateActor', actor => {
      for (const token of canvas?.tokens?.placeables || []) if (token.actor?.id === actor.id) this.attach(token, true)
    })
  }

  async refreshAll() {
    this.clear()
    for (const token of canvas?.tokens?.placeables || []) await this.attach(token)
  }

  async attach(token, replace = false) {
    const config = mergedConfig(token)
    if (!config.src || !token?.mesh) return
    if (replace) this.detach(token.id)
    if (this.entries.has(token.id)) return this.sync(token)
    try {
      const source = await PIXI.Assets.load(config.src)
      const baseTexture = source.baseTexture || source
      const sprite = new PIXI.AnimatedSprite(this.frames(baseTexture, config, 'idle', 'down'))
      sprite.anchor.set(0.5, 0.5)
      sprite.animationSpeed = Number(config.fps || 9) / 60
      sprite.loop = true
      sprite.play()
      token.addChild(sprite)
      const entry = { token, sprite, baseTexture, config, state: 'idle', direction: 'down', timer: null, originalAlpha: token.mesh.alpha }
      this.entries.set(token.id, entry)
      token.mesh.alpha = 0
      this.sync(token)
    } catch (error) {
      console.warn(`${MODULE_ID} | Could not load LPC sheet for ${token.name}`, error)
    }
  }

  frames(baseTexture, config, stateName, direction) {
    const state = config.states?.[stateName] || config.states.idle
    const directionOffset = Number(config.directions?.[direction] ?? 2)
    const count = Math.max(1, Number(state.frames || 1))
    const start = Number(state.frame || 0)
    const row = Number(state.row || 0) + directionOffset
    return Array.from({ length: count }, (_, index) => new PIXI.Texture(
      baseTexture,
      new PIXI.Rectangle((start + index) * config.frameWidth, row * config.frameHeight, config.frameWidth, config.frameHeight)
    ))
  }

  sync(token) {
    const entry = this.entries.get(token?.id)
    if (!entry || !token.mesh) return
    entry.sprite.position.set(token.w / 2, token.h / 2)
    entry.sprite.width = token.w
    entry.sprite.height = token.h
    entry.sprite.visible = token.visible && !token.document.hidden
    entry.sprite.alpha = token.alpha ?? 1
  }

  beforeMove(document, change) {
    if (change.x == null && change.y == null) return
    const entry = this.entries.get(document.id)
    if (!entry) return
    const dx = Number(change.x ?? document.x) - Number(document.x)
    const dy = Number(change.y ?? document.y) - Number(document.y)
    entry.direction = directionFor(dx, dy, entry.direction)
    this.play(document.id, 'walk', { duration: 1200 })
  }

  afterMove(document) {
    const entry = this.entries.get(document.id)
    if (!entry || entry.state !== 'walk') return
    clearTimeout(entry.timer)
    entry.timer = setTimeout(() => this.play(document.id, 'idle'), 250)
  }

  play(tokenOrId, stateName, { duration } = {}) {
    const id = typeof tokenOrId === 'string' ? tokenOrId : tokenOrId?.id
    const entry = this.entries.get(id)
    if (!entry || !entry.config.states?.[stateName]) return false
    const state = entry.config.states[stateName]
    entry.state = stateName
    entry.sprite.textures = this.frames(entry.baseTexture, entry.config, stateName, entry.direction)
    entry.sprite.loop = state.loop !== false
    entry.sprite.animationSpeed = Number(entry.config.fps || 9) / 60
    entry.sprite.gotoAndPlay(0)
    clearTimeout(entry.timer)
    if (!entry.sprite.loop) {
      const milliseconds = duration || (state.frames / Number(entry.config.fps || 9)) * 1000
      entry.timer = setTimeout(() => this.play(id, 'idle'), milliseconds)
    } else if (duration) entry.timer = setTimeout(() => this.play(id, 'idle'), duration)
    return true
  }

  detach(id) {
    const entry = this.entries.get(id)
    if (!entry) return
    clearTimeout(entry.timer)
    if (entry.token?.mesh) entry.token.mesh.alpha = entry.originalAlpha
    entry.sprite.destroy({ children: true, texture: true, textureSource: false })
    this.entries.delete(id)
  }

  clear() {
    for (const id of [...this.entries.keys()]) this.detach(id)
  }
}
