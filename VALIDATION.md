# Validation — 0.2.0 implementation

## Completed locally

- Node.js 22.19.0: syntax and literal localization checks across the module files.
- 17 Node tests: ownership/pause/turn policies, scoped exceptions, reactions, resources, stale favorites, tap/pinch cancellation, request authorship, deterministic GM events, duplicate/canceled rolls, blind-result privacy, legacy requests, frame validation, idle recovery, native-mesh restoration, preview isolation, edge geometry, and prompt queuing.
- 19 Playwright tests in installed desktop Microsoft Edge with mocked Foundry adapters: 360/390/430px portrait layouts, landscape and shortened viewport, character rolls, inventory, journals, failed-send recovery, unread rolls, favorite usage, targeting, drag/pinch safety (including spell templates), interactive/decorative tiles, movement confirmation, DM workspace/launcher placement, chat width/dismissal, native header bounds, edge portrait/camera stability, and incoming player/DM prompts.
- Static API review against installed Foundry **14.367** and dnd5e **5.3.3**: native roll signatures, activity confirmation hook, template-placement methods, movement path job/measurement, native token rendering/refresh behavior, chat content visibility, and ApplicationV2 configuration classes.
- Local Foundry join page responds, and the installed module directory is a junction to this repository. No authenticated test account/session was available to the implementation run. No live-world documents were modified by automated tests.

## Still required before declaring the release fully validated

These are real-environment checks, not claims made by the mocked browser suite.

- [ ] Authenticate a test player and DM; reload both clients and confirm no initialization errors.
- [ ] Run a two-player/one-DM encounter: walls, difficult terrain, doors, movement preview, invalidated turns, exceptions, multiple targets, template rotation/placement, attacks, reactions, saves, death saves, resource consumption, and End Turn.
- [ ] Move/drag/select tokens as GM, switch canvas layers, and confirm sprites stay visible, idle recovers, native alpha/lighting remain correct, and drag-preview cleanup does not affect the real token.
- [ ] Validate dynamic-ring tokens, hidden tokens, scene transitions, failed sprite loads, and repeated actor updates with a real Universal LPC sheet.
- [ ] Complete the request → private roll → DM result → resolution flow; repeat after reconnect/reload and with two GMs, removed targets, duplicate clicks, blind rolls, and deleted history.
- [ ] On physical iPhone Safari and Android Chrome, check pinch/pan, no selection rectangle, no unintended move on outside-chat dismissal, chat card interactions, keyboard resizing, safe areas, close buttons, portrait edge direction, and movement smoothness.
- [ ] Check longer chat histories, spell cards, whispers, hidden journals/tokens, secret DCs, and multi-user visibility.
- [ ] Confirm no missing glyphs and no sidebar launcher overlap with the user's Foundry theme/modules.
- [ ] Measure slower-phone responsiveness and memory across repeated scene switches with normal and low-effects modes.

Physical mobile support and the complete encounter workflow remain unverified until this checklist is completed. The 0.2.0 version identifies the implementation; no package was published or deployed to a remote service.
