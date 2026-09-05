import { test, expect } from '@playwright/test'
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/browser/fixture.html')
  await page.waitForFunction(() => window.fixtureReady)
})
for (const width of [360, 390, 430])
  test(`dock and panels fit ${width}px portrait`, async ({ page }) => {
    await page.setViewportSize({ width, height: 780 })
    await page.locator('[data-command=more]').click()
    await expect(page.locator('.flpcm-panel')).toBeVisible()
    const bounds = await page.locator('.flpcm-panel').boundingBox()
    expect(bounds.x).toBeGreaterThanOrEqual(0)
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width)
    await page.locator('.flpcm-panel [data-command=character]').click()
    await page.getByRole('button', { name: 'Investigation' }).click()
    expect(await page.evaluate(() => window.rollCount)).toBe(1)
    await page.locator('[data-command=back]').click()
    await expect(page.locator('#flpcm-title')).toHaveText('More')
  })
test('inventory includes non-activity items and journals respect permission', async ({ page }) => {
  await page.evaluate(() => shell.open('items'))
  await expect(page.getByRole('button', { name: 'Rope' })).toBeVisible()
  await page.evaluate(() => shell.open('journals'))
  await expect(page.getByRole('button', { name: 'Public handout' })).toBeVisible()
  await expect(page.getByText('Secret journal')).toHaveCount(0)
})
test('failed submissions preserve drafts and a retry persists once', async ({ page }) => {
  await page.evaluate(() => {
    window.failSend = true
    shell.open('interact')
  })
  await page.locator('[name=intent]').fill('I listen at the door.')
  await page.getByRole('button', { name: 'Send to DM' }).click()
  await expect(page.locator('[name=intent]')).toHaveValue('I listen at the door.')
  await page.evaluate(() => (window.failSend = false))
  await page.getByRole('button', { name: 'Send to DM' }).click()
  await expect(page.locator('#flpcm-title')).toHaveText('Requests')
  expect(await page.evaluate(() => game.messages.size)).toBe(1)
})
test('visible rolls increment unread; own messages do not', async ({ page }) => {
  await page.evaluate(() => {
    shell.receiveChat({ visible: true, author: { id: 'gm' }, rolls: [{ total: 10 }], getFlag() {} })
    shell.receiveChat({ visible: true, author: { id: 'p' }, rolls: [{ total: 10 }], getFlag() {} })
  })
  await expect(page.locator('[data-unread]')).toHaveText('1')
  await page.locator('[data-command=chat]').click()
  await expect(page.locator('[data-unread]')).toBeHidden()
})
test('favorite action is accessible from the dock and does not double-use', async ({ page }) => {
  await page.evaluate(() => shell.open('actions'))
  await page.getByRole('button', { name: 'Toggle favorite' }).click()
  await page.locator('[data-command=close]').click()
  const favorite = page.locator('.flpcm-favorites button')
  await expect(favorite).toHaveText('Slash')
  await favorite.dblclick()
  expect(await page.evaluate(() => uses)).toBe(1)
})
test('target inspection is separate from targeting, clear removes selection', async ({ page }) => {
  await page.evaluate(() => shell.tap({ x: 220, y: 220 }))
  expect(await page.evaluate(() => game.user.targets.size)).toBe(0)
  await page.getByRole('button', { name: 'Target', exact: true }).click()
  expect(await page.evaluate(() => game.user.targets.size)).toBe(1)
  await page.getByRole('button', { name: 'Clear', exact: true }).click()
  expect(await page.evaluate(() => game.user.targets.size)).toBe(0)
})
test('dragging and pinch do not move token', async ({ page }) => {
  await page.mouse.move(30, 300)
  await page.mouse.down()
  await page.mouse.move(100, 350, { steps: 5 })
  await page.mouse.up()
  expect(await page.evaluate(() => moves)).toBe(0)
  await page.evaluate(() => {
    const board = document.querySelector('#board')
    for (const [type, id, x] of [
      ['pointerdown', 1, 40],
      ['pointerdown', 2, 140],
      ['pointermove', 2, 180],
      ['pointerup', 2, 180],
      ['pointerup', 1, 40]
    ])
      board.dispatchEvent(
        new PointerEvent(type, { pointerId: id, clientX: x, clientY: 350, button: 0, bubbles: true })
      )
  })
  expect(await page.evaluate(() => moves)).toBe(0)
})
test('decorative tiles allow movement; explicit interactive tiles open requests', async ({ page }) => {
  await page.evaluate(() => {
    canvas.tiles.placeables = [
      {
        id: 'floor',
        visible: true,
        document: { hidden: false, getFlag: () => undefined },
        bounds: { contains: () => true }
      }
    ]
    return shell.tap({ x: 150, y: 400 })
  })
  expect(await page.evaluate(() => moves)).toBe(1)
  await page.evaluate(() => {
    canvas.tiles.placeables[0].document.getFlag = () => ({
      enabled: true,
      name: 'Chest',
      verbs: 'inspect,open'
    })
    return shell.tap({ x: 150, y: 400 })
  })
  await expect(page.locator('#flpcm-title')).toHaveText('Interact')
  expect(await page.evaluate(() => moves)).toBe(1)
})
test('combat movement is confirmed and invalidated by turn changes', async ({ page }) => {
  await page.evaluate(() => {
    game.combat = { id: 'c', started: true, round: 1, turn: 0, combatant: { tokenId: 'token' } }
    return shell.tap({ x: 150, y: 400 })
  })
  await expect(page.locator('.flpcm-movement')).toBeVisible()
  expect(await page.evaluate(() => moves)).toBe(0)
  await page.evaluate(() => (game.combat.turn = 1))
  await page.locator('[data-command=move-confirm]').click()
  expect(await page.evaluate(() => moves)).toBe(0)
})
test('keyboard-height and landscape panels remain inside viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 360 })
  await page.evaluate(() => shell.open('interact'))
  const bounds = await page.locator('.flpcm-panel').boundingBox()
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(360)
  await page.setViewportSize({ width: 740, height: 360 })
  const wide = await page.locator('.flpcm-panel').boundingBox()
  expect(wide.x + wide.width).toBeLessThanOrEqual(740)
})
test('DM workspace renders requests, players, scene setup and secret-free player history', async ({
  page
}) => {
  await page.evaluate(async () => {
    await shell.requests.submit(shell.actor(), shell.primary, null, 'Investigate', 'inspect')
    await showGM()
  })
  await expect(page.locator('.flpcm-request-summary')).toContainText('Player')
  await page.locator('.flpcm-request-summary').click()
  await page.locator('[name=reply]').fill('The latch is rusted.')
  await page.getByRole('button', { name: 'Send reply', exact: true }).click()
  await expect(page.locator('.flpcm-gm-detail')).toContainText('The latch is rusted.')
  await page.locator('[data-tab=players]').click()
  await expect(page.locator('.flpcm-gm-body')).toContainText('Player')
  await page.locator('[data-tab=sceneSetup]').click()
  await expect(page.getByText('LPC sprite setup', { exact: true })).toBeVisible()
})
