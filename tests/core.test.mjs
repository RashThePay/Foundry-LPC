import test from 'node:test'
import assert from 'node:assert/strict'
import { ID, permitted, remaining, pruneFavorites, turnKey, esc } from '../scripts/core.mjs'
import { Gestures, isTap } from '../scripts/gestures.mjs'
import { projectRequests, RequestService } from '../scripts/requests.mjs'
import { LPC_DEFAULTS, validateSheet, directionFor } from '../scripts/lpc-animator.mjs'

const combat = { id: 'combat', round: 1, turn: 0, started: true, combatant: { tokenId: 'other' } }
const base = { owner: true, paused: false, combat, tokenId: 'hero', key: turnKey(combat, 'scene') }
test('movement and activity policies honor ownership, pause, turns, and scoped exceptions', () => {
  assert.equal(permitted(base), false)
  assert.equal(permitted({ ...base, exception: { key: base.key, move: true } }), true)
  assert.equal(permitted({ ...base, exception: { key: 'expired', move: true } }), false)
  assert.equal(permitted({ ...base, owner: false, exception: { key: base.key, move: true } }), false)
  assert.equal(permitted({ ...base, paused: true, policy: 'free' }), false)
  assert.equal(permitted({ ...base, policy: 'free' }), true)
  assert.equal(permitted({ ...base, kind: 'action', activation: 'reaction' }), true)
  assert.equal(permitted({ ...base, kind: 'action', activation: 'bonus' }), false)
  assert.equal(permitted({ ...base, combat: null }), true)
  assert.notEqual(turnKey(combat, 'a'), turnKey(combat, 'b'))
})
test('remaining uses use spent counters and retain zero', () => {
  assert.deepEqual(remaining({ max: 3, spent: 2 }), { value: 1, max: 3 })
  assert.deepEqual(remaining({ max: 3, value: 0 }), { value: 0, max: 3 })
  assert.equal(remaining({ max: '' }), null)
  assert.equal(remaining({ max: '@abilities.wis.mod' }), null)
})
test('favorites are unique, valid, and limited to three', () => {
  const entries = ['a', 'b', 'c', 'd'].map((id) => ({ item: { id }, activity: { id: 'use' } }))
  assert.deepEqual(pruneFavorites(['missing:use', 'a:use', 'a:use', 'b:use', 'c:use', 'd:use'], entries), [
    'a:use',
    'b:use',
    'c:use'
  ])
})
test('tap classification rejects drags, holds, and cancelled gestures', () => {
  assert.equal(isTap({ x: 0, y: 0 }, { x: 4, y: 2 }, 100, false), true)
  assert.equal(isTap({ x: 0, y: 0 }, { x: 20, y: 0 }, 100, false), false)
  assert.equal(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 600, false), false)
  assert.equal(isTap({ x: 0, y: 0 }, { x: 0, y: 0 }, 50, true), false)
})
test('pinch never becomes movement after lifting one finger', () => {
  const calls = [],
    element = { addEventListener() {}, removeEventListener() {}, setPointerCapture() {} }
  const gestures = new Gestures(element, {
    blocked: () => false,
    tap: () => calls.push('tap'),
    pan: () => calls.push('pan'),
    zoom: () => calls.push('zoom')
  })
  const e = (id, x) => ({
    pointerId: id,
    button: 0,
    clientX: x,
    clientY: 0,
    preventDefault() {},
    stopImmediatePropagation() {}
  })
  gestures.handle('pointerdown', e(1, 0))
  gestures.handle('pointerdown', e(2, 100))
  gestures.handle('pointermove', e(2, 120))
  gestures.handle('pointerup', e(2, 120))
  gestures.handle('pointerup', e(1, 0))
  assert.deepEqual(calls, ['zoom'])
})
const users = new Map([
  ['p', { id: 'p' }],
  ['q', { id: 'q' }],
  ['gm', { id: 'gm', isGM: true }],
  ['gm2', { id: 'gm2', isGM: true }]
])
const message = (id, author, kind, data = {}, timestamp = 1) => ({
  id,
  author: { id: author },
  visible: true,
  timestamp,
  flags: { [ID]: { v: 1, kind, ...data } }
})
const intent = () =>
  message('r', 'p', 'intent', {
    data: { playerId: 'q', actorId: 'actor', text: 'Open it', targetName: 'Chest' }
  })
