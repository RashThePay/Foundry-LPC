import { ID, t, setting, flag, Lifetime, esc } from './core.mjs'
import { LPCAnimator } from './lpc-animator.mjs'
import { PlayerShell } from './player-shell.mjs'
import { RequestService } from './requests.mjs'
import { GMWorkspace, installPreparation } from './gm-workspace.mjs'

let shell, animator, workspace
const lifetime = new Lifetime()
function settings() {
  const definitions = {
    enabled: { scope: 'world', type: Boolean, default: true },
    desktopPreview: { scope: 'client', type: Boolean, default: false },
    maxWidth: { scope: 'world', type: Number, default: 1100, range: { min: 600, max: 1600, step: 50 } },
    nativeUI: { scope: 'client', type: Boolean, default: false },
    confirmExploration: { scope: 'world', type: Boolean, default: false },
    combatMovement: {
      scope: 'world',
      type: String,
      default: 'turn',
      choices: { turn: 'FLPCM.UI.turnOnly', free: 'FLPCM.UI.freeMovement' }
    },
    spriteEffects: { scope: 'world', type: Boolean, default: true },
    lowEffects: { scope: 'client', type: Boolean, default: false },
    reducedMotion: { scope: 'client', type: Boolean, default: false },
    tutorialDone: { scope: 'client', type: Boolean, default: false, config: false },
    gmPlacement: { scope: 'client', type: Object, default: {}, config: false }
  }
  for (const [key, definition] of Object.entries(definitions))
    game.settings.register(ID, key, {
      name: `FLPCM.Settings.${key}`,
      hint: `FLPCM.Settings.${key}Hint`,
      config: true,
      ...definition,
      onChange: () => {
        shell?.evaluate()
        shell?.applyPreferences()
        if (['spriteEffects', 'reducedMotion', 'lowEffects'].includes(key)) animator?.refreshAll()
      }
    })
}
function compact() {
  try {
    return (
      !game.user?.isGM &&
      setting('enabled') &&
      !setting('nativeUI') &&
      (setting('desktopPreview') || innerWidth <= setting('maxWidth'))
    )
  } catch {
    return false
  }
}
function isResolution(message) {
  return /^(ERROR\.RESOLUTION\.)|requires (?:a usable window dimensions|usable window dimensions|a screen resolution)/.test(
    String(message || '')
  )
}
function suppressResolution() {
  const prototype = foundry.applications.ui.Notifications?.prototype
  if (!prototype || prototype.notify._flpcmWrapped) return
  const original = prototype.notify
  function wrapped(message, type, ...rest) {
    if (type === 'error' && compact() && isResolution(message)) return null
    return original.call(this, message, type, ...rest)
  }
  wrapped._flpcmWrapped = true
  prototype.notify = wrapped
}
async function presence() {
  if (game.user.isGM || !game.socket?.connected) return
  try {
    await game.user.setFlag(ID, 'presence', {
      at: Date.now(),
      shell: !!shell?.root,
      sceneId: canvas.scene?.id || null
    })
  } catch (error) {
    console.debug(`${ID} | presence`, error)
  }
}
Hooks.once('init', () => {
  settings()
  suppressResolution()
  installPreparation()
})
Hooks.once('setup', suppressResolution)
Hooks.once('ready', () => {
  animator = new LPCAnimator()
  animator.install()
  const requests = new RequestService()
  shell = new PlayerShell(animator, requests)
  shell.install()
  if (game.user.isGM) {
    workspace = new GMWorkspace(requests, animator)
    workspace.install()
  }
  lifetime.interval(presence, 30000)
  void presence()
  lifetime.hook('createChatMessage', async (message) => {
    if (!message.visible || !message.author?.isGM || flag(message, 'kind') !== 'recenter' || game.user.isGM)
      return
    const token = game.scenes.get(flag(message, 'sceneId'))?.tokens.get(flag(message, 'tokenId'))
    if (!token?.isOwner) return
    const accepted = await foundry.applications.api.DialogV2.confirm({
      window: { title: t('recenter') },
      content: `<p>${esc(t('recenterInvitation'))}</p>`
    })
    if (accepted && canvas.scene?.id === token.parent.id) {
      shell.primary = token.object
      shell.follow = true
      shell.lastFollow = null
      shell.followToken()
    }
  })
  game.modules.get(ID).api = {
    animator,
    shell,
    playAnimation: (token, state, options) => animator.play(token, state, options)
  }
})
