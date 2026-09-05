import { ID, esc, t, list, remaining, button, choices, textOnly, flag } from './core.mjs'
import { entries, category, actionDetails, rollOptions } from './dnd5e-adapter.mjs'
const card = (label, body = '') =>
  `<article class="flpcm-card"><strong>${esc(label)}</strong>${body}</article>`
const actionButton = (command, label, attrs = '') => button(command, label, attrs)
export function renderView(shell, view, data = {}) {
  const actor = shell.actor(),
    system = actor?.system || {}
  if (view === 'more')
    return ['character', 'items', 'journals', 'requests', 'switch', 'preferences', 'sheet', 'native', 'help']
      .map((key) => actionButton(key, key))
      .join('')
  if (view === 'help') return `<p>${esc(t('helpText'))}</p>${button('help-done', 'gotIt')}`
  if (view === 'preferences')
    return `<label>${esc(t('effects'))}<select data-preference="lowEffects">${choices(
      [
        ['false', t('fullEffects')],
        ['true', t('lowEffects')]
      ],
      String(game.settings.get(ID, 'lowEffects'))
    )}</select></label><label><input type="checkbox" data-preference="reducedMotion" ${game.settings.get(ID, 'reducedMotion') ? 'checked' : ''}>${esc(t('reducedMotion'))}</label>`
  if (view === 'switch')
    return (
      list(canvas.tokens?.placeables)
        .filter((token) => token.actor?.isOwner && !token.document.hidden)
        .map(
          (token) =>
            `<button data-command="choose-token" data-id="${esc(token.id)}">${esc(token.name)}</button>`
        )
        .join('') || `<p>${esc(t('noToken'))}</p>`
    )
  if (view === 'journals')
    return (
      list(game.journal)
        .filter((j) => j.visible)
        .map((j) => `<button data-command="journal" data-id="${esc(j.id)}">${esc(j.name)}</button>`)
        .join('') || `<p>${esc(t('empty'))}</p>`
    )
  if (view === 'journal') {
    const journal = game.journal.get(data.id)
    if (!journal?.visible) return esc(t('unavailable'))
    return (
      list(journal.pages)
        .filter((p) => p.testUserPermission(game.user, 'OBSERVER'))
        .map((p) =>
          card(
            p.name,
            `<p>${esc(textOnly(p.text?.content))}</p>${p.type === 'image' ? `<img class="flpcm-handout" src="${esc(p.src)}" alt="${esc(p.name)}">` : ''}`
          )
        )
        .join('') +
      `<button data-command="journal-native" data-id="${esc(journal.id)}">${esc(t('openOriginal'))}</button>`
    )
  }
  if (view === 'requests')
    return (
      shell.requests
        .all()
        .map((request) => renderRequest(request))
        .join('') || `<p>${esc(t('noRequests'))}</p>`
    )
  if (view === 'objects')
    return data.objects
      .map((f) => `<button data-command="object" data-id="${esc(f.id)}">${esc(f.name)}</button>`)
      .join('')
  if (view === 'inspect') {
    const focus = shell.focus
    return card(
      focus?.name || t('scene'),
      `<p>${esc(focus?.description || t('nothingMore'))}</p>${button('interact', 'interact')}`
    )
  }
  if (view === 'interact') {
    const draft = shell.draft || {}
    const verbs = shell.focus?.verbs || ['inspect', 'open', 'use', 'take', 'push', 'listen']
    return `${shell.focus?.description?`<p>${esc(shell.focus.description)}</p>`:''}<p>${esc(t('intentHelp', { target: shell.focus?.name || t('scene') }))}</p><label>${esc(t('verb'))}<select name="verb">${choices([['', t('custom')], ...verbs.map((v) => [v, t(v)])], draft.verb)}</select></label><label>${esc(t('description'))}<textarea name="intent" maxlength="800" rows="5" placeholder="${esc(t('intentPlaceholder'))}">${esc(draft.text || '')}</textarea></label>${button('send-intent', 'sendIntent')}`
  }
  if (!actor) return `<p>${esc(t('noCharacter'))}</p>`
  if (view === 'character') {
    const hp = system.attributes?.hp || {},
      abilities = system.abilities || {},
      slots = Object.entries(system.spells || {}).filter(([, s]) => s.max || s.value)
    const resources = entries(actor)
      .map(({ item, activity }) => ({
        name: activity.name || item.name,
        uses: remaining(activity.uses) || remaining(item.system.uses)
      }))
      .filter((r) => r.uses)
    const effects = list(actor.effects).filter((e) => !e.disabled)
    return `<div class="flpcm-stats">${[
      ['hp', `${hp.value ?? 0}${hp.temp ? ` +${hp.temp}` : ''}/${hp.max ?? 0}`],
      ['armor', system.attributes?.ac?.value],
      ['speed', system.attributes?.movement?.walk]
    ]
      .map(([k, v]) => `<div><small>${esc(t(k))}</small><strong>${esc(v ?? '—')}</strong></div>`)
      .join(
        ''
      )}</div><div class="flpcm-toolbar">${button('roll', 'initiative', 'data-kind="initiative"')}${Number(hp.value) <= 0 ? button('roll', 'deathSave', 'data-kind="death"') : ''}${button('sheet', 'sheet')}</div><h3>${esc(t('checks'))}</h3><div class="flpcm-grid">${rollOptions(
      'check'
    )
      .map(
        ([k, label]) =>
          `<button data-command="roll" data-kind="check" data-key="${k}">${esc(label)} ${Number(abilities[k]?.mod) >= 0 ? '+' : ''}${esc(abilities[k]?.mod ?? 0)}</button>`
      )
      .join('')}</div><h3>${esc(t('skills'))}</h3><div class="flpcm-grid">${rollOptions('skill')
      .map(
        ([k, label]) =>
          `<button data-command="roll" data-kind="skill" data-key="${k}">${esc(label)} ${esc(system.skills?.[k]?.total ?? '')}</button>`
      )
      .join('')}</div><h3>${esc(t('saves'))}</h3><div class="flpcm-grid">${rollOptions('save')
      .map(
        ([k, label]) => `<button data-command="roll" data-kind="save" data-key="${k}">${esc(label)}</button>`
      )
      .join(
        ''
      )}</div><h3>${esc(t('resources'))}</h3>${slots.map(([key, s]) => card(key, `<p>${esc(s.value)}/${esc(s.max)}</p>`)).join('')}${resources.map((r) => card(r.name, `<p>${r.uses.value}/${r.uses.max}</p>`)).join('')}<h3>${esc(t('conditions'))}</h3>${effects.map((e) => card(e.name)).join('') || `<p>${esc(t('none'))}</p>`}`
  }
  if (['actions', 'spells', 'items'].includes(view)) {
    const favorites = shell.favorites()
    const all = entries(actor).filter((e) => category(e.item) === view)
    all.sort(
      (a, b) =>
        Number(favorites.includes(`${b.item.id}:${b.activity.id}`)) -
          Number(favorites.includes(`${a.item.id}:${a.activity.id}`)) ||
        a.item.name.localeCompare(b.item.name)
    )
    let html = all
      .map(
        ({ item, activity }) =>
          `<article class="flpcm-action-row" data-search="${esc(`${item.name} ${activity.name}`.toLowerCase())}"><button class="flpcm-action-card" data-command="use" data-item="${esc(item.id)}" data-activity="${esc(activity.id)}"><img src="${esc(activity.img || item.img)}" alt=""><span><strong>${esc(activity.name || item.name)}</strong><small>${esc(item.name)} · ${esc(actionDetails(item, activity))}</small></span></button><button data-command="favorite" data-item="${esc(item.id)}" data-activity="${esc(activity.id)}" aria-label="${esc(t('favorite'))}" aria-pressed="${favorites.includes(`${item.id}:${activity.id}`)}">${favorites.includes(`${item.id}:${activity.id}`) ? '★' : '☆'}</button></article>`
      )
      .join('')
    if (view === 'items')
      html = list(actor.items)
        .map(
          (item) =>
            `<article class="flpcm-card" data-search="${esc(item.name.toLowerCase())}"><button data-command="item" data-id="${esc(item.id)}">${esc(item.name)} <small>×${esc(item.system.quantity ?? 1)}</small></button></article>`
        )
        .join('')
    return `<label class="flpcm-search">${esc(t('search'))}<input type="search" data-search-input value="${esc(shell.search || '')}"></label>${html || `<p>${esc(t('empty'))}</p>`}`
  }
  if (view === 'item') {
    const item = actor.items.get(data.id)
    if (!item) return esc(t('unavailable'))
    return (
      card(item.name, `<p>${esc(textOnly(item.system.description?.value))}</p>`) +
      entries(actor)
        .filter((e) => e.item.id === item.id)
        .map(
          ({ activity }) =>
            `<div class="flpcm-toolbar"><button data-command="use" data-item="${esc(item.id)}" data-activity="${esc(activity.id)}">${esc(activity.name)} · ${esc(actionDetails(item, activity))}</button><button data-command="favorite" data-item="${esc(item.id)}" data-activity="${esc(activity.id)}" aria-label="${esc(t('favorite'))}">★</button></div>`
        )
        .join('') +
      `<button data-command="item-native" data-id="${esc(item.id)}">${esc(t('openOriginal'))}</button>`
    )
  }
  return ''
}
export function renderRequest(request) {
  return `<article class="flpcm-card"><header><strong>${esc(request.targetName)}</strong><span class="flpcm-chip">${esc(t(request.status))}</span></header><p>${esc(request.text)}</p>${request.events
    .filter((e) => e.text)
    .map((e) => `<p>${esc(e.text)}</p>`)
    .join(
      ''
    )}${request.rolls.map((r) => `<p>${esc(r.total === null ? t('hiddenRoll') : t('rollResult', { total: r.total }))}</p>`).join('')}${
    !['resolved', 'dismissed'].includes(request.status)
      ? request.prompts
          .filter((p) => !p.done)
          .map(
            (p) =>
              `<button class="primary" data-command="request-roll" data-id="${esc(request.id)}" data-prompt="${esc(p.id)}">${esc(t('rollRequested'))}: ${esc(p.key)}</button>`
          )
          .join('')
      : ''
  }</article>`
}
