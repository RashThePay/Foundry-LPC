import { ID, esc, t, flag, list, setting, turnKey, button, choices, Lifetime } from './core.mjs'
import { rollOptions } from './dnd5e-adapter.mjs'
import { spriteForm, handleSpriteCommand, installConfigFields } from './preparation.mjs'
import { PromptQueue } from './prompts.mjs'

export class GMWorkspace extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: 'flpcm-gm',
    classes: ['flpcm-workspace'],
    window: { title: 'FLPCM.UI.workspace', resizable: true },
    position: { width: 760, height: 680 }
  }
  constructor(requests, animator) {
    super()
    this.requests = requests
    this.animator = animator
    this.tab = 'requests'
    this.status = 'active'
    this.player = ''
    this.selected = null
    this.drafts = new Map()
    this.seen = new Set()
    this.life = new Lifetime()
    this.docked = false
    this.prompts = new PromptQueue()
  }
  install() {
    if (!game.user.isGM) return
    const placement = setting('gmPlacement')
    this.docked = placement.docked ?? false
    this.launcher = document.createElement('button')
    this.launcher.id = 'flpcm-gm-launcher'
    this.launcher.addEventListener('click', () =>
      this.render({ force: true, position: this.docked ? this.dockPosition() : placement.position || {} })
    )
    this.placeLauncher()
    this.life.hook('renderSidebar', () => this.placeLauncher())
    for (const hook of [
      'createChatMessage',
      'updateChatMessage',
      'deleteChatMessage',
      'updateUser',
      'updateActor',
      'updateToken',
      'createToken',
      'deleteToken',
      'canvasReady',
      'updateCombat'
    ])
      this.life.hook(hook, (doc) => {
        this.updateLauncher()
        if (
          hook === 'createChatMessage' &&
          flag(doc, 'kind') === 'intent' &&
          doc.visible &&
          !this.seen.has(doc.id)
        ) {
          this.seen.add(doc.id)
          const request = this.requests.all().find((r) => r.messageId === doc.id)
          if (request)
            this.prompts.show(
              doc.id,
              t('interaction'),
              `${game.users.get(request.playerId)?.name || ''}: ${request.text}`,
              async () => {
                this.selected = request.id
                this.tab = 'requests'
                await this.render({ force: true })
              }
            )
        }
        if (this.rendered) this.render()
        if (
          hook === 'createChatMessage' &&
          flag(doc, 'kind') === 'request-roll' &&
          doc.isContentVisible !== false
        ) {
          const request = this.requests.get(flag(doc, 'requestId'))
          if (request)
            this.prompts.show(
              doc.id,
              t('rollResult', { total: doc.rolls?.[0]?.total ?? '' }),
              request.targetName,
              async () => {
                this.selected = request.id
                this.tab = 'requests'
                await this.render({ force: true })
              }
            )
        }
      })
    this.life.interval(() => {
      if (this.rendered && this.tab === 'players' && !this.element.contains(document.activeElement))
        this.render()
    }, 15000)
    this.life.on(window, 'resize', () => {
      if (this.rendered && this.docked) this.setPosition(this.dockPosition())
    })
    this.updateLauncher()
  }
  placeLauncher() {
    const menu = document.querySelector('#sidebar-tabs > menu')
    if (menu) {
      let item = menu.querySelector('[data-flpcm-launcher]')
      if (!item) {
        item = document.createElement('li')
        item.dataset.flpcmLauncher = ''
        menu.append(item)
      }
      item.append(this.launcher)
      this.launcher.classList.add('flpcm-in-sidebar')
    } else {
      document.body.append(this.launcher)
      this.launcher.classList.remove('flpcm-in-sidebar')
    }
  }
  dockPosition() {
    return {
      left: Math.max(0, innerWidth - 600),
      top: 60,
      width: Math.min(600, innerWidth),
      height: Math.max(320, innerHeight - 80)
    }
  }
  updateLauncher() {
    if (this.launcher)
      this.launcher.textContent = t('workspaceCount', {
        count: this.requests.all().filter((r) => !['resolved', 'dismissed'].includes(r.status)).length
      })
  }
  async _renderHTML() {
    return `<nav class="flpcm-gm-tabs">${['requests', 'players', 'sceneSetup'].map((tab) => `<button data-command="tab" data-tab="${tab}" aria-pressed="${this.tab === tab}">${esc(t(tab))}</button>`).join('')}${button('dock', this.docked ? 'float' : 'dock')}</nav><div class="flpcm-gm-body">${this.tab === 'requests' ? this.renderRequests() : this.tab === 'players' ? this.renderPlayers() : this.renderScene()}</div>`
  }
  _replaceHTML(result, content) {
    const old = content.querySelector('.flpcm-gm-detail'),
      scroll = old?.scrollTop || 0,
      active = document.activeElement,
      field = content.contains(active) ? active.name : null,
      selection = active?.selectionStart
    content.innerHTML = result
    const detail = content.querySelector('.flpcm-gm-detail')
    if (detail) detail.scrollTop = scroll
    content.onclick = (e) => {
      const target = e.target.closest('[data-command]')
      if (target) this.run(() => this.command(target.dataset.command, target.dataset, target))
    }
    content.oninput = (e) => {
      if (e.target.name && this.selected) {
        const draft = this.drafts.get(this.selected) || {}
        draft[e.target.name] = e.target.type === 'checkbox' ? e.target.checked : e.target.value
        this.drafts.set(this.selected, draft)
      }
    }
    content.onchange = (e) => {
      if (e.target.dataset.filter) {
        this[e.target.dataset.filter] = e.target.value
        this.render()
      }
      if (e.target.name === 'kind') this.render()
    }
    if (field) {
      const input = content.querySelector(`[name="${field}"]`)
      input?.focus()
      try {
        input?.setSelectionRange(selection, selection)
      } catch {}
    }
  }
  async close(options) {
    await game.settings.set(ID, 'gmPlacement', {
      docked: this.docked,
      position: {
        left: this.position.left,
        top: this.position.top,
        width: this.position.width,
        height: this.position.height
      }
    })
    return super.close(options)
  }
  renderRequests() {
    const all = this.requests.all(),
      filtered = all.filter(
        (r) =>
          (!this.player || r.playerId === this.player) &&
          (this.status === 'all' ||
            (this.status === 'active' && !['resolved', 'dismissed'].includes(r.status)) ||
            r.status === this.status)
      )
    const read = flag(game.user, 'readRequests') || {}
    return `<div class="flpcm-toolbar"><label>${esc(t('status'))}<select data-filter="status">${choices(
      ['active', 'all', 'pending', 'waiting', 'resolved', 'dismissed'].map((v) => [v, t(v)]),
      this.status
    )}</select></label><label>${esc(t('player'))}<select data-filter="player">${choices(
      [
        ['', t('all')],
        ...list(game.users)
          .filter((u) => !u.isGM)
          .map((u) => [u.id, u.name])
      ],
      this.player
    )}</select></label></div><div class="flpcm-gm-split"><div class="flpcm-request-list">${
      filtered
        .map((r) => {
          const latest = r.events.at(-1)?.timestamp || r.createdAt
          return `<button class="flpcm-request-summary ${this.selected === r.id ? 'selected' : ''}" data-command="select" data-id="${esc(r.id)}"><strong>${esc(r.targetName)}</strong><span>${esc(game.users.get(r.playerId)?.name)} · ${esc(game.actors.get(r.actorId)?.name || t('noCharacter'))}</span><small>${esc(game.scenes.get(r.sceneId)?.name || t('scene'))} · ${Math.max(0, Math.floor((Date.now() - r.createdAt) / 60000))}${esc(t('minutes'))}</small><span>${esc(t(r.status))}${latest > (read[r.id] || 0) ? ` · ${esc(t('unread'))}` : ''}</span></button>`
        })
        .join('') || `<p>${esc(t('noRequests'))}</p>`
    }</div><div class="flpcm-gm-detail">${this.renderDetail(all.find((r) => r.id === this.selected))}</div></div>`
  }
  renderDetail(request) {
    if (!request) return `<p class="flpcm-empty">${esc(t('selectRequest'))}</p>`
    const draft = this.drafts.get(request.id) || {},
      kind = draft.kind || 'skill'
    const secret = list(game.messages)
      .filter(
        (m) =>
          m.visible &&
          m.author?.isGM &&
          flag(m, 'kind') === 'request-secret' &&
          flag(m, 'requestId') === request.id
      )
      .at(-1)
    return `<h2>${esc(request.targetName)}</h2><p class="flpcm-chip">${esc(t(request.status))}</p><blockquote>${esc(request.text)}</blockquote>${request.events.map((e) => `<article class="flpcm-card"><small>${esc(game.users.get(e.author)?.name)}</small><p>${esc(e.text || t(e.status || 'rollRequested'))}</p>${e.roll ? `<p>${esc(t(e.roll.kind))}: ${esc(e.roll.key)}</p>` : ''}</article>`).join('')}${request.rolls.map((r) => `<p>${esc(t('rollResult', { total: r.total }))}</p>`).join('')}${secret ? `<p class="flpcm-secret">${esc(t('gmOnly'))} · ${esc(t('dc'))}: ${esc(flag(secret, 'dc'))}</p>` : ''}<div class="flpcm-toolbar">${button('locate', 'locate')}${button('resolve', 'resolve')}${button('dismiss', 'dismiss')}${button('reopen', 'reopen')}</div><label>${esc(t('reply'))}<textarea name="reply" rows="3" maxlength="2000">${esc(draft.reply || '')}</textarea></label><label class="flpcm-check"><input type="checkbox" name="publicReply" ${draft.publicReply ? 'checked' : ''}>${esc(t('publicReply'))}</label>${button('reply', 'sendReply')}<fieldset><legend>${esc(t('requestRoll'))}</legend><label>${esc(t('rollType'))}<select name="kind">${choices(
      ['skill', 'check', 'save'].map((k) => [k, t(k)]),
      kind
    )}</select></label><label>${esc(t('abilitySkill'))}<select name="key">${choices(rollOptions(kind), draft.key)}</select></label><label>${esc(t('secretDC'))}<input name="dc" type="number" min="0" max="100" value="${esc(draft.dc || '')}"></label>${button('request-roll', 'requestRoll')}</fieldset>`
  }
  renderPlayers() {
    return list(game.users)
      .filter((u) => !u.isGM)
      .map((user) => {
        const actor = user.character,
          tokens = list(canvas.tokens?.placeables).filter((token) => token.actor?.id === actor?.id),
          token = tokens[0],
          presence = flag(user, 'presence'),
          fresh = presence && Date.now() - presence.at < 75000 && user.active,
          owned = actor?.testUserPermission(user, 'OWNER'),
          exception = flag(token?.document, 'exception'),
          valid = exception?.key === turnKey(game.combat, canvas.scene?.id)
        return `<article class="flpcm-card"><h3>${esc(user.name)} <span class="flpcm-chip">${esc(t(user.active ? 'connected' : 'disconnected'))}</span></h3><p>${esc(actor?.name || t('assignCharacter'))} · ${esc(t(owned ? 'ownershipReady' : 'ownershipMissing'))}</p><p>${esc(token?.name || t('placeToken'))}</p><p>${esc(t(fresh ? (presence.shell ? 'mobileReady' : 'nativeMode') : 'unknown'))}${fresh ? ` · ${esc(new Date(presence.at).toLocaleTimeString())}` : ''}</p><div class="flpcm-toolbar"><button data-command="user-config" data-id="${user.id}">${esc(t('configureUser'))}</button>${actor ? `<button data-command="ownership" data-id="${actor.id}">${esc(t('ownership'))}</button>` : ''}${token ? `<button data-command="locate-token" data-id="${token.id}">${esc(t('locate'))}</button><button data-command="recenter-prompt" data-id="${user.id}" data-token="${token.id}">${esc(t('recenterPrompt'))}</button>` : ''}</div>${token ? `<div class="flpcm-toolbar"><button data-command="exception-move" data-id="${token.id}" aria-pressed="${!!(valid && exception.move)}">${esc(t(valid && exception.move ? 'revokeMovement' : 'allowMovement'))}</button><button data-command="exception-action" data-id="${token.id}" aria-pressed="${!!(valid && exception.action)}">${esc(t(valid && exception.action ? 'revokeActions' : 'allowActions'))}</button></div>` : ''}</article>`
      })
      .join('')
  }
  renderScene() {
    return `<h2>${esc(canvas.scene?.name || t('scene'))}</h2><p>${esc(t('sceneHelp'))}</p><div class="flpcm-toolbar">${button('tile-config', 'configureTile')}${button('settings', 'tableSettings')}</div>${spriteForm()}`
  }
  async locate(request) {
    const scene = game.scenes.get(request.sceneId)
    if (!scene) throw new Error(t('unavailable'))
    if (canvas.scene?.id !== scene.id) await scene.view()
    const object =
      request.targetType === 'tile'
        ? canvas.tiles.get(request.targetId)
        : canvas.tokens.get(request.targetId || request.tokenId)
    if (!object) throw new Error(t('targetMissing'))
    await canvas.animatePan({ x: object.center.x, y: object.center.y })
  }
  async run(fn) {
    try {
      await fn()
    } catch (error) {
      console.warn(`${ID} | GM`, error)
      ui.notifications.error(error?.message || t('failed'))
    }
  }
  async command(command, data, element) {
    if (command === 'tab') {
      this.tab = data.tab
      return this.render()
    }
    if (command === 'dock') {
      this.docked = !this.docked
      this.setPosition(
        this.docked
          ? this.dockPosition()
          : { left: Math.max(20, (innerWidth - 760) / 2), top: 80, width: 760, height: 680 }
      )
      await game.settings.set(ID, 'gmPlacement', { docked: this.docked, position: this.position })
      return this.render()
    }
    if (command === 'select') {
      this.selected = data.id
      const read = foundry.utils.deepClone(flag(game.user, 'readRequests') || {})
      read[data.id] = Date.now()
      await game.user.setFlag(ID, 'readRequests', read)
      return this.render()
    }
    if (command === 'locate') return this.locate(this.requests.get(this.selected))
    if (['resolve', 'dismiss', 'reopen', 'reply', 'request-roll'].includes(command)) {
      if (this.sending) return
      const request = this.requests.get(this.selected)
      if (!request) throw new Error(t('unavailable'))
      this.sending = true
      element.disabled = true
      try {
        const draft = this.drafts.get(this.selected) || {}
        const payload = {}
        if (command === 'reply') {
          if (!draft.reply?.trim()) throw new Error(t('describeRequired'))
          Object.assign(payload, { text: draft.reply, publicReply: !!draft.publicReply })
        } else if (command === 'request-roll') {
          if (request.prompts.some((p) => !p.done) && !['resolved', 'dismissed'].includes(request.status))
            throw new Error(t('rollAlreadyPending'))
          const kind = this.element.querySelector('[name=kind]').value,
            key = this.element.querySelector('[name=key]').value
          if (!rollOptions(kind).some(([k]) => k === key)) throw new Error(t('unavailable'))
          Object.assign(payload, {
            status: 'waiting',
            roll: { kind, key },
            dc: draft.dc,
            text: t('rollRequested')
          })
        } else payload.status = { resolve: 'resolved', dismiss: 'dismissed', reopen: 'pending' }[command]
        await this.requests.event(request.id, payload)
        if (command === 'reply') this.drafts.set(request.id, { ...draft, reply: '' })
        await this.render()
      } finally {
        this.sending = false
        if (element.isConnected) element.disabled = false
      }
      return
    }
    if (command === 'user-config')
      return new foundry.applications.sheets.UserConfig({ document: game.users.get(data.id) }).render({
        force: true
      })
    if (command === 'ownership')
      return new foundry.applications.apps.DocumentOwnershipConfig({
        document: game.actors.get(data.id)
      }).render({ force: true })
    if (command === 'locate-token') {
      const token = canvas.tokens.get(data.id)
      if (token) return canvas.animatePan(token.center)
    }
    if (command === 'recenter-prompt')
      return ChatMessage.create({
        whisper: [data.id, ...ChatMessage.getWhisperRecipients('GM').map((u) => u.id)],
        content: esc(t('recenterInvitation')),
        flags: { [ID]: { v: 1, kind: 'recenter', sceneId: canvas.scene.id, tokenId: data.token } }
      })
    if (command.startsWith('exception-')) {
      const token = canvas.tokens.get(data.id)
      if (!token) throw new Error(t('unavailable'))
      const kind = command === 'exception-move' ? 'move' : 'action',
        key = turnKey(game.combat, canvas.scene?.id),
        previous = flag(token.document, 'exception')
      await token.document.setFlag(ID, 'exception', {
        key,
        move: previous?.key === key && !!previous.move,
        action: previous?.key === key && !!previous.action,
        [kind]: !(previous?.key === key && previous[kind])
      })
      return
    }
    if (command === 'tile-config') {
      const tile = canvas.tiles.controlled[0]
      if (!tile) throw new Error(t('selectTile'))
      return tile.document.sheet.render(true)
    }
    if (command === 'settings') return game.settings.sheet.render(true)
    if (command.startsWith('sprite-')) return handleSpriteCommand(command, this.element, this.animator)
  }
}

export function installPreparation() {
  installConfigFields()
}
