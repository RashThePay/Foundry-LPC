import { LPCAnimator } from './lpc-animator.mjs'

const MODULE_ID = 'foundry-lpc-mobile'
const SOCKET = `module.${MODULE_ID}`
const esc = value => foundry.utils.escapeHTML(String(value ?? ''))

function compactMode() {
  return game.settings.get(MODULE_ID, 'desktopPreview') || window.matchMedia(`(max-width: ${game.settings.get(MODULE_ID, 'maxWidth')}px)`).matches
}

function isResolutionWarning(message) {
  const text = String(message || '')
  return text.startsWith('ERROR.RESOLUTION.')
    || text.includes('requires a usable window dimensions')
    || text.includes('requires usable window dimensions')
    || text.includes('requires a screen resolution')
}

function isMobilePlayerMode() {
  try {
    return !game.user?.isGM && game.settings.get(MODULE_ID, 'enabled') && compactMode()
  } catch (_error) {
    return false
  }
}

function suppressMobileResolutionWarning() {
  const notifications = globalThis.ui?.notifications
  if (!notifications?.error || notifications.error._flpcmWrapped) return
  const original = notifications.error.bind(notifications)
  const wrapped = function(message, options = {}) {
    if (isResolutionWarning(message) && isMobilePlayerMode()) {
      console.info(`${MODULE_ID} | Suppressed Foundry's desktop minimum-resolution warning for mobile player mode.`)
      return null
    }
    return original(message, options)
  }
  wrapped._flpcmWrapped = true
  notifications.error = wrapped
}

function suppressResolutionAtPrototype() {
  const Notifications = foundry?.applications?.ui?.Notifications
  const prototype = Notifications?.prototype
  if (!prototype?.notify || prototype.notify._flpcmWrapped) return
  const original = prototype.notify
  const wrapped = function(message, type = 'info', options = {}) {
    if (type === 'error' && isResolutionWarning(message) && isMobilePlayerMode()) {
      console.info(`${MODULE_ID} | Suppressed Foundry's desktop minimum-resolution warning before rendering.`)
      return null
    }
    return original.call(this, message, type, options)
  }
  wrapped._flpcmWrapped = true
  prototype.notify = wrapped
}

function removeRenderedResolutionWarnings() {
  if (!isMobilePlayerMode()) return
  for (const element of document.querySelectorAll('#notifications > li, .notification')) {
    if (isResolutionWarning(element.textContent)) element.remove()
  }
}

function observeResolutionWarnings() {
  const observer = new MutationObserver(removeRenderedResolutionWarnings)
  observer.observe(document.body, { childList: true, subtree: true })
  removeRenderedResolutionWarnings()
}

function activities(item) {
  const source = item?.system?.activities
  return source?.contents ? [...source.contents] : Object.values(source || {}).filter(value => value?.id)
}

function cleanText(html) {
  const node = document.createElement('div')
  node.innerHTML = String(html || '')
  return (node.textContent || '').replace(/\s+/g, ' ').trim()
}

class PlayerShell {
  constructor(animator) {
    this.animator = animator
    this.root = null
    this.primary = null
    this.focus = null
    this.panel = null
    this.pointer = null
    this.canvasElement = null
    this.chat = []
    this.bubbles = new Map()
    this.pendingIntent = null
    this.handleDown = event => this.pointerDown(event)
    this.handleUp = event => this.pointerUp(event)
  }

