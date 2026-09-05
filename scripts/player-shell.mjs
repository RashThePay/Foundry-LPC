import {
  ID,
  esc,
  t,
  setting,
  flag,
  list,
  Lifetime,
  permitted,
  turnKey,
  pruneFavorites,
  button,
  textOnly
} from './core.mjs'
import { entries, activities, roll, activeTemplate, moveTemplate, templateCommand } from './dnd5e-adapter.mjs'
import { Gestures } from './gestures.mjs'
import { renderView } from './player-views.mjs'
import { PromptQueue, edgeIndicator } from './prompts.mjs'

export class PlayerShell {
  constructor(animator, requests) {
    this.animator = animator
    this.requests = requests
    this.life = new Lifetime()
    this.session = new Lifetime()
    this.stack = []
    this.bubbles = new Map()

    this.prompts = new PromptQueue()
    this.nativeWindows = new Map()
    this.draft = {}
    this.unread = 0
  }
  install() {
    this.life.on(window, 'resize', () => this.evaluate())
    this.life.hook('canvasReady', () => {
      this.primary = null
      this.focus = null
      this.cancelMove()
      this.bindCanvas()
      this.refresh()
    })
    this.life.hook('canvasTearDown', () => {
      this.gestures?.destroy()
      this.cancelMove()
      this.clearBubbles()
      this.objectHints?.destroy()
      this.objectHints = null
    })
    for (const hook of [
      'updateActor',
      'updateItem',
      'createItem',
      'deleteItem',
      'createActiveEffect',
      'updateActiveEffect',
      'deleteActiveEffect',
      'updateToken',
      'createToken',
      'deleteToken',
      'updateUser',
      'updateCombat',
      'createCombat',
      'deleteCombat',
      'targetToken'
    ])
      this.life.hook(hook, () => this.refresh())
    this.life.hook('canvasPan', () => this.positionBubbles())
    for (const hook of ['sightRefresh', 'createTile', 'updateTile', 'deleteTile'])
      this.life.hook(hook, () => this.refreshObjectHints())
    for (const hook of ['renderApplicationV2', 'renderApplication'])
      this.life.hook(hook, (app, html) => this.fitNativeWindow(app, html))
    for (const hook of ['createChatMessage', 'updateChatMessage', 'deleteChatMessage'])
      this.life.hook(hook, (message) => {
        if (hook === 'createChatMessage') this.receiveChat(message)
        if (this.view === 'requests') this.render()
      })
    this.evaluate()
  }
  evaluate() {
    const wanted =
      !game.user.isGM &&
      setting('enabled') &&
      !setting('nativeUI') &&
      (setting('desktopPreview') || innerWidth <= setting('maxWidth'))
    if (wanted && !this.root) this.mount()
    if (!wanted && this.root) this.unmount()
    this.viewport()
  }
  mount() {
    document.body.classList.add('flpcm-active')
    this.root = document.createElement('main')
    this.root.id = 'flpcm-shell'
    this.root.setAttribute('aria-label', t('playerControls'))
    this.root.innerHTML = `<header class="flpcm-status"><div class="flpcm-place" data-scene></div><div class="flpcm-turn" data-turn hidden></div></header><div class="flpcm-network" data-network hidden>${esc(t('offline'))}</div><div class="flpcm-target-card" data-target hidden></div><div class="flpcm-bubbles"></div><div class="flpcm-toasts" aria-live="polite"></div><div class="flpcm-template" hidden>${button('template-left', 'rotateLeft')}${button('template-right', 'rotateRight')}${button('template-confirm', 'place')}${button('template-cancel', 'cancel')}</div><div class="flpcm-movement" hidden></div><div class="flpcm-favorites"></div><div class="flpcm-radial" hidden></div><section class="flpcm-panel" hidden role="dialog" aria-modal="true" aria-labelledby="flpcm-title"><header>${button('back', 'back')}<h2 id="flpcm-title"></h2>${button('close', 'close')}</header><div class="flpcm-panel-body"></div></section><button class="flpcm-native-chat-close" data-command="chat-close" aria-label="${esc(t('closeChat'))}">×</button><nav class="flpcm-dock"><button class="flpcm-identity" data-command="character"><img data-portrait alt=""><span><strong data-name></strong><small data-hp></small><i><i data-hp-fill></i></i></span></button><button class="flpcm-main-action" data-command="radial">${esc(t('act'))}</button><button class="flpcm-chat-button" data-command="chat">${esc(t('chat'))}<b data-unread hidden></b></button><button class="flpcm-chat-button" data-command="more">${esc(t('more'))}</button></nav>`
    document.body.append(this.root)
    this.q('.flpcm-native-chat-close').textContent = t('closeChat')
    this.chatCloseButton = this.q('.flpcm-native-chat-close')
    document.body.append(this.chatCloseButton)
    this.session.on(this.chatCloseButton, 'click', () => this.closeChat())
    const edge = document.createElement('button')
    edge.className = 'flpcm-edge-portrait'
    edge.dataset.command = 'recenter'
    edge.setAttribute('aria-label', t('recenter'))
    edge.hidden = true
    edge.innerHTML = '<span class="flpcm-edge-arrow"></span><img alt="">'
    this.root.append(edge)
    const backdrop = document.createElement('button')
    backdrop.className = 'flpcm-chat-backdrop'
    backdrop.dataset.command = 'chat-close'
    backdrop.setAttribute('aria-label', t('closeChat'))
    backdrop.hidden = true
    this.root.prepend(backdrop)
    this.session.on(this.root, 'click', (e) => {
      const target = e.target.closest('[data-command]')
      if (target) this.run(() => this.command(target.dataset.command, target.dataset, target))
    })
    this.session.on(this.root, 'input', (e) => {
      if (e.target.matches('[name=intent]')) this.draft.text = e.target.value
      if (e.target.matches('[name=verb]')) this.draft.verb = e.target.value
      if (e.target.matches('[data-search-input]')) {
        this.search = e.target.value
        this.filterSearch()
      }
    })
    this.session.on(this.root, 'change', (e) => {
      if (e.target.dataset.preference)
        this.run(async () => {
          await game.settings.set(
            ID,
            e.target.dataset.preference,
            e.target.type === 'checkbox' ? e.target.checked : e.target.value === 'true'
          )
          this.applyPreferences()
        })
    })
    this.session.on(document, 'keydown', (e) => this.keydown(e))
    this.session.on(window.visualViewport, 'resize', () => this.viewport())
    this.session.on(window.visualViewport, 'scroll', () => this.viewport())
    this.session.on(window, 'online', () => this.network())
    this.session.on(window, 'offline', () => this.network())
    this.session.interval(() => {
      this.network()
      this.templateState()
      this.followToken()
      this.positionBubbles()
    }, 150)
    this.applyPreferences()
    this.bindCanvas()
    this.refresh()
    this.viewport()
    if (!setting('tutorialDone')) this.open('help')
  }
  unmount() {
    this.session.clear()
    this.gestures?.destroy()
    this.clearBubbles()
    this.objectHints?.destroy()
    this.objectHints = null
    this.cancelMove()
    this.closeChat()
    this.chatCloseButton?.remove()
    for (const [element, original] of this.nativeWindows)
      if (element.isConnected) {
        element.classList.remove('flpcm-native-window')
        element.style.cssText = original
      }
    this.nativeWindows.clear()
    this.root?.remove()
    this.root = null
    this.stack = []
    this.view = null
    document.body.classList.remove('flpcm-active', 'flpcm-low-effects', 'flpcm-reduced-motion')
  }
  destroy() {
    this.unmount()
    this.life.clear()
  }
  q(selector) {
    return this.root?.querySelector(selector)
  }
  actor() {
    return this.primary?.actor || game.user.character
  }
  choosePrimary() {
    const tokens = list(canvas?.tokens?.placeables).filter((t) => t.actor?.isOwner && !t.document.hidden)
    if (!tokens.includes(this.primary))
      this.primary =
        tokens.find((t) => t.actor.id === game.user.character?.id) ||
        tokens.find((t) => t.controlled) ||
        tokens[0] ||
        null
    if (this.primary && !this.primary.controlled) this.primary.control({ releaseOthers: true })
  }
  bindCanvas() {
    if (!this.root) return
    this.gestures?.destroy()
    const element = canvas?.app?.canvas || canvas?.app?.view
    if (!element) return
    this.gestures = new Gestures(element, {
      blocked: () =>
        !!this.view ||
        this.chatOpen ||
        [...this.nativeWindows.keys()].some(
          (el) => el.isConnected && el.getClientRects().length && !el.classList.contains('minimized')
        ),
      tap: (p) => this.run(() => this.tap(p)),
      pan: (dx, dy) => {
        const v = canvas.stage.pivot,
          s = canvas.stage.scale.x
        canvas.pan({ x: v.x - dx / s, y: v.y - dy / s })
      },
      zoom: (ratio, to, from = to) => {
        const before = canvas.canvasCoordinatesFromClient(from)
        const scale = Math.max(0.15, Math.min(3, canvas.stage.scale.x * ratio))
        canvas.pan({ scale })
        const after = canvas.canvasCoordinatesFromClient(to)
        canvas.pan({
          x: canvas.stage.pivot.x + before.x - after.x,
          y: canvas.stage.pivot.y + before.y - after.y
        })
      },
      template: (p) => {
        const template = activeTemplate()
        if (!template) return false
        moveTemplate(template, canvas.canvasCoordinatesFromClient(p))
        return true
      }
    })
  }
  viewport() {
    const v = window.visualViewport
    document.documentElement.style.setProperty('--flpcm-vh', `${v?.height || innerHeight}px`)
    document.documentElement.style.setProperty('--flpcm-vtop', `${v?.offsetTop || 0}px`)
    this.followToken()
  }
  fitNativeWindow(app, html) {
    if (!this.root || app.id === 'flpcm-gm' || app.hasFrame === false) return
    const element = html instanceof HTMLElement ? html : html?.[0] || app.element
    if (!(element instanceof HTMLElement) || !element.querySelector('.window-header')) return
    if (!this.nativeWindows.has(element)) this.nativeWindows.set(element, element.style.cssText)
    element.classList.add('flpcm-native-window')
  }
  applyPreferences() {
    document.body.classList.toggle('flpcm-low-effects', setting('lowEffects'))
    document.body.classList.toggle(
      'flpcm-reduced-motion',
      setting('reducedMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches
    )
  }
  network() {
    const connected = navigator.onLine && game.socket?.connected
    if (this.q('[data-network]')) this.q('[data-network]').hidden = !!connected
    return connected
  }
  templateState() {
    if (this.q('.flpcm-template')) this.q('.flpcm-template').hidden = !activeTemplate()
  }
  followToken() {
    const indicator = this.q('.flpcm-edge-portrait')
    if (!indicator) return
    const token = this.primary
    if (!token?.visible || this.view || this.chatOpen) {
      indicator.hidden = true
      return
    }
    const viewport = window.visualViewport,
      point = canvas.clientCoordinatesFromCanvas(token.center)
    const position = edgeIndicator(point, {
      left: 10,
      right: innerWidth - 10,
      top: (viewport?.offsetTop || 0) + 75,
      bottom: (viewport?.offsetTop || 0) + (viewport?.height || innerHeight) - 150
    })
    indicator.hidden = !position
    if (!position) return
    indicator.style.left = `${position.x}px`
    indicator.style.top = `${position.y - (viewport?.offsetTop || 0)}px`
    indicator.style.setProperty('--flpcm-direction', `${position.angle}deg`)
    indicator.querySelector('img').src = this.actor()?.img || 'icons/svg/mystery-man.svg'
  }
  async recenter() {
    if (!this.primary?.visible) return
    const point = this.primary.center
    if (setting('reducedMotion')) canvas.pan(point)
    else await canvas.animatePan({ ...point, duration: 220 })
    this.followToken()
  }
  async tap(client) {
    const point = canvas.canvasCoordinatesFromClient(client),
      template = activeTemplate()
    if (template) {
      moveTemplate(template, point)
      return
    }
    this.q('.flpcm-radial').hidden = true
    const door = canvas.controls?.doors?.children?.find(
      (d) => d.visible && d.getBounds?.().contains(client.x, client.y)
    )
    if (door) {
      await door._onMouseDown({ button: 0, stopPropagation() {}, preventDefault() {} })
      return
    }
    const token = list(canvas.tokens?.placeables)
      .reverse()
      .find((t) => t.visible && !t.document.hidden && t.bounds.contains(point.x, point.y))
    if (token) {
      if (token === this.primary) return this.radial()
      this.focus = {
        kind: 'token',
        id: token.id,
        name: token.name,
        placeable: token,
        description: token.actor?.testUserPermission(game.user, 'LIMITED')
          ? textOnly(token.actor?.system?.details?.biography?.public)
          : ''
      }
      this.renderTarget()
      return
    }
    const objects = list(canvas.tiles?.placeables)
      .reverse()
      .filter(
        (tile) =>
          tile.visible &&
          !tile.document.hidden &&
          flag(tile.document, 'interaction')?.enabled &&
          this.canSee(point) &&
          tile.bounds.contains(point.x, point.y)
      )
      .map((tile) => this.objectFocus(tile))
    if (objects.length > 1) return this.open('objects', { objects })
    if (objects.length) {
      this.focus = objects[0]
      return this.open('interact')
    }
    this.focus = null
    this.renderTarget()
    await this.planMove(point)
  }
  objectFocus(tile) {
    const config = flag(tile.document, 'interaction')
    return {
      kind: 'tile',
      id: tile.id,
      name: config.name || t('object'),
      description: config.description,
      verbs: config.verbs
        ?.split(',')
        .map((v) => v.trim())
        .filter(Boolean),
      placeable: tile
    }
  }
  canSee(point) {
    return (
      !canvas.visibility?.testVisibility ||
      canvas.visibility.testVisibility(point, { tolerance: 0, object: this.primary })
    )
  }
  refreshObjectHints() {
    this.objectHints?.destroy()
    this.objectHints = null
    if (!this.root || !canvas.ready || !this.primary) return
    const visible = list(canvas.tiles?.placeables).filter(
      (tile) =>
        tile.visible &&
        !tile.document.hidden &&
        flag(tile.document, 'interaction')?.enabled &&
        tile.center &&
        this.canSee(tile.center)
    )
    if (!visible.length) return
    const hints = new PIXI.Graphics()
    hints.eventMode = 'none'
    hints.lineStyle(2, 0xe5b95c, 0.85)
    for (const tile of visible) hints.drawCircle(tile.center.x, tile.center.y, 10)
    canvas.controls.addChild(hints)
    this.objectHints = hints
  }
  can(kind, activation) {
    return permitted({
      owner: this.primary?.document?.isOwner,
      paused: game.paused,
      combat: game.combat,
      tokenId: this.primary?.id,
      exception: flag(this.primary?.document, 'exception'),
      key: turnKey(game.combat, canvas.scene?.id),
      kind,
      activation,
      policy: setting('combatMovement')
    })
  }
  async calculate(point) {
    const token = this.primary
    if (!this.can('move')) throw new Error(t('movementDenied'))
    if (token.document.locked) throw new Error(t('movementDenied'))
    if (!token.findMovementPath) throw new Error(t('pathUnavailable'))
    const end = token.document.getSnappedPosition({ x: point.x - token.w / 2, y: point.y - token.h / 2 })
    const start = { x: token.document.x, y: token.document.y, explicit: true }
    const calculation = token.findMovementPath([start, { ...end, explicit: true }], {
      constrainOptions: { ignoreWalls: false, ignoreCost: false },
      delay: 0
    })
    const path = await (calculation.promise || calculation)
    if (!Array.isArray(path) || !path.length || Math.hypot(path.at(-1).x - end.x, path.at(-1).y - end.y) > 2)
      throw new Error(t('blocked'))
    return path
  }
  async planMove(point) {
    if (this.moving) return
    this.moving = true
    try {
      const scene = canvas.scene?.id,
        token = this.primary
      const path = await this.calculate(point)
      if (scene !== canvas.scene?.id || token !== this.primary) return
      this.cancelMove()
      if (!game.combat?.started && !setting('confirmExploration')) return await this.commitPath(path)
      this.movePlan = { point, path, scene, tokenId: token.id, key: turnKey(game.combat, scene) }
      this.drawPath(path)
      const measured = token.measureMovementPath(path)
      const cost = measured.cost ?? measured.distance
      const allowance = Number(this.actor()?.system.attributes?.movement?.walk || 0)
      this.q('.flpcm-movement').innerHTML =
        `<p>${esc(t('moveDistance', { distance: Math.round(cost * 10) / 10, units: canvas.scene.grid.units }))}</p>${cost > allowance ? `<p>${esc(t('movementWarning'))}</p>` : ''}${button('move-confirm', 'move')}${button('move-cancel', 'cancel')}`
      this.q('.flpcm-movement').hidden = false
    } finally {
      this.moving = false
    }
  }
  drawPath(path) {
    this.route = new PIXI.Graphics()
    this.route.lineStyle(4, 0xe5b95c, 0.9)
    path.forEach((p, i) =>
      this.route[i ? 'lineTo' : 'moveTo'](p.x + this.primary.w / 2, p.y + this.primary.h / 2)
    )
    canvas.controls.addChild(this.route)
  }
  cancelMove() {
    this.route?.destroy()
    this.route = null
    this.movePlan = null
    if (this.q('.flpcm-movement')) this.q('.flpcm-movement').hidden = true
  }
  async commitPath(path) {
    if (!this.network()) throw new Error(t('offline'))
    if (!this.can('move')) throw new Error(t('movementDenied'))
    const result = await this.primary.document.move(path.slice(1), {
      animate: !setting('reducedMotion'),
      pan: false,
      showRuler: false,
      constrainOptions: { ignoreWalls: false, ignoreCost: false }
    })
    if (result === false) throw new Error(t('blocked'))
  }
  async confirmMove() {
    if (this.moving || !this.movePlan) return
    this.moving = true
    try {
      const p = this.movePlan
      if (
        p.scene !== canvas.scene?.id ||
        p.tokenId !== this.primary?.id ||
        p.key !== turnKey(game.combat, canvas.scene?.id)
      )
        throw new Error(t('moveChanged'))
      const path = await this.calculate(p.point)
      await this.commitPath(path)
      this.cancelMove()
    } finally {
      this.moving = false
    }
  }
  favorites() {
    const actor = this.actor()
    return pruneFavorites(flag(game.user, 'favorites')?.[actor?.id], entries(actor))
  }
  async toggleFavorite(item, activity) {
    const key = `${item}:${activity}`,
      favorites = this.favorites(),
      all = foundry.utils.deepClone(flag(game.user, 'favorites') || {})
    if (favorites.includes(key)) favorites.splice(favorites.indexOf(key), 1)
    else {
      if (favorites.length === 3) throw new Error(t('favoritesFull'))
      favorites.push(key)
    }
    all[this.actor().id] = favorites
    await game.user.setFlag(ID, 'favorites', all)
    this.refresh()
  }
  refresh() {
    if (!this.root) return
    this.choosePrimary()
    this.refreshObjectHints()
    const saved = flag(game.user, 'favorites')?.[this.actor()?.id]
    const valid = this.favorites()
    if (Array.isArray(saved) && JSON.stringify(saved) !== JSON.stringify(valid) && !this.pruning) {
      this.pruning = true
      const all = foundry.utils.deepClone(flag(game.user, 'favorites') || {})
      all[this.actor().id] = valid
      game.user
        .setFlag(ID, 'favorites', all)
        .catch((error) => console.warn(`${ID} | favorites`, error))
        .finally(() => {
          this.pruning = false
        })
    }
    const actor = this.actor(),
      hp = actor?.system.attributes?.hp
    this.q('[data-scene]').textContent = canvas?.scene?.name || t('loading')
    this.q('[data-name]').textContent = actor?.name || t('noCharacter')
    this.q('[data-hp]').textContent = hp
      ? `${hp.value}${hp.temp ? ` +${hp.temp}` : ''}/${hp.max} ${t('hp')}`
      : t('noToken')
    this.q('[data-portrait]').src = actor?.img || 'icons/svg/mystery-man.svg'
    this.q('[data-hp-fill]').style.width =
      `${hp?.max ? Math.max(0, Math.min(100, (hp.value / hp.max) * 100)) : 0}%`
    this.renderTurn()
    this.renderTarget()
    this.q('.flpcm-favorites').innerHTML = this.favorites()
      .map((key) => {
        const e = entries(actor).find((e) => `${e.item.id}:${e.activity.id}` === key)
        return `<button data-command="use" data-item="${esc(e.item.id)}" data-activity="${esc(e.activity.id)}">${esc(e.activity.name || e.item.name)}</button>`
      })
      .join('')
    if (this.view && !['interact', 'preferences'].includes(this.view)) this.render()
  }
  renderTurn() {
    const node = this.q('[data-turn]'),
      combat = game.combat
    if (!combat?.started) {
      node.hidden = true
      return
    }
    node.hidden = false
    const mine = combat.combatant?.tokenId === this.primary?.id
    const visible = combat.combatant?.visible !== false && !combat.combatant?.hidden
    const next = combat.nextCombatant
    node.innerHTML = mine
      ? `${esc(t('yourTurn'))}${button('end-turn', 'endTurn')}`
      : esc(visible ? combat.combatant?.name || t('combat') : t('combat'))
    if (!mine && next?.tokenId === this.primary?.id) node.innerHTML += ` <small>${esc(t('upNext'))}</small>`
    const exception = flag(this.primary?.document, 'exception')
    if (exception?.key === turnKey(combat, canvas.scene?.id) && (exception.move || exception.action))
      node.innerHTML += ` <small>${esc(t('exceptionActive'))}</small>`
    node.classList.toggle('mine', mine)
  }
  renderTarget() {
    const node = this.q('[data-target]')
    if (!node) return
    const focus = this.focus
    if (!focus || focus.kind !== 'token' || !focus.placeable.visible) {
      node.hidden = true
      return
    }
    node.hidden = false
    node.innerHTML = `<span><strong>${esc(focus.name)}</strong><small>${esc(t('targets', { count: game.user.targets.size }))}</small></span>${button('target-toggle', game.user.targets.has(focus.placeable) ? 'untarget' : 'target')}${button('inspect', 'inspect')}${button('target-clear', 'clear')}`
  }
  radial() {
    this.close()
    const radial = this.q('.flpcm-radial')
    radial.innerHTML = ['actions', 'spells', 'items', 'interact', 'character']
      .map(
        (key, i) =>
          `<button class="flpcm-radial-item i${i}" data-command="${key}"><span>${esc(t(key))}</span></button>`
      )
      .join('')
    radial.hidden = false
  }
  open(view, data = {}, back = false) {
    this.gestures?.reset()
    this.cancelMove()
    this.closeChat()
    this.q('.flpcm-radial').hidden = true
    if (this.view && !back) this.stack.push({ view: this.view, data: this.viewData })
    this.view = view
    this.viewData = data
    this.search = ''
    this.render()
    this.q('.flpcm-panel').hidden = false
    this.q('.flpcm-panel').classList.toggle(
      'flpcm-bottom-sheet',
      ['more', 'interact', 'inspect', 'objects', 'switch', 'preferences', 'help'].includes(view)
    )
    this.q('[data-command=back]').hidden = !this.stack.length
    this.returnFocus = document.activeElement
    this.q('[data-command=close]').focus()
  }
  render() {
    if (!this.view || !this.root) return
    const body = this.q('.flpcm-panel-body'),
      scroll = body.scrollTop,
      active = document.activeElement
    const searchFocused = active?.matches('[data-search-input]')
    const selection = searchFocused ? active.selectionStart : null
    this.q('#flpcm-title').textContent = t(this.view)
    body.innerHTML = renderView(this, this.view, this.viewData)
    body.scrollTop = scroll
    this.filterSearch()
    if (searchFocused) {
      const input = this.q('[data-search-input]')
      input?.focus()
      try {
        input?.setSelectionRange(selection, selection)
      } catch {}
    }
  }
  filterSearch() {
    for (const row of this.root.querySelectorAll('[data-search]'))
      row.hidden = !row.dataset.search.includes((this.search || '').toLowerCase())
  }
  close() {
    this.view = null
    this.stack = []
    if (this.q('.flpcm-panel')) this.q('.flpcm-panel').hidden = true
    this.returnFocus?.isConnected && this.returnFocus.focus()
    this.gestures?.reset()
  }
  back() {
    const previous = this.stack.pop()
    if (previous) this.open(previous.view, previous.data, true)
    else this.close()
  }
  keydown(e) {
    if (!this.root) return
    if (e.key === 'Escape') {
      if (activeTemplate()) this.run(() => templateCommand('template-cancel'))
      else if (this.chatOpen) this.closeChat()
      else this.close()
      this.cancelMove()
      this.q('.flpcm-radial').hidden = true
    }
    if (e.key === 'Tab' && this.view) {
      const elements = [
        ...this.q('.flpcm-panel').querySelectorAll('button:not([hidden]),input,textarea,select,a[href]')
      ].filter((el) => !el.disabled && el.getClientRects().length)
      const first = elements[0],
        last = elements.at(-1)
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last?.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first?.focus()
      }
    }
  }
  openChat() {
    if (this.chatOpen) return this.closeChat()
    this.close()
    this.q('.flpcm-radial').hidden = true
    this.chatOpen = true
    this.gestures?.reset()
    this.q('.flpcm-chat-backdrop').hidden = false
    document.body.classList.add('flpcm-native-chat')
    ui.sidebar?.changeTab('chat', 'primary', { force: true })
    this.unread = 0
    this.updateUnread()
    requestAnimationFrame(() => {
      const log = document.querySelector('#chat .chat-scroll,#chat .chat-log,#chat-log')
      if (log) log.scrollTop = this.chatScroll ?? log.scrollHeight
    })
  }
  closeChat() {
    if (this.chatOpen) {
      this.chatScroll = document.querySelector('#chat .chat-scroll,#chat .chat-log,#chat-log')?.scrollTop
    }
    this.chatOpen = false
    if (this.q('.flpcm-chat-backdrop')) this.q('.flpcm-chat-backdrop').hidden = true
    document.body.classList.remove('flpcm-native-chat')
  }
  updateUnread() {
    const node = this.q('[data-unread]')
    if (node) {
      node.textContent = String(this.unread)
      node.hidden = !this.unread
    }
  }
  receiveChat(message) {
    if (!this.root || !message.visible) return
    if (!this.chatOpen && message.author?.id !== game.user.id && message.isContentVisible !== false) {
      this.unread++
      this.updateUnread()
    }
    const f = flag(message, 'kind')
    if (
      f === 'request-event' &&
      message.author?.isGM &&
      this.requests.get(flag(message, 'requestId'))?.playerId === game.user.id
    )
      this.prompts.show(message.id, t('requestUpdated'), flag(message, 'text') || t('rollRequested'), () =>
        this.open('requests')
      )
    if (
      message.whisper?.length ||
      message.blind ||
      message.rolls?.length ||
      message.speaker?.scene !== canvas.scene?.id ||
      message.style !== CONST.CHAT_MESSAGE_STYLES.OTHER ||
      message.flags?.dnd5e ||
      f === 'intent' ||
      f?.startsWith('request-') ||
      /<(?:section|article|button|table|form|div)\b/i.test(message.content || '')
    )
      return
    const token = canvas.tokens.get(message.speaker?.token)
    if (token?.visible && !token.document.hidden) this.bubble(token, textOnly(message.content))
  }
  bubble(token, text) {
    this.bubbles.get(token.id)?.element.remove()
    clearTimeout(this.bubbles.get(token.id)?.timer)
    const element = document.createElement('div')
    element.className = 'flpcm-bubble'
    element.textContent = text.slice(0, 180)
    this.q('.flpcm-bubbles').append(element)
    const timer = setTimeout(() => {
      element.remove()
      this.bubbles.delete(token.id)
    }, 5500)
    this.bubbles.set(token.id, { element, timer })
    this.positionBubbles()
  }
  positionBubbles() {
    for (const [id, b] of this.bubbles) {
      const token = canvas.tokens?.get(id)
      if (!token?.visible) {
        b.element.hidden = true
        continue
      }
      const p = canvas.clientCoordinatesFromCanvas(token.center)
      b.element.style.left = `${Math.max(70, Math.min(innerWidth - 70, p.x))}px`
      b.element.style.top = `${p.y - (token.h * canvas.stage.scale.y) / 2 - 18}px`
    }
  }
  clearBubbles() {
    for (const b of this.bubbles.values()) {
      clearTimeout(b.timer)
      b.element.remove()
    }
    this.bubbles.clear()
  }
  toast(message) {
    if (!this.root) return ui.notifications.info(message)
    const element = document.createElement('div')
    element.className = 'flpcm-toast'
    element.textContent = message
    this.q('.flpcm-toasts').append(element)
    setTimeout(() => element.remove(), 5000)
  }
  async run(fn) {
    try {
      await fn()
    } catch (error) {
      console.warn(`${ID} |`, error)
      this.toast(error?.message || t('failed'))
    }
  }
  async command(command, data = {}, element) {
    if (
      [
        'more',
        'character',
        'actions',
        'spells',
        'items',
        'interact',
        'inspect',
        'journals',
        'requests',
        'switch',
        'preferences',
        'help'
      ].includes(command)
    )
      return this.open(command)
    if (command.startsWith('template-')) return templateCommand(command)
    if (command === 'close') return this.close()
    if (command === 'back') return this.back()
    if (command === 'radial') return this.radial()
    if (command === 'recenter') {
      return this.recenter()
    }
    if (command === 'move-confirm') return this.confirmMove()
    if (command === 'move-cancel') return this.cancelMove()
    if (command === 'target-toggle') {
      const token = this.focus?.placeable
      if (token?.visible)
        token.setTarget(!game.user.targets.has(token), { user: game.user, releaseOthers: false })
      return this.renderTarget()
    }
    if (command === 'target-clear') {
      for (const token of [...game.user.targets]) token.setTarget(false, { user: game.user })
      this.focus = null
      return this.renderTarget()
    }
    if (command === 'favorite') return this.toggleFavorite(data.item, data.activity)
    if (command === 'use') {
      if (this.using) return
      const item = this.actor()?.items.get(data.item),
        activity = activities(item).find((a) => a.id === data.activity)
      if (!activity?.use || !this.can('action', activity.activation?.type || 'action'))
        throw new Error(t('actionDenied'))
      if (!this.network()) throw new Error(t('offline'))
      this.using = true
      this.close()
      try {
        await activity.use()
      } finally {
        this.using = false
      }
      return
    }
    if (command === 'roll') {
      if (this.rolling) return
      this.rolling = true
      try {
        return await roll(this.actor(), data.kind, data.key)
      } finally {
        this.rolling = false
      }
    }
    if (command === 'end-turn') {
      if (this.ending) return
      this.ending = true
      try {
        if (
          await foundry.applications.api.DialogV2.confirm({
            window: { title: t('endTurn') },
            content: `<p>${esc(t('endTurnConfirm'))}</p>`
          })
        ) {
          if (game.combat?.combatant?.tokenId !== this.primary?.id) throw new Error(t('moveChanged'))
          await game.combat.nextTurn()
        }
      } finally {
        this.ending = false
      }
      return
    }
    if (command === 'chat') return this.openChat()
    if (command === 'chat-close') return this.closeChat()
    if (command === 'send-intent') {
      if (this.sending) return
      this.sending = true
      element.disabled = true
      try {
        await this.requests.submit(
          this.actor(),
          this.primary,
          this.focus,
          this.draft.text || '',
          this.draft.verb
        )
        this.draft = {}
        this.open('requests')
        this.toast(t('sent'))
      } finally {
        this.sending = false
        if (element.isConnected) element.disabled = false
      }
      return
    }
    if (command === 'request-roll') {
      element.disabled = true
      try {
        await this.requests.roll(data.id, data.prompt, roll)
      } finally {
        if (element.isConnected) element.disabled = false
        this.render()
      }
      return
    }
    if (command === 'choose-token') {
      const token = canvas.tokens.get(data.id)
      if (!token?.actor?.isOwner) throw new Error(t('unavailable'))
      this.primary = token

      this.close()
      this.refresh()
      return
    }
    if (command === 'object') {
      const tile = canvas.tiles.get(data.id)
      if (!tile?.visible || !flag(tile.document, 'interaction')?.enabled) throw new Error(t('unavailable'))
      this.focus = this.objectFocus(tile)
      return this.open('interact')
    }
    if (command === 'item' || command === 'journal') return this.open(command, { id: data.id })
    if (command === 'sheet') {
      this.close()
      return this.actor()?.sheet.render(true)
    }
    if (command === 'item-native') {
      this.close()
      return this.actor()?.items.get(data.id)?.sheet.render(true)
    }
    if (command === 'journal-native') {
      const journal = game.journal.get(data.id)
      if (journal?.visible) {
        this.close()
        return journal.sheet.render(true)
      }
    }
    if (command === 'native') {
      await game.settings.set(ID, 'nativeUI', true)
      return this.evaluate()
    }
    if (command === 'help-done') {
      await game.settings.set(ID, 'tutorialDone', true)
      return this.close()
    }
  }
}
