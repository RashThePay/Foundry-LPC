import { ID, remaining, list, t } from './core.mjs'
export function activities(item) {
  return (
    item?.system?.activities?.contents || Object.values(item?.system?.activities || {}).filter((a) => a?.id)
  )
}
export function entries(actor) {
  return list(actor?.items).flatMap((item) => activities(item).map((activity) => ({ item, activity })))
}
export function category(item) {
  return item.type === 'spell'
    ? 'spells'
    : ['equipment', 'consumable', 'loot', 'tool', 'container'].includes(item.type)
      ? 'items'
      : 'actions'
}
export function actionDetails(item, activity) {
  const uses = remaining(activity.uses) || remaining(item.system?.uses)
  const range = activity.range || item.system?.range || {}
  return [
    game.i18n.localize(
      CONFIG.DND5E.activityActivationTypes?.[activity.activation?.type]?.label ||
        activity.activation?.type ||
        ''
    ),
    range.value ? `${range.value} ${range.units || ''}` : '',
    item.type === 'spell' ? t('spellLevel', { level: item.system.level || 0 }) : '',
    uses ? `${uses.value}/${uses.max}` : ''
  ]
    .filter(Boolean)
    .join(' · ')
}
export async function roll(actor, kind, key, request) {
  if (!actor?.isOwner) throw new Error(t('noCharacter'))
  const methods = {
    skill: 'rollSkill',
    check: 'rollAbilityCheck',
    save: 'rollSavingThrow',
    death: 'rollDeathSave',
    initiative: 'rollInitiativeDialog'
  }
  const method = methods[kind]
  if (!method || typeof actor[method] !== 'function') throw new Error(t('unavailable'))
  const config = kind === 'skill' ? { skill: key } : ['check', 'save'].includes(kind) ? { ability: key } : {}
  const message = request
    ? {
        data: {
          whisper: request.recipients,
          flags: { [ID]: { v: 1, kind: 'request-roll', requestId: request.id, promptId: request.promptId } }
        }
      }
    : {}
  return actor[method](config, {}, message)
}
export function rollOptions(kind) {
  const source = kind === 'skill' ? CONFIG.DND5E.skills : CONFIG.DND5E.abilities
  return Object.entries(source).map(([key, value]) => [key, game.i18n.localize(value.label || value)])
}
export function activeTemplate() {
  return canvas?.templates?.preview?.children?.find((p) => typeof p._onConfirmPlacement === 'function')
}
export function moveTemplate(template, point) {
  template._onMovePlacement({ stopPropagation() {}, data: { getLocalPosition: () => point } })
}
export async function templateCommand(command) {
  const template = activeTemplate()
  if (!template) return
  const event = { stopPropagation() {}, preventDefault() {} }
  if (command === 'template-confirm') return template._onConfirmPlacement(event)
  if (command === 'template-cancel') return template._onCancelPlacement(event)
  template._onRotatePlacement({ ...event, deltaY: command === 'template-left' ? -1 : 1, shiftKey: true })
}
