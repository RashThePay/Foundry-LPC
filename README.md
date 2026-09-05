# Foundry LPC Mobile

A portrait-first player interface and desktop DM workspace for Foundry VTT **14.367** and dnd5e **5.3.3**. Version 0.2.0 keeps the native system in charge of rolls, targeting, consumption, and permissions.

## Setup

Place this repository at `Data/modules/foundry-lpc-mobile`, or use a directory junction. Enable the module in a dnd5e world, assign characters and ownership to players, and place their tokens in the scene. Reload both DM and player browsers after updating the module.

The player interface activates below 1100 CSS pixels. **Preview on desktop** enables it at any width for a player login. **Use native Foundry interface** restores the desktop interface; turn that setting off to re-enable mobile mode. The UI also installs/uninstalls when the configured screen-width boundary changes.

No other mobile module is required. Avoid enabling competing canvas gesture/UI replacement modules during validation. Only the desktop minimum-resolution notification is suppressed in mobile mode; other errors remain visible.

## Player controls

- Tap empty ground to move. Drag the map to pan; pinch to zoom. Multi-touch and canceled gestures never become movement taps, and mobile canvas gestures suppress Foundry's selection rectangle.
- The camera stays stationary during movement. If your character leaves the usable map viewport, a circular portrait appears at the edge, pointing toward them. Tap it to recenter.
- In combat, preview the route and distance, then **Move** or **Cancel**. Movement is turn-only by default; the DM can grant an exception. Decorative tiles do not intercept movement.
- Tap your character or **Act** for Actions, Spells, Inventory, Interact, and Character. Search actions and pin up to three favorites per character with the star control.
- Tap another token to inspect it. **Target** toggles targeting without clearing existing targets; **Clear** removes them all. Inspection does not target automatically.
- Skills, ability checks, saves, initiative, and death saves use native dnd5e roll dialogs. Reactions remain available off-turn; regular actions and bonus actions are turn-gated unless the DM grants an exception.
- Spell templates use dedicated Place, Cancel, and rotation controls. Drag a finger to position the template; pinch still zooms.
- **Chat** opens a bounded native chat panel. Tap Chat again, Close chat, or the exposed map to dismiss it. Native chat cards remain interactive and use the full panel width. Unread counts include visible rolls and exclude your own messages.
- **More** provides inventory, accessible handouts, request history, character switching, preferences, and native-sheet fallback. Native windows are constrained so their header and close controls stay on-screen.
- Low-effects and reduced-motion preferences reduce rendering work. Controls respect safe areas and the software keyboard viewport.

Public speech may appear above visible scene tokens. Private or blind messages never become public speech bubbles.

## DM workspace

Open **LPC Requests** from the sidebar tab rail. The launcher no longer occupies the bottom-left Foundry information area. The workspace can dock at the right or float; its placement is saved when closed.

**Requests:** Filter by player/status; locate the target, reply privately, request a skill/check/save, resolve, dismiss, or reopen. A public reply requires the explicit public checkbox. Optional DCs are stored separately in GM-only chat documents. Players receive incoming response/roll prompts; the DM receives prompts for new requests and returned rolls. Prompts queue rather than covering one another.

The request flow is **Pending → Waiting for roll → Pending → Resolved/Dismissed**. A canceled roll stays waiting; only the DM resolves the outcome. State reconstructs from chat documents after reload, and legacy interaction cards remain readable without rewriting them. Deleting those chat documents deletes that history.

**Players:** Check connectivity, ownership, character assignment, scene tokens, and mobile-client readiness. Client reports older than 75 seconds are marked unknown. Use native configuration shortcuts to fix setup, locate a token, suggest recentering, or grant/revoke off-turn movement and action exceptions. Exceptions expire on a turn or scene change.

**Scene setup:** Configure selected tiles and bulk sprite settings. Tile configuration includes an explicit interaction toggle, a public name/description, and comma-separated verbs. Tiles are non-interactive by default. Visible interactive objects receive a small gold map marker. Interactions describe attempts; they do not automatically transfer items or change doors/world state.

## LPC animation

The animator changes frames on the **native token mesh**, preserving Foundry visibility, lighting, alpha, and drag previews. Each rendered token—including a drag preview—has its own animation entry. Actual rendered displacement selects walking; stationary tokens settle to idle. Confirmed activities select cast/attack animations, and those animations return to movement/idle when complete.

Use **Scene setup → LPC sprite setup** to validate and preview a sheet, choose its animation/direction, apply it to selected tokens, or save actor defaults. Token overrides take precedence. **Clear token overrides** restores inheritance; **Disable on selected tokens** explicitly disables the sprite. Invalid sheets retain normal artwork.

The default Universal LPC layout uses 64×64 frames and 13 columns. The scaled preset uses the same layout at 32×32.

| State | Starting row | Frames | Directional |
| --- | ---: | ---: | --- |
| Cast | 0 | 7 | Yes |
| Thrust | 4 | 8 | Yes |
| Walk / idle | 8 | 9 / 1 | Yes |
| Slash | 12 | 6 | Yes |
| Shoot | 16 | 13 | Yes |
| Hurt | 20 | 6 | No |

Directional rows are up, left, down, right. Hurt uses one row. A normal 832×1344 Universal sheet is supported.

The existing public API remains available:

```js
game.modules.get('foundry-lpc-mobile').api.playAnimation(token, 'slash')
```

## Development and validation

The module uses native ES modules and CSS, with no runtime framework. Core rules, gestures, dnd5e integration, views, requests, prompts, preparation, and the GM workspace are separate modules. Request identity comes from ChatMessage authorship; socket payloads cannot grant privileges or resolve requests.

```sh
npm ci --ignore-scripts
npm run check
npm test
npm run test:browser
```

Browser tests default to installed Microsoft Edge. Set `FLPCM_BROWSER_CHANNEL=chrome` to use Chrome. Fixtures mock Foundry; they do not replace a live integration test.

See [VALIDATION.md](VALIDATION.md) for completed checks and the remaining live/physical-device release checklist. The manifest minimums were narrowed to the inspected installed versions; wider compatibility and physical iPhone/Android support are not yet verified.

## Migration from 0.1.0

- Existing LPC flags and the animation API are preserved; hurt now correctly uses a single row.
- Existing request cards appear as legacy Pending requests. New events use versioned flags.
- Existing tiles remain decorative until explicitly enabled in tile configuration.
- Favorites, readiness, and read markers use user flags; temporary exceptions use token flags. Secret DCs use separate GM-only messages.
- Native chat replaces the unused custom-chat path. Return to native UI remains available through settings if another module conflicts.
- The local `link.mjs` helper is unchanged.
