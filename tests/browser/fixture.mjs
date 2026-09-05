import { ID } from '/scripts/core.mjs'
const translations = await (await fetch('/lang/en.json')).json()
const hooks = new Map()
globalThis.Hooks = {
  on: (event, fn) => {
    const set = hooks.get(event) || new Set()
    set.add(fn)
    hooks.set(event, set)
    return fn
  },
  off: (event, fn) => hooks.get(event)?.delete(fn),
  callAll: (event, ...args) => {
    for (const fn of hooks.get(event) || []) fn(...args)
  }
}
const collection = (values) => {
  const map = new Map(values.map((v) => [v.id, v]))
  Object.defineProperty(map, 'contents', { get: () => [...map.values()] })
  map[Symbol.iterator] = function* () {
    yield* map.values()
  }
  return map
}
const flags = (initial) => ({
  flags: initial || {},
  getFlag(module, key) {
    return this.flags[module]?.[key]
  },
  async setFlag(module, key, value) {
    this.flags[module] ||= {}
    this.flags[module][key] = value
  },
  async unsetFlag(module, key) {
    delete this.flags[module]?.[key]
  }
})
const settings = new Map(
  Object.entries({
    enabled: true,
    desktopPreview: false,
    maxWidth: 1100,
    nativeUI: false,
    confirmExploration: false,
    combatMovement: 'turn',
    spriteEffects: true,
    lowEffects: false,
    reducedMotion: false,
    tutorialDone: true,
    gmPlacement: {}
  })
)
const actor = {
  ...flags(),
  id: 'hero',
  name: 'Arden',
  img: '/tests/browser/portrait.svg',
  isOwner: true,
  testUserPermission: () => true,
  system: {
    attributes: { hp: { value: 18, max: 24, temp: 3 }, ac: { value: 16 }, movement: { walk: 30 } },
    abilities: { str: { mod: 3 }, dex: { mod: 2 }, wis: { mod: 1 } },
    skills: { inv: { total: 4 } },
    spells: { spell1: { value: 2, max: 3 } }
  },
  effects: collection([{ id: 'effect', name: 'Concentrating', disabled: false }]),
  sheet: {
    render: () => {
      globalThis.nativeOpened = true
    }
  }
}
const sword = {
  id: 'sword',
  name: 'Longsword',
  img: actor.img,
  type: 'weapon',
  system: { quantity: 1, description: { value: 'A trusty blade.' }, activities: { contents: [] } },
  sheet: { render: () => {} }
}
const attack = {
  id: 'attack',
  name: 'Slash',
  activation: { type: 'action' },
  range: { value: 5, units: 'ft' },
  uses: { max: 3, spent: 1 },
  use: async () => {
    globalThis.uses++
    await new Promise((r) => setTimeout(r, 50))
  }
}
sword.system.activities.contents = [attack]
const loot = {
  id: 'rope',
  name: 'Rope',
  type: 'loot',
  system: { quantity: 1, description: { value: '50 feet of rope.' } }
}
actor.items = collection([sword, loot])
actor.rollSkill =
  actor.rollSavingThrow =
  actor.rollAbilityCheck =
  actor.rollDeathSave =
    async () => {
      globalThis.rollCount++
      return []
    }
