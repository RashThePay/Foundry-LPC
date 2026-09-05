import test from 'node:test'
import assert from 'node:assert/strict'
import { LPCAnimator, movementState } from '../scripts/lpc-animator.mjs'
import { edgeIndicator, PromptQueue } from '../scripts/prompts.mjs'
globalThis.game = {
  settings: { get: (_id, key) => key === 'spriteEffects' },
  user: { isGM: false },
  i18n: { format: (key) => key }
}
globalThis.foundry = { utils: { mergeObject: (base, overrides) => ({ ...base, ...overrides }) } }
globalThis.PIXI = {
  Assets: { load: async () => ({ width: 832, height: 1344, baseTexture: {} }) },
  Texture: class {
    constructor(base, frame) {
      this.base = base
      this.frame = frame
    }
    destroy() {
      this.destroyed = true
    }
  },
  Rectangle: class {
    constructor(x, y, w, h) {
      Object.assign(this, { x, y, w, h })
    }
  }
}
globalThis.canvas = { scene: { id: 'scene' }, tokens: { get: () => null } }
function token() {
  return {
    id: 'same',
    x: 0,
    y: 0,
    w: 64,
    h: 64,
    mesh: { texture: { name: 'artwork' }, alpha: 0.7, position: { x: 0, y: 0 }, resize() {} },
    actor: { getFlag: () => null },
    document: { parent: { id: 'scene' }, texture: {}, getFlag: () => ({ src: 'sheet.png' }) },
    renderFlags: { set() {} }
  }
}
test('motion detection settles to idle independently of missing stop hooks', () => {
  assert.equal(movementState({ x: 0, y: 0 }, { x: 1, y: 0 }, -Infinity, 10).walking, true)
  assert.equal(movementState({ x: 1, y: 0 }, { x: 1, y: 0 }, 10, 150).walking, false)
})
test('blank token sheet paths retain actor defaults and explicit disable still wins',()=>{
  const animator=new LPCAnimator(),hero=token();hero.actor.getFlag=()=>({src:'actor-sheet.png',fps:12});hero.document.getFlag=()=>({src:''})
  assert.equal(animator.config(hero).src,'actor-sheet.png')
  hero.document.getFlag=()=>({src:'',enabled:false});assert.equal(animator.config(hero).enabled,false)
})
test('native mesh animates walking only while moving, actions expire to idle, and alpha remains native', async () => {
  const animator = new LPCAnimator(),
    hero = token()
  await animator.attach(hero)
  const entry = animator.entries.get(hero),
    start = performance.now()
  animator.update(start)
  assert.equal(entry.state, 'idle')
  hero.mesh.position.x = 10
  animator.update(start + 16)
  assert.equal(entry.state, 'walk')
  animator.update(start + 200)
  assert.equal(entry.state, 'idle')
  animator.play(hero, 'cast')
  animator.update(performance.now() + 10)
  assert.equal(entry.state, 'cast')
  animator.update(performance.now() + 1000)
  assert.equal(entry.state, 'idle')
  assert.equal(hero.mesh.alpha, 0.7)
  animator.detach(hero)
  assert.equal(hero.mesh.texture.name, 'artwork')
})
test('drag previews with the same document id cannot detach the real token', async () => {
  const animator = new LPCAnimator(),
    hero = token(),
    preview = token()
  await animator.attach(hero)
  await animator.attach(preview)
  animator.detach(preview)
  assert.equal(animator.entries.has(hero), true)
  assert.equal(animator.entries.size, 1)
  hero.mesh.texture = { name: 'new native artwork' }
  animator.sync(hero)
  assert.equal(hero.mesh.texture, animator.entries.get(hero).frame)
  animator.detach(hero)
  assert.equal(hero.mesh.texture.name, 'new native artwork')
})
test('edge portrait appears only outside the usable viewport and points toward the character', () => {
  const bounds = { left: 0, right: 400, top: 0, bottom: 600 }
  assert.equal(edgeIndicator({ x: 200, y: 200 }, bounds), null)
  const right = edgeIndicator({ x: 800, y: 300 }, bounds)
  assert.equal(right.angle, 0)
  assert.equal(right.x, 370)
  const up = edgeIndicator({ x: 200, y: -100 }, bounds)
  assert.equal(up.angle, -90)
  assert.equal(up.y, 30)
})
test('incoming prompt queue deduplicates messages and waits for prior prompts', async () => {
  const calls = [],
    resolvers = []
  foundry.applications = {
    api: {
      DialogV2: {
        confirm: () =>
          new Promise((resolve) => {
            calls.push('prompt')
            resolvers.push(resolve)
          })
      }
    }
  }
  const queue = new PromptQueue()
  queue.show('one', 'Title', 'Body', () => calls.push('opened'))
  queue.show('one', 'Title', 'Body', () => calls.push('duplicate'))
  const pending = queue.show('two', 'Title', 'Body', () => calls.push('second'))
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['prompt'])
  resolvers.shift()(true)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(calls, ['prompt', 'opened', 'prompt'])
  resolvers.shift()(false)
  await pending
  assert.equal(calls.includes('second'), false)
})