  install() {
    if (game.user.isGM || !game.settings.get(MODULE_ID, 'enabled') || !compactMode()) return
    document.body.classList.add('flpcm-active')
    const root = document.createElement('main')
    root.id = 'flpcm-shell'
    root.setAttribute('aria-label', 'Mobile player controls')
    root.innerHTML = `
      <header class="flpcm-status">
        <div class="flpcm-place"><i class="fa-solid fa-location-dot"></i><span data-scene>Loading…</span></div>
        <div class="flpcm-turn" data-turn hidden></div>
        <div class="flpcm-network" data-network hidden><i class="fa-solid fa-wifi"></i> Reconnecting…</div>
      </header>
      <div class="flpcm-target-card" data-target-card hidden></div>
      <div class="flpcm-bubbles" data-bubbles></div>
      <div class="flpcm-toasts" data-toasts aria-live="polite"></div>
      <button class="flpcm-native-chat-close" data-command="chat-close" aria-label="Close chat"><i class="fa-solid fa-xmark"></i></button>
      <div class="flpcm-radial" data-radial hidden></div>
      <section class="flpcm-panel" data-panel hidden aria-modal="true" role="dialog">
        <header><div><small data-panel-kicker></small><h2 data-panel-title></h2></div><button data-command="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></header>
        <div class="flpcm-panel-body" data-panel-body></div>
      </section>
      <nav class="flpcm-dock">
        <button class="flpcm-identity" data-command="character"><img data-portrait alt=""><span><strong data-name>Choose a character</strong><small data-hp>No character assigned</small><i><i data-hp-fill></i></i></span></button>
        <button class="flpcm-main-action" data-command="radial"><i class="fa-solid fa-burst"></i><span>Act</span></button>
        <button class="flpcm-chat-button" data-command="chat"><i class="fa-solid fa-comment-dots"></i><span>Chat</span><b data-unread hidden>0</b></button>
      </nav>`
    document.body.appendChild(root)
    this.root = root
    root.addEventListener('click', event => this.click(event))
    root.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.closePanel()
      if (event.key === 'Enter' && !event.shiftKey && event.target.matches('[data-chat-input]')) { event.preventDefault(); void this.sendChat() }
      if (event.key === 'Enter' && event.ctrlKey && event.target.matches('[data-intent-input]')) { event.preventDefault(); void this.sendIntent() }
    })
    this.bindHooks()
    this.seedChat()
    if (canvas?.ready) this.canvasReady()
  }

  bindHooks() {
    Hooks.on('canvasReady', () => this.canvasReady())
    Hooks.on('canvasPan', () => this.positionOverlays())
    Hooks.on('updateActor', actor => { if (actor.id === this.actor()?.id) this.refresh() })
    Hooks.on('updateToken', document => { if ([this.primary?.id, this.focus?.id].includes(document.id)) this.refresh() })
    for (const hook of ['createCombat', 'updateCombat', 'deleteCombat', 'combatTurnChange']) Hooks.on(hook, () => this.renderTurn())
    Hooks.on('createChatMessage', message => this.receiveChat(message))
    window.addEventListener('resize', () => this.positionOverlays())
    window.addEventListener('offline', () => this.setNetwork(false))
    window.addEventListener('online', () => this.setNetwork(true))
  }

  canvasReady() {
    this.canvasElement?.removeEventListener('pointerdown', this.handleDown, true)
    this.canvasElement?.removeEventListener('pointerup', this.handleUp, true)
    this.canvasElement = canvas?.app?.canvas || canvas?.app?.view || document.querySelector('#board canvas')
    this.canvasElement?.addEventListener('pointerdown', this.handleDown, true)
    this.canvasElement?.addEventListener('pointerup', this.handleUp, true)
    this.choosePrimary()
    this.refresh()
  }

  actor() { return this.primary?.actor || game.user.character || null }

  choosePrimary() {
    const tokens = (canvas?.tokens?.placeables || []).filter(token => token.actor?.isOwner && !token.document.hidden)
    this.primary = tokens.find(token => token.actor?.id === game.user.character?.id) || tokens.find(token => token.controlled) || tokens[0] || null
    if (this.primary && !this.primary.controlled) this.primary.control({ releaseOthers: true })
  }

  pointerDown(event) {
    if (event.button !== 0 || event.target !== this.canvasElement) return
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, time: Date.now() }
  }

  pointerUp(event) {
    if (!this.pointer || this.pointer.id !== event.pointerId) return
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      event.preventDefault()
      event.stopImmediatePropagation()
    }
    const start = this.pointer
    this.pointer = null
    if (Date.now() - start.time > 500 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 14) return
    const point = canvas?.canvasCoordinatesFromClient?.({ x: event.clientX, y: event.clientY })
    if (!point) return
    const token = [...(canvas.tokens?.placeables || [])].reverse().find(value => value.visible && !value.document.hidden && value.bounds?.contains(point.x, point.y))
    if (token) return token === this.primary ? this.openRadial() : this.selectTarget(token)
    const tile = [...(canvas.tiles?.placeables || [])].reverse().find(value => value.visible && !value.document.hidden && value.bounds?.contains(point.x, point.y))
    if (tile) return this.selectObject(tile, point)
    this.focus = null
    this.hide('[data-target-card]')
    void this.move(point)
  }

  async move(point) {
    const token = this.primary
    if (!token?.document?.isOwner) return this.toast('Ask the GM to assign your character.', 'warning')
    if (game.paused) return this.toast('The game is paused.', 'warning')
    if (game.combat?.started && game.combat.combatant?.tokenId !== token.id) return this.toast('Wait for your turn.', 'warning')
    if (token.document.locked) return this.toast('Your character cannot move right now.', 'warning')
    const wanted = token.document.getSnappedPosition?.({ x: point.x - token.w / 2, y: point.y - token.h / 2 }) || { x: point.x - token.w / 2, y: point.y - token.h / 2 }
    const origin = { x: Number(token.document.x), y: Number(token.document.y), explicit: true }
    try {
      const calculation = token.findMovementPath?.([origin, { ...wanted, explicit: true }], { constrainOptions: { ignoreWalls: false, ignoreCost: false }, delay: 0 })
      const path = calculation?.promise ? await calculation.promise : [origin, wanted]
      const end = path?.at(-1)
      if (!end || Math.hypot(end.x - wanted.x, end.y - wanted.y) > 2) return this.toast('That path is blocked.', 'warning')
      const ok = await token.document.move(path.slice(1), { animate: true, pan: false, showRuler: false, constrainOptions: { ignoreWalls: false, ignoreCost: false } })
      if (!ok) this.toast('That destination is not available.', 'warning')
    } catch (error) {
      console.warn(`${MODULE_ID} | movement`, error)
      this.toast(error?.message || 'Movement failed.', 'warning')
    }
  }

  selectTarget(token) {
    this.focus = { kind: 'token', placeable: token, point: token.center }
    token.setTarget?.(true, { user: game.user, releaseOthers: true })
    const card = this.q('[data-target-card]')
    card.innerHTML = `<img src="${esc(token.document.texture?.src || token.actor?.img)}" alt=""><span><strong>${esc(token.name)}</strong><small>${token.actor?.type === 'npc' ? 'Creature' : 'Character'}</small></span><button data-command="talk"><i class="fa-solid fa-message"></i> Talk</button><button data-command="inspect"><i class="fa-solid fa-eye"></i></button>`
    card.hidden = false
    this.positionOverlays()
  }

  selectObject(tile, point) {
    const name = tile.document.getFlag(MODULE_ID, 'name') || tile.document.texture?.src?.split('/').pop()?.replace(/\.[^.]+$/, '') || 'Object'
    this.focus = { kind: 'tile', placeable: tile, point, name }
    this.openIntent()
  }

  openRadial() {
    const radial = this.q('[data-radial]')
    const items = [
      ['actions', 'fa-burst', 'Actions'], ['spells', 'fa-wand-sparkles', 'Spells'], ['items', 'fa-backpack', 'Items'],
      ['interact', 'fa-hand', 'Interact'], ['character', 'fa-user', 'Character']
    ]
    radial.innerHTML = `<button class="flpcm-radial-center" data-command="radial-close"><img src="${esc(this.primary?.document.texture?.src || this.actor()?.img)}" alt=""></button>${items.map(([command, icon, label], index) => `<button class="flpcm-radial-item i${index}" data-command="${command}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`).join('')}`
    radial.hidden = false
  }

  click(event) {
    const channel = event.target.closest('[data-channel]')
    if (channel) {
      this.root.querySelectorAll('[data-channel]').forEach(button => button.classList.toggle('active', button === channel))
      this.q('[data-channel-value]').value = channel.dataset.channel
      return
    }
    const verb = event.target.closest('[data-verb]')
    if (verb) {
      this.root.querySelectorAll('[data-verb]').forEach(button => button.classList.toggle('active', button === verb))
      this.q('[data-verb-value]').value = verb.dataset.verb
      return
    }
    const activity = event.target.closest('[data-item][data-activity]')
    if (activity) return void this.useActivity(activity.dataset.item, activity.dataset.activity)
    const command = event.target.closest('[data-command]')?.dataset.command
    if (!command) return
    if (command === 'close') return this.closePanel()
    if (command === 'radial') return this.openRadial()
    if (command === 'radial-close') return this.hide('[data-radial]')
    if (['actions', 'spells', 'items'].includes(command)) return this.openActions(command)
    if (command === 'character') return this.openCharacter()
    if (command === 'chat' || command === 'talk') return this.openNativeChat()
    if (command === 'chat-close') return this.closeNativeChat()
    if (command === 'inspect') return this.openInspect()
    if (command === 'interact') return this.openIntent()
    if (command === 'send-chat') return void this.sendChat()
    if (command === 'send-intent') return void this.sendIntent()
    if (command === 'end-turn') return void game.combat?.nextTurn()
  }

  openPanel(title, kicker, html) {
    this.hide('[data-radial]')
    this.panel = title
    this.q('[data-panel-title]').textContent = title
    this.q('[data-panel-kicker]').textContent = kicker
    this.q('[data-panel-body]').innerHTML = html
    this.q('[data-panel]').hidden = false
  }

  closePanel() { this.panel = null; this.q('[data-panel]').hidden = true }

  openActions(filter = 'actions') {
    const actor = this.actor()
    if (!actor) return this.openPanel('Actions', 'Character required', '<div class="flpcm-empty">Ask the GM to assign a character.</div>')
    const category = item => item.type === 'spell' ? 'spells' : ['equipment', 'consumable', 'loot', 'tool'].includes(item.type) ? 'items' : 'actions'
    const entries = [...actor.items].flatMap(item => activities(item).map(activity => ({ item, activity }))).filter(entry => category(entry.item) === filter)
    const html = entries.map(({ item, activity }) => {
      const activation = activity.activation?.type || item.system?.activation?.type || ''
      const uses = activity.uses || item.system?.uses
      return `<button class="flpcm-action-card" data-command="use" data-item="${esc(item.id)}" data-activity="${esc(activity.id)}"><img src="${esc(activity.img || item.img)}" alt=""><span><strong>${esc(activity.name || item.name)}</strong><small>${esc([activation, uses?.max ? `${uses.value}/${uses.max}` : ''].filter(Boolean).join(' · '))}</small></span><i class="fa-solid fa-chevron-right"></i></button>`
    }).join('')
    this.openPanel(filter[0].toUpperCase() + filter.slice(1), game.combat?.started ? 'Combat' : actor.name, html || '<div class="flpcm-empty">Nothing is available in this category.</div>')
  }

  async useActivity(itemId, activityId) {
    const item = this.actor()?.items?.get(itemId)
    const activity = activities(item).find(value => value.id === activityId)
    if (!item || !activity?.use) return this.toast('That action is unavailable.', 'warning')
    if (game.combat?.started && game.combat.combatant?.tokenId !== this.primary?.id) return this.toast('You can inspect that action, but it is not your turn.', 'warning')
    this.closePanel()
    const state = item.type === 'spell' ? 'cast' : activity.actionType?.includes('r') ? 'shoot' : 'slash'
    this.animator.play(this.primary, state)
    try { await activity.use() } catch (error) { this.toast(error?.message || 'The action failed.', 'warning') }
  }

  openCharacter() {
    const actor = this.actor()
    if (!actor) return this.openPanel('Character', 'Unassigned', '<div class="flpcm-empty">Ask the GM to assign a character.</div>')
    const hp = actor.system.attributes?.hp || {}
    const ac = actor.system.attributes?.ac?.value ?? actor.system.attributes?.ac ?? '—'
    const abilities = Object.entries(actor.system.abilities || {}).map(([key, value]) => `<div><span>${esc(key.toUpperCase())}</span><strong>${Number(value.mod) >= 0 ? '+' : ''}${esc(value.mod)}</strong></div>`).join('')
    this.openPanel(actor.name, 'Character', `<div class="flpcm-hero"><img src="${esc(this.primary?.document.texture?.src || actor.img)}" alt=""><div><h3>${esc(actor.name)}</h3><p>${esc(actor.system.details?.race || actor.type)}</p></div></div><div class="flpcm-stats"><div><small>HP</small><strong>${esc(hp.value)} / ${esc(hp.max)}</strong></div><div><small>Armor</small><strong>${esc(ac)}</strong></div><div><small>Speed</small><strong>${esc(actor.system.attributes?.movement?.walk || '—')}</strong></div></div><div class="flpcm-abilities">${abilities}</div>`) 
  }

  openInspect() {
    const token = this.focus?.kind === 'token' ? this.focus.placeable : null
    if (!token) return this.toast('Tap a creature first.', 'warning')
    const description = cleanText(token.actor?.system?.details?.biography?.public || token.actor?.system?.details?.type?.value || '')
    this.openPanel(token.name, 'Inspecting', `<div class="flpcm-hero"><img src="${esc(token.document.texture?.src || token.actor?.img)}" alt=""><div><h3>${esc(token.name)}</h3><p>${esc(description || 'You notice nothing more from here.')}</p></div></div><button class="flpcm-wide" data-command="interact"><i class="fa-solid fa-hand"></i> Describe an interaction</button>`)
  }

  openIntent() {
    const focus = this.focus
    const objectName = focus?.kind === 'tile' ? focus.name : focus?.kind === 'token' ? focus.placeable.name : 'the scene'
    const verbs = ['Inspect', 'Open', 'Use', 'Take', 'Push', 'Listen']
    this.openPanel(`Interact with ${objectName}`, 'Tell the GM what you attempt', `<p class="flpcm-help">Choose a starting idea or describe anything your character tries.</p><div class="flpcm-verbs">${verbs.map(verb => `<button data-verb="${verb.toLowerCase()}">${verb}</button>`).join('')}</div><input type="hidden" data-verb-value value=""><textarea data-intent-input maxlength="800" rows="5" placeholder="I wedge my sword beneath it and try to lever it aside…"></textarea><button class="flpcm-wide primary" data-command="send-intent"><i class="fa-solid fa-paper-plane"></i> Send intent to GM</button>`)
  }

  async sendIntent() {
    const text = this.q('[data-intent-input]')?.value.trim()
    if (!text) return this.toast('Describe what your character tries.', 'warning')
    const verb = this.q('[data-verb-value]')?.value || null
    const focus = this.focus
    const target = focus?.placeable?.document
    const data = { id: foundry.utils.randomID(), playerId: game.user.id, actorId: this.actor()?.id || null, sceneId: canvas.scene?.id || null, targetType: focus?.kind || 'scene', targetId: target?.id || null, targetName: focus?.name || focus?.placeable?.name || canvas.scene?.name || 'Scene', point: focus?.point ? { x: Math.round(focus.point.x), y: Math.round(focus.point.y) } : null, verb, text, createdAt: Date.now() }
    const recipients = ChatMessage.getWhisperRecipients('GM').map(user => user.id)
    await ChatMessage.create({ content: `<section class="flpcm-intent-card"><strong><i class="fa-solid fa-hand"></i> Interaction request</strong><p><b>${esc(data.targetName)}</b>${verb ? ` · ${esc(verb)}` : ''}</p><blockquote>${esc(text)}</blockquote></section>`, speaker: ChatMessage.getSpeaker({ actor: this.actor(), token: this.primary?.document, scene: canvas.scene }), whisper: recipients, style: CONST.CHAT_MESSAGE_STYLES.OTHER, flags: { [MODULE_ID]: { kind: 'intent', data } } })
    game.socket.emit(SOCKET, { type: 'intent', data })
    this.closePanel()
    this.toast('Your intent was sent to the GM.')
  }

  openChat() {
    const lines = this.chat.slice(-60).map(line => `<article class="flpcm-chat-line ${line.private ? 'private' : ''}"><header><strong>${esc(line.speaker)}</strong><small>${line.private ? 'Private GM' : 'Party'}</small></header><p>${esc(line.text)}</p></article>`).join('')
    this.openPanel('Conversation', this.focus?.kind === 'token' ? `Near ${this.focus.placeable.name}` : 'Party chat', `<div class="flpcm-chat-log">${lines || '<div class="flpcm-empty">The conversation is quiet.</div>'}</div><div class="flpcm-channels"><button class="active" data-channel="party">Party</button><button data-channel="gm"><i class="fa-solid fa-lock"></i> Private GM</button><input type="hidden" data-channel-value value="party"></div><div class="flpcm-compose"><textarea data-chat-input maxlength="500" rows="2" placeholder="Say something…"></textarea><button data-command="send-chat" aria-label="Send"><i class="fa-solid fa-paper-plane"></i></button></div>`)
    this.q('[data-unread]').hidden = true
    requestAnimationFrame(() => { const log = this.q('.flpcm-chat-log'); if (log) log.scrollTop = log.scrollHeight })
  }

  openNativeChat() {
    this.closePanel()
    this.hide('[data-radial]')
    document.body.classList.add('flpcm-native-chat')
    const unread = this.q('[data-unread]')
    if (unread) { unread.hidden = true; unread.textContent = '0' }
    ui.sidebar?.changeTab?.('chat', 'primary', { force: true })
    requestAnimationFrame(() => {
      const log = document.querySelector('#chat .chat-log, #chat-log')
      if (log) log.scrollTop = log.scrollHeight
      document.querySelector('#chat-message .editor-content, #chat-message textarea')?.focus?.()
    })
  }

  closeNativeChat() {
    document.body.classList.remove('flpcm-native-chat')
  }

  async sendChat() {
    const input = this.q('[data-chat-input]')
    const text = input?.value.trim()
    if (!text) return
    const channel = this.q('[data-channel-value]')?.value || 'party'
    await ChatMessage.create({ content: esc(text), speaker: ChatMessage.getSpeaker({ actor: this.actor(), token: this.primary?.document, scene: canvas.scene }), whisper: channel === 'gm' ? ChatMessage.getWhisperRecipients('GM').map(user => user.id) : [], style: CONST.CHAT_MESSAGE_STYLES.OTHER, flags: { [MODULE_ID]: { kind: 'speech', channel } } })
    input.value = ''
  }

  seedChat() { for (const message of [...(game.messages || [])].slice(-40)) this.rememberChat(message) }

  receiveChat(message) {
    if (!message.visible) return
    const line = this.rememberChat(message)
    if (!line) return
    const moduleKind = message.getFlag(MODULE_ID, 'kind')
    const simpleNativeSpeech = message.style === CONST.CHAT_MESSAGE_STYLES.OTHER
      && !message.flags?.dnd5e
      && !/<(?:section|article|button|table|form|div)\b/i.test(message.content || '')
    const token = canvas?.tokens?.get(message.speaker?.token) || (canvas?.tokens?.placeables || []).find(value => value.actor?.id === message.speaker?.actor)
    if (token && (moduleKind === 'speech' || simpleNativeSpeech)) this.bubble(token, line.text)
    if (!document.body.classList.contains('flpcm-native-chat')) {
      const unread = this.q('[data-unread]')
      unread.textContent = String(Number(unread.textContent || 0) + 1)
      unread.hidden = false
    }
  }

  rememberChat(message) {
    if (!message?.visible || message.rolls?.length || message.getFlag(MODULE_ID, 'kind') === 'intent') return null
    const text = cleanText(message.content)
    if (!text || this.chat.some(line => line.id === message.id)) return null
    const line = { id: message.id, speaker: message.alias || message.speaker?.alias || message.author?.name || 'Someone', text, private: !!message.whisper?.length }
    this.chat.push(line)
    return line
  }

  bubble(token, text) {
    const id = token.id
    let state = this.bubbles.get(id)
    if (!state) {
      const element = document.createElement('div')
      element.className = 'flpcm-bubble'
      element.dataset.tokenId = id
      this.q('[data-bubbles]').appendChild(element)
      state = { element, queue: [], timer: null }
      this.bubbles.set(id, state)
    }
    state.queue.push(text.slice(0, 180))
    if (!state.timer) this.showNextBubble(token, state)
  }

  showNextBubble(token, state) {
    const text = state.queue.shift()
    if (!text) { state.element.remove(); this.bubbles.delete(token.id); return }
    state.element.textContent = text
    state.timer = setTimeout(() => { state.timer = null; this.showNextBubble(token, state) }, Math.min(6500, 2800 + text.length * 25))
    this.positionOverlays()
  }

  positionOverlays() {
    for (const [id, state] of this.bubbles) {
      const token = canvas?.tokens?.get(id)
      const center = token?.document?.getCenterPoint?.() || token?.center
      const point = center && canvas?.clientCoordinatesFromCanvas?.(center)
      if (!point) continue
      state.element.style.left = `${Math.max(70, Math.min(innerWidth - 70, point.x))}px`
      state.element.style.top = `${Math.max(72, point.y - token.h * (canvas.stage?.scale?.y || 1) / 2 - 18)}px`
    }
  }

  refresh() {
    if (!this.primary?.document || this.primary.document.parent?.id !== canvas.scene?.id) this.choosePrimary()
    const actor = this.actor()
    this.q('[data-scene]').textContent = canvas.scene?.name || 'No active scene'
    this.q('[data-name]').textContent = actor?.name || 'Choose a character'
    this.q('[data-portrait]').src = this.primary?.document.texture?.src || actor?.img || 'icons/svg/mystery-man.svg'
    const hp = actor?.system?.attributes?.hp
    const down = hp && Number(hp.value) <= 0
    this.root.classList.toggle('is-downed', !!down)
    this.q('[data-hp]').textContent = hp ? `${hp.value}${hp.temp ? ` +${hp.temp}` : ''} / ${hp.max} HP` : 'No character assigned'
    this.q('[data-hp-fill]').style.width = hp?.max ? `${Math.max(0, Math.min(100, hp.value / hp.max * 100))}%` : '0%'
    if (down) this.animator.play(this.primary, 'hurt')
    this.renderTurn()
  }

  renderTurn() {
    const node = this.q('[data-turn]')
    const combat = game.combat
    if (!combat?.started) { node.hidden = true; return }
    const mine = combat.combatant?.tokenId === this.primary?.id
    node.hidden = false
    node.classList.toggle('mine', mine)
    node.innerHTML = mine ? `<i class="fa-solid fa-star"></i> Your turn <button data-command="end-turn">End</button>` : `<i class="fa-solid fa-hourglass-half"></i> ${esc(combat.combatant?.name || 'Combat')}`
  }

  setNetwork(online) { this.q('[data-network]').hidden = online }
  toast(text, tone = '') { const node = document.createElement('div'); node.className = `flpcm-toast ${tone}`; node.textContent = text; this.q('[data-toasts]').appendChild(node); setTimeout(() => node.remove(), 3500) }
  q(selector) { return this.root?.querySelector(selector) }
  hide(selector) { const node = this.q(selector); if (node) node.hidden = true }
}

