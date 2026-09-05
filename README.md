# Foundry LPC Mobile

A Foundry VTT 14 module for dnd5e that replaces the non-GM interface on compact screens with a portrait-first 2D RPG experience.

## Install for development

Place this directory in the Foundry user-data `Data/modules/foundry-lpc-mobile` directory, or create a directory junction from there to this repository. Enable **Foundry LPC Mobile** in a dnd5e world. The interface activates for non-GM users at 1100 CSS pixels or narrower; **Preview on desktop** can force it on for testing.

This module deliberately does not depend on TouchVTT, Mobile Improvements, Mobile Companion, or the earlier `lpc-bridge`. Disable other modules that also replace the mobile UI while testing to avoid competing pointer handlers and CSS.

For non-GM users in mobile player mode, the module suppresses Foundry's desktop-only minimum resolution notification. Other browser, WebGL, and compatibility errors are still displayed normally.

## Player controls

- Tap empty ground to pathfind and move the assigned character.
- Tap your own token or **Act** to open the action radial.
- Tap another token to target, talk, inspect, or describe an interaction.
- Tap a tile to open the free-form interaction request composer.
- Use **Chat** to open Foundry's native chat in a full mobile panel. This preserves dnd5e roll cards, activity descriptions, whispers, and module-provided chat interactions. Plain speech also appears over the speaking scene token.

The assigned character is the token for `game.user.character`, falling back to a controlled or owned token in the active scene.

## LPC animation setup

Open a token's configuration and set **Foundry LPC Mobile → LPC spritesheet**. The default profile expects a Universal LPC spritesheet with 64×64 frames arranged in the conventional rows:

| State | Starting row | Frames |
| --- | ---: | ---: |
| Cast | 0 | 7 |
| Thrust | 4 | 8 |
| Walk / idle | 8 | 9 / 1 |
| Slash | 12 | 6 |
| Shoot | 16 | 13 |
| Hurt | 20 | 6 |

Each state uses four directional rows in up, left, down, right order. Token-specific settings override actor flags. Advanced integrations can call:

```js
game.modules.get("foundry-lpc-mobile").api.playAnimation(token, "slash")
```

Supported public states are `idle`, `walk`, `cast`, `thrust`, `slash`, `shoot`, and `hurt`.

## Current boundary

Activities still use dnd5e's native activity workflow after selection, so system-owned target/configuration prompts remain authoritative. The GM retains the normal Foundry desktop UI and receives interaction requests as private chat cards plus a notification.