test('requests use document authors, reject player status spoofing, and deterministically merge GM events', () => {
  const messages = [
    intent(),
    message('z', 'gm2', 'request-event', { requestId: 'r', status: 'resolved', text: 'Done' }, 2),
    message('a', 'gm', 'request-event', { requestId: 'r', status: 'pending', text: 'Looking' }, 2),
    message('fake', 'p', 'request-event', { requestId: 'r', status: 'dismissed' }, 3)
  ]
  const [r] = projectRequests(messages, users)
  assert.equal(r.playerId, 'p')
  assert.equal(r.status, 'resolved')
  assert.equal(r.events.length, 2)
})
test('requested rolls correlate author, actor and prompt; duplicate rolls do not reopen resolved requests', () => {
  const prompt = message(
    'prompt',
    'gm',
    'request-event',
    { requestId: 'r', status: 'waiting', roll: { kind: 'skill', key: 'inv' } },
    2
  )
  const roll = message('roll', 'p', 'request-roll', { requestId: 'r', promptId: 'prompt' }, 3)
  roll.rolls = [{ total: 19 }]
  roll.speaker = { actor: 'actor' }
  assert.equal(projectRequests([intent(), prompt, roll], users)[0].status, 'pending')
  const spoof = { ...roll, id: 'spoof', author: { id: 'q' } }
  assert.equal(projectRequests([intent(), prompt, spoof], users)[0].status, 'waiting')
  const resolved = message('resolved', 'gm', 'request-event', { requestId: 'r', status: 'resolved' }, 4)
  const duplicate = { ...roll, id: 'duplicate', timestamp: 5 }
  const [r] = projectRequests([intent(), prompt, roll, resolved, duplicate], users)
  assert.equal(r.status, 'resolved')
  assert.equal(r.rolls.length, 1)
})
test('legacy intents remain readable without migration', () => {
  const old = message('legacyMessage', 'p', 'intent', { data: { id: 'legacyId', text: 'Listen' } })
  delete old.flags[ID].v
  assert.equal(projectRequests([old], users)[0].id, 'legacyId')
  assert.equal(projectRequests([{ ...old, visible: false }], users).length, 0)
})
test('cancelled and concurrent requested rolls remain waiting and execute only once', async () => {
  const service = new RequestService(),
    r = {
      id: 'r',
      playerId: 'p',
      actorId: 'actor',
      status: 'waiting',
      prompts: [{ id: 'prompt', kind: 'skill', key: 'inv', done: false }]
    }
  globalThis.game = { user: { id: 'p' }, actors: new Map([['actor', { isOwner: true }]]) }
  service.get = () => r
  service.recipients = () => ['p', 'gm']
  let finish,
    calls = 0
  const adapter = () => {
    calls++
    return new Promise((resolve) => {
      finish = resolve
    })
  }
  const pending = service.roll('r', 'prompt', adapter)
  await service.roll('r', 'prompt', adapter)
  assert.equal(calls, 1)
  finish(null)
  await pending
  assert.equal(service.pending.size, 0)
  assert.equal(r.status, 'waiting')
})
test('universal LPC hurt has one row and invalid frame layouts fail', () => {
  assert.equal(validateSheet(832, 1344, LPC_DEFAULTS), true)
  assert.throws(() => validateSheet(64, 64, LPC_DEFAULTS))
  assert.throws(() => validateSheet(832, 1344, { ...LPC_DEFAULTS, fps: 99 }))
  assert.equal(directionFor(-3, 1), 'left')
})
test('user-provided HTML is escaped', () =>
  assert.equal(esc('<img onerror="x">'), '&lt;img onerror=&quot;x&quot;&gt;'))
