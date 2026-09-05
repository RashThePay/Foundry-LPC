import { ID, esc, t, flag, button, choices } from './core.mjs'
import { LPC_DEFAULTS, validateSheet } from './lpc-animator.mjs'

export function spriteForm() {
  return `<fieldset class="flpcm-sprite-form"><legend>${esc(t('spriteSetup'))}</legend><p>${esc(t('spriteHelp'))}</p><label>${esc(t('preset'))}<select name="sprite-preset">${choices(
    [
      ['universal', t('universal')],
      ['compact', t('compactSprite')]
    ]
  )}</select></label><label>${esc(t('spritesheet'))}<file-picker name="sprite-src" type="image"></file-picker></label><label>${esc(t('fps'))}<input name="sprite-fps" type="number" min="1" max="30" value="9"></label><div class="flpcm-toolbar"><label>${esc(t('state'))}<select name="sprite-state">${choices(
    Object.keys(LPC_DEFAULTS.states).map((k) => [k, t(k)]),
    'walk'
  )}</select></label><label>${esc(t('direction'))}<select name="sprite-direction">${choices(
    ['up', 'left', 'down', 'right'].map((k) => [k, t(k)]),
    'down'
  )}</select></label></div><canvas class="flpcm-sprite-preview" width="192" height="192" aria-label="${esc(t('spritePreview'))}"></canvas><p data-sprite-feedback role="status"></p><div class="flpcm-toolbar">${button('sprite-preview', 'preview')}${button('sprite-tokens', 'applyTokens')}${button('sprite-actors', 'saveActorDefaults')}${button('sprite-clear', 'clearOverrides')}${button('sprite-disable', 'disableAnimation')}</div></fieldset>`
}
const previews = new WeakMap()
export async function handleSpriteCommand(command, root, animator) {
  const tokens = canvas.tokens.controlled,
    field = (name) => root.querySelector(`[name="sprite-${name}"]`)?.value
  if (command === 'sprite-clear' || command === 'sprite-disable') {
    if (!tokens.length) throw new Error(t('selectTokens'))
    for (const token of tokens)
      command === 'sprite-clear'
        ? await token.document.unsetFlag(ID, 'lpc')
        : await token.document.setFlag(ID, 'lpc', { enabled: false })
    return
  }
  const src = field('src'),
    fps = Number(field('fps'))
  if (!src || !Number.isFinite(fps) || fps < 1 || fps > 30) throw new Error(t('invalidSprite'))
  const compact = field('preset') === 'compact',
    config = {
      ...structuredClone(LPC_DEFAULTS),
      src,
      fps,
      enabled: true,
      ...(compact ? { frameWidth: 32, frameHeight: 32 } : {})
    }
  const image = new Image()
  image.src = src
  await image.decode()
  validateSheet(image.naturalWidth, image.naturalHeight, config)
  if (command === 'sprite-preview') {
    const canvasElement = root.querySelector('.flpcm-sprite-preview'),
      context = canvasElement.getContext('2d')
    clearInterval(previews.get(canvasElement))
    let frame = 0
    const state = config.states[field('state')],
      direction = config.directions[field('direction')]
    const draw = () => {
      if (!canvasElement.isConnected) {
        clearInterval(previews.get(canvasElement))
        return
      }
      context.clearRect(0, 0, 192, 192)
      context.imageSmoothingEnabled = false
      context.drawImage(
        image,
        ((state.frame || 0) + frame) * config.frameWidth,
        (state.row + (state.directional === false ? 0 : direction)) * config.frameHeight,
        config.frameWidth,
        config.frameHeight,
        0,
        0,
        192,
        192
      )
      frame = (frame + 1) % state.frames
    }
    draw()
    previews.set(canvasElement, setInterval(draw, 1000 / fps))
    root.querySelector('[data-sprite-feedback]').textContent = t('spriteValid', {
      width: image.naturalWidth,
      height: image.naturalHeight
    })
    return
  }
  if (!tokens.length) throw new Error(t('selectTokens'))
  const documents =
    command === 'sprite-actors'
      ? [...new Map(tokens.filter((t) => t.actor).map((t) => [t.actor.uuid, t.actor])).values()]
      : tokens.map((t) => t.document)
  for (const document of documents) await document.setFlag(ID, 'lpc', config)
  ui.notifications.info(t('spriteApplied', { count: documents.length }))
}
export function installConfigFields() {
  Hooks.on('renderTileConfig', (app, html) => {
    if (!game.user.isGM) return
    const root = html instanceof HTMLElement ? html : html?.[0]
    if (!root || root.querySelector('[data-flpcm-interaction]')) return
    const config = flag(app.document, 'interaction') || {}
    const group = document.createElement('fieldset')
    group.dataset.flpcmInteraction = ''
    group.innerHTML = `<legend>${esc(t('interaction'))}</legend><label><input type="checkbox" name="flags.${ID}.interaction.enabled" ${config.enabled ? 'checked' : ''}>${esc(t('interactive'))}</label><label>${esc(t('publicName'))}<input name="flags.${ID}.interaction.name" value="${esc(config.name || '')}"></label><label>${esc(t('publicDescription'))}<textarea name="flags.${ID}.interaction.description">${esc(config.description || '')}</textarea></label><label>${esc(t('verbs'))}<input name="flags.${ID}.interaction.verbs" value="${esc(config.verbs || 'inspect,open,use,take,push,listen')}"></label><p>${esc(t('verbsHelp'))}</p>`
    ;(root.querySelector('form') || root).append(group)
  })
  Hooks.on('renderTokenConfig', (app, html) => {
    if (!game.user.isGM) return
    const root = html instanceof HTMLElement ? html : html?.[0]
    if (!root || root.querySelector('[data-flpcm-lpc]')) return
    const current = flag(app.document, 'lpc') || {},
      actor = flag(app.document.actor, 'lpc')
    const group = document.createElement('fieldset')
    group.dataset.flpcmLpc = ''
    group.innerHTML = `<legend>${esc(t('spriteSetup'))}</legend><p>${esc(t(current.src || current.enabled === false ? 'tokenOverride' : actor?.src ? 'actorDefault' : 'normalArtwork'))}</p><label>${esc(t('spritesheet'))}<file-picker name="flags.${ID}.lpc.src" type="image" value="${esc(current.src || '')}"></file-picker></label><label>${esc(t('fps'))}<input name="flags.${ID}.lpc.fps" type="number" min="1" max="30" value="${esc(current.fps || 9)}"></label><label><input name="flags.${ID}.lpc.enabled" type="checkbox" ${current.enabled !== false ? 'checked' : ''}>${esc(t('enableAnimation'))}</label><p>${esc(t('bulkHint'))}</p>`
    ;(root.querySelector('form') || root).append(group)
  })
}