actor.rollInitiativeDialog = actor.rollAbilityCheck
const scene = { id: 'scene', name: 'The old watchtower', grid: { units: 'ft' }, tokens: collection([]) }
const token = {
  id: 'token',
  name: actor.name,
  actor,
  visible: true,
  controlled: true,
  w: 50,
  h: 50,
  center: { x: 100, y: 200 },
  x: 75,
  y: 175,
  control() {
    this.controlled = true
  },
  bounds: { contains: (x, y) => x >= 75 && x <= 125 && y >= 175 && y <= 225 },
  document: {
    ...flags(),
    id: 'token',
    actor,
    isOwner: true,
    x: 75,
    y: 175,
    parent: scene,
    hidden: false,
    texture: { src: actor.img },
    getSnappedPosition: (p) => p,
    move: async () => {
      globalThis.moves++
      return true
    }
  },
  findMovementPath: (path) => ({ promise: Promise.resolve(path) }),
  measureMovementPath: () => ({ cost: 20, distance: 20 })
}
token.document.object = token
const enemy = {
  id: 'enemy',
  name: 'Goblin',
  visible: true,
  document: { hidden: false },
  bounds: { contains: (x, y) => x >= 200 && x <= 250 && y >= 200 && y <= 250 },
  setTarget(value) {
    value ? game.user.targets.add(this) : game.user.targets.delete(this)
  }
}
const user = {
  ...flags(),
  id: 'p',
  name: 'Player',
  character: actor,
  isGM: false,
  targets: new Set(),
  active: true
}
globalThis.game = {
  user,
  users: collection([user, { id: 'gm', name: 'DM', isGM: true }]),
  actors: collection([actor]),
  messages: collection([]),
  journal: collection([
    { id: 'public', name: 'Public handout', visible: true, pages: collection([]) },
    { id: 'private', name: 'Secret journal', visible: false }
  ]),
  scenes: collection([scene]),
  socket: { connected: true },
  paused: false,
  combat: null,
  settings: {
    get: (_id, key) => settings.get(key),
    set: async (_id, key, value) => settings.set(key, value)
  },
  i18n: {
    format: (key, data = {}) =>
      Object.entries(data).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, v), translations[key] || key),
    localize: (key) => translations[key] || key
  }
}
scene.tokens = collection([token.document])
globalThis.CONFIG = {
  DND5E: {
    skills: { inv: { label: 'Investigation' } },
    abilities: { str: { label: 'Strength' }, dex: { label: 'Dexterity' }, wis: { label: 'Wisdom' } },
    activityActivationTypes: { action: { label: 'Action' } }
  }
}
globalThis.CONST = { CHAT_MESSAGE_STYLES: { OTHER: 0 } }
globalThis.foundry = {
  utils: { deepClone: structuredClone },
  applications: {
    api: {
      DialogV2: { confirm: async () => true },
      ApplicationV2: class {
        constructor() {
          this.position = { left: 20, top: 20, width: 760, height: 680 }
          this.options = {}
        }
        async render() {
          if (!this.element) {
            this.element = document.createElement('div')
            this.element.id = 'flpcm-gm'
            this.element.className = 'flpcm-workspace application'
            this.element.style.cssText = 'position:fixed;inset:20px;background:#10151c;z-index:100'
            document.body.append(this.element)
          }
          this.rendered = true
          this._replaceHTML(await this._renderHTML(), this.element)
          return this
        }
        setPosition(p) {
          this.position = { ...this.position, ...p }
        }
        async close() {
          this.element?.remove()
          this.rendered = false
        }
      }
    },
    sheets: {},
    apps: {}
  }
}
globalThis.PIXI = {
  Graphics: class {
    lineStyle() {}
    moveTo() {}
    lineTo() {}
    destroy() {}
  }
}
globalThis.canvas = {
  ready: true,
  scene,
  app: { canvas: document.querySelector('#board') },
  stage: { pivot: { x: 180, y: 320 }, scale: { x: 1, y: 1 } },
  tokens: {
    placeables: [token, enemy],
    get: (id) => (id === 'token' ? token : id === 'enemy' ? enemy : null)
  },
  tiles: { placeables: [], get: () => null },
  controls: { addChild() {} },
  templates: { preview: { children: [] } },
  grid: { measurePath: () => ({ cost: 20 }) },
  canvasCoordinatesFromClient: (p) => p,
  clientCoordinatesFromCanvas: (p) => p,
  pan(p) {
    if (p.scale) this.stage.scale.x = this.stage.scale.y = p.scale
    if (p.x !== undefined) this.stage.pivot.x = p.x
    if (p.y !== undefined) this.stage.pivot.y = p.y
  },
  animatePan: async () => {}
}
globalThis.ui = { sidebar: { changeTab() {} }, notifications: { info() {}, error() {}, warn() {} } }
globalThis.ChatMessage = {
  getWhisperRecipients: () => [{ id: 'gm' }],
  getSpeaker: () => ({ actor: 'hero', token: 'token', scene: 'scene' }),
  create: async (data) => {
    if (globalThis.failSend) throw new Error('Network write failed')
    const message = {
      ...data,
      ...flags(data.flags),
      id: `m${game.messages.size + 1}`,
      author: user,
      timestamp: Date.now(),
      visible: true,
      speaker: data.speaker || {},
      rolls: []
    }
    game.messages.set(message.id, message)
    Hooks.callAll('createChatMessage', message)
    return message
  }
}
globalThis.moves = 0
globalThis.uses = 0
globalThis.rollCount = 0
const { PlayerShell } = await import('/scripts/player-shell.mjs')
const { RequestService } = await import('/scripts/requests.mjs')
const { GMWorkspace } = await import('/scripts/gm-workspace.mjs')
globalThis.shell = new PlayerShell({ play() {} }, new RequestService())
shell.install()
globalThis.showGM = async () => {
  shell.unmount()
  game.user = { ...game.users.get('gm'), ...flags() }
  globalThis.workspace = new GMWorkspace(new RequestService(), {})
  await workspace.render({ force: true })
}
globalThis.fixtureReady = true