function installGmSocket() {
  if (!game.user.isGM) return
  game.socket.on(SOCKET, packet => {
    if (packet?.type !== 'intent') return
    const data = packet.data
    ui.notifications.info(`${game.users.get(data.playerId)?.name || 'A player'} wants to interact with ${data.targetName}.`)
  })
}

function addLpcFields(app, html) {
  if (!game.user.isGM) return
  const root = html instanceof HTMLElement ? html : html?.[0]
  const form = root?.querySelector('form') || root
  if (!form || form.querySelector('[data-flpcm-lpc]')) return
  const current = app.document?.getFlag(MODULE_ID, 'lpc') || {}
  const group = document.createElement('fieldset')
  group.dataset.flpcmLpc = ''
  group.innerHTML = `<legend>Foundry LPC Mobile</legend><div class="form-group"><label>LPC spritesheet</label><div class="form-fields"><file-picker name="flags.${MODULE_ID}.lpc.src" type="imagevideo" value="${esc(current.src || '')}"></file-picker></div><p class="hint">Universal LPC 64px sheet. Leave blank to use the normal token image.</p></div><div class="form-group"><label>Animation FPS</label><div class="form-fields"><input type="number" name="flags.${MODULE_ID}.lpc.fps" value="${esc(current.fps || 9)}" min="1" max="30"></div></div>`
  form.appendChild(group)
}

