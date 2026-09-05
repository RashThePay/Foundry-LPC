import { ID, esc, flag, list, t } from './core.mjs'

// Pure projection: only document authorship may establish identity or authorize state events.
export function projectRequests(messages, users) {
  const ordered = [...messages]
    .filter((m) => m.visible !== false)
    .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0) || a.id.localeCompare(b.id))
  const requests = new Map()
  const author = (m) => users.get(typeof m.author === 'string' ? m.author : m.author?.id)
  for (const m of ordered) {
    const f = m.flags?.[ID]
    const user = author(m)
    if (!f || !user) continue
    if (f.kind === 'intent' && m.isContentVisible !== false) {
      const d = f.data || {}
      const id = f.v === 1 ? m.id : d.id || m.id
      requests.set(id, {
        id,
        messageId: m.id,
        playerId: user.id,
        actorId: d.actorId,
        tokenId: d.tokenId,
        sceneId: d.sceneId,
        targetId: d.targetId,
        targetType: d.targetType,
        targetName: d.targetName,
        text: d.text || '',
        createdAt: m.timestamp,
        status: 'pending',
        events: [],
        prompts: [],
        rolls: []
      })
    }
  }
  for (const m of ordered) {
    const f = m.flags?.[ID],
      user = author(m),
      request = requests.get(f?.requestId)
    if (!request || !user) continue
    if (f.kind === 'request-event' && user.isGM && m.isContentVisible !== false) {
      request.events.push({ id: m.id, ...f, author: user.id, timestamp: m.timestamp })
      if (['pending', 'waiting', 'resolved', 'dismissed'].includes(f.status)) request.status = f.status
      if (f.roll && ['skill', 'check', 'save'].includes(f.roll.kind))
        request.prompts.push({ id: m.id, ...f.roll, done: false })
    }
    if (f.kind === 'request-roll' && user.id === request.playerId && m.rolls?.length) {
      const prompt = request.prompts.find((p) => p.id === f.promptId)
      if (prompt && !prompt.done && m.speaker?.actor === request.actorId) {
        prompt.done = true
        request.rolls.push({
          id: m.id,
          promptId: prompt.id,
          total: m.isContentVisible === false ? null : m.rolls[0].total
        })
        if (request.status === 'waiting') request.status = 'pending'
      }
    }
  }
  return [...requests.values()].sort((a, b) => b.createdAt - a.createdAt)
}

export class RequestService {
  constructor() {
    this.pending = new Set()
  }
  all() {
    return projectRequests(list(game.messages), game.users).filter(
      (r) => game.user.isGM || r.playerId === game.user.id
    )
  }
  get(id) {
    return this.all().find((r) => r.id === id)
  }
  recipients(playerId = game.user.id) {
    return [...new Set([playerId, ...ChatMessage.getWhisperRecipients('GM').map((u) => u.id)])]
  }
  async submit(actor, token, focus, text, verb) {
    if (!actor?.isOwner) throw new Error(t('noCharacter'))
    if (!text.trim()) throw new Error(t('describeRequired'))
    if (!game.socket?.connected) throw new Error(t('offline'))
    const data = {
      actorId: actor?.id,
      tokenId: token?.id,
      sceneId: canvas.scene?.id,
      targetId: focus?.id,
      targetType: focus?.kind || 'scene',
      targetName: focus?.name || canvas.scene?.name || t('scene'),
      text: text.trim().slice(0, 800),
      verb
    }
    return ChatMessage.create({
      speaker: ChatMessage.getSpeaker({ actor, token: token?.document }),
      whisper: this.recipients(),
      content: `<section class="flpcm-intent-card"><strong>${esc(t('interaction'))}: ${esc(data.targetName)}</strong><p>${esc(data.text)}</p></section>`,
      flags: { [ID]: { v: 1, kind: 'intent', data } }
    })
  }
  async event(id, { text = '', status, roll, publicReply = false, dc }) {
    if (!game.user.isGM) throw new Error(t('gmOnly'))
    const request = this.get(id)
    if (!request) throw new Error(t('unavailable'))
    if (dc !== undefined && dc !== '' && (!Number.isFinite(Number(dc)) || Number(dc) < 0 || Number(dc) > 100))
      throw new Error(t('invalidDC'))
    if (dc !== undefined && dc !== '') {
      // Secrets live in a separate GM-only document, never in the shared event.
      await ChatMessage.create({
        whisper: ChatMessage.getWhisperRecipients('GM').map((u) => u.id),
        content: `${esc(t('dc'))}: ${esc(dc)}`,
        flags: { [ID]: { v: 1, kind: 'request-secret', requestId: id, dc: Number(dc) } }
      })
    }
    return ChatMessage.create({
      whisper: publicReply ? [] : this.recipients(request.playerId),
      content: `<section class="flpcm-intent-card"><strong>${esc(request.targetName)}</strong><p>${esc(text || t(status || 'rollRequested'))}</p></section>`,
      flags: { [ID]: { v: 1, kind: 'request-event', requestId: id, text, status, roll } }
    })
  }
  async roll(id, promptId, adapter) {
    const request = this.get(id),
      prompt = request?.prompts.find((p) => p.id === promptId)
    if (
      !request ||
      request.playerId !== game.user.id ||
      !prompt ||
      prompt.done ||
      this.pending.has(promptId) ||
      ['resolved', 'dismissed'].includes(request.status)
    )
      return
    const actor = request.tokenId
      ? game.scenes.get(request.sceneId)?.tokens.get(request.tokenId)?.actor
      : game.actors.get(request.actorId)
    this.pending.add(promptId)
    try {
      return await adapter(actor, prompt.kind, prompt.key, {
        id,
        promptId,
        recipients: this.recipients(request.playerId)
      })
    } finally {
      this.pending.delete(promptId)
    }
  }
}