Hooks.once('init', () => {
  game.settings.register(MODULE_ID, 'enabled', { name: 'FLPCM.Settings.Enabled', hint: 'FLPCM.Settings.EnabledHint', scope: 'world', config: true, type: Boolean, default: true, requiresReload: true })
  game.settings.register(MODULE_ID, 'desktopPreview', { name: 'FLPCM.Settings.DesktopPreview', hint: 'FLPCM.Settings.DesktopPreviewHint', scope: 'client', config: true, type: Boolean, default: false, requiresReload: true })
  game.settings.register(MODULE_ID, 'maxWidth', { name: 'FLPCM.Settings.MaxWidth', hint: 'FLPCM.Settings.MaxWidthHint', scope: 'world', config: true, type: Number, default: 1100, range: { min: 600, max: 1600, step: 50 }, requiresReload: true })
  suppressResolutionAtPrototype()
  suppressMobileResolutionWarning()
  observeResolutionWarnings()
})

// Some Foundry views construct the Notifications application after the init hook.
// setup still fires before the core post-view resolution validation.
Hooks.once('setup', suppressMobileResolutionWarning)

Hooks.once('ready', () => {
  const animator = new LPCAnimator()
  animator.install()
  installGmSocket()
  const shell = new PlayerShell(animator)
  shell.install()
  game.modules.get(MODULE_ID).api = { animator, shell, playAnimation: (token, state, options) => animator.play(token, state, options) }
})

Hooks.on('renderTokenConfig', addLpcFields)
