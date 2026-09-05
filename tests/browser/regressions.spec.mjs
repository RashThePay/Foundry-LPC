import { test, expect } from '@playwright/test'

test('pinch zooms during template placement and native selection handlers never receive it', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/browser/fixture.html')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(() => {
    window.nativeDowns = 0
    const board = document.querySelector('#board')
    board.addEventListener('pointerdown', () => window.nativeDowns++)
    canvas.templates.preview.children = [{ _onConfirmPlacement() {}, _onMovePlacement() {} }]
    for (const [type, id, x] of [
      ['pointerdown', 1, 40],
      ['pointerdown', 2, 140],
      ['pointermove', 2, 200],
      ['pointerup', 2, 200],
      ['pointerup', 1, 40]
    ])
      board.dispatchEvent(
        new PointerEvent(type, { pointerId: id, clientX: x, clientY: 350, button: 0, bubbles: true })
      )
  })
  expect(await page.evaluate(() => canvas.stage.scale.x)).toBeGreaterThan(1)
  expect(await page.evaluate(() => nativeDowns)).toBe(0)
  expect(await page.evaluate(() => moves)).toBe(0)
})

test('DM receives a request popup and the launcher does not occupy the bottom-left', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 })
  await page.goto('/tests/browser/fixture.html')
  await page.waitForFunction(() => window.fixtureReady)
  await page.evaluate(async () => {
    await showGM()
    workspace.install()
    foundry.applications.api.DialogV2.confirm = async (options) => {
      window.dmPrompt = options
      return false
    }
    const doc = {
      id: 'incoming',
      visible: true,
      author: game.users.get('p'),
      timestamp: Date.now(),
      flags: {
        'foundry-lpc-mobile': { v: 1, kind: 'intent', data: { text: 'I open the door', targetName: 'Door' } }
      },
      getFlag(module, key) {
        return this.flags[module]?.[key]
      }
    }
    game.messages.set(doc.id, doc)
    Hooks.callAll('createChatMessage', doc)
  })
  await page.waitForFunction(() => window.dmPrompt)
  expect(await page.evaluate(() => dmPrompt.content)).toContain('I open the door')
  const launcher = await page.locator('#flpcm-gm-launcher').boundingBox()
  expect(launcher.x).toBeGreaterThan(600)
  expect(launcher.y).toBeLessThan(100)
})
test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/tests/browser/fixture.html')
  await page.waitForFunction(() => window.fixtureReady)
})
test('chat toggles, fills its panel width and closes from the exposed map or close control', async ({
  page
}) => {
  await page.locator('[data-command=chat]').click()
  const panel = await page.locator('#ui-right').boundingBox(),
    content = await page.locator('#chat').boundingBox()
  expect(content.width).toBeGreaterThan(panel.width - 5)
  expect(panel.height).toBeLessThan(650)
  await page.locator('[data-command=chat]').click()
  await expect(page.locator('#ui-right')).toBeHidden()
  await page.locator('[data-command=chat]').click()
  await page.locator('.flpcm-chat-backdrop').click({ position: { x: 20, y: 40 } })
  await expect(page.locator('#ui-right')).toBeHidden()
  await page.locator('[data-command=chat]').click()
  await page.locator('.flpcm-native-chat-close').click()
  await expect(page.locator('#ui-right')).toBeHidden()
  await page.locator('[data-command=chat]').click()
  await page.evaluate(() => document.documentElement.style.setProperty('--flpcm-vh', '360px'))
  const shortened = await page.locator('#ui-right').boundingBox(),
    close = await page.locator('.flpcm-native-chat-close').boundingBox()
  expect(close.y).toBeGreaterThanOrEqual(shortened.y)
  expect(close.y + close.height).toBeLessThan(shortened.y + 65)
})
test('native character sheet header stays in viewport and no zoom buttons remain', async ({ page }) => {
  await expect(page.locator('[data-command=zoom-in]')).toHaveCount(0)
  await page.evaluate(() => {
    const element = document.createElement('section')
    element.className = 'application'
    element.style.cssText = 'position:fixed;left:900px;top:900px;width:900px;height:1000px'
    element.innerHTML =
      '<header class="window-header"><h2 class="window-title">Character sheet</h2><button data-test-close>Close</button></header><div class="window-content">Content</div>'
    document.body.append(element)
    shell.fitNativeWindow({ id: 'native-sheet' }, element)
  })
  const close = await page.locator('[data-test-close]').boundingBox()
  expect(close.x + close.width).toBeLessThanOrEqual(390)
  expect(close.y + close.height).toBeLessThanOrEqual(844)
})
test('camera stays still as the token moves, edge portrait appears only offscreen', async ({ page }) => {
  const initial = await page.evaluate(() => ({ ...canvas.stage.pivot }))
  await page.evaluate(() => {
    shell.primary.center = { x: 190, y: 300 }
    shell.followToken()
  })
  expect(await page.evaluate(() => canvas.stage.pivot)).toEqual(initial)
  await expect(page.locator('.flpcm-edge-portrait')).toBeHidden()
  await page.evaluate(() => {
    shell.primary.center = { x: 900, y: 300 }
    shell.followToken()
  })
  await expect(page.locator('.flpcm-edge-portrait')).toBeVisible()
})
test('incoming DM roll requests create a popup and retain their roll action', async ({ page }) => {
  await page.evaluate(async () => {
    await shell.requests.submit(shell.actor(), shell.primary, null, 'Inspect', 'inspect')
    foundry.applications.api.DialogV2.confirm = async (options) => {
      window.lastPrompt = options
      return false
    }
    const doc = {
      id: 'event',
      visible: true,
      author: game.users.get('gm'),
      flags: {
        'foundry-lpc-mobile': {
          v: 1,
          kind: 'request-event',
          requestId: 'm1',
          status: 'waiting',
          text: 'Roll Investigation',
          roll: { kind: 'skill', key: 'inv' }
        }
      },
      timestamp: Date.now() + 1,
      rolls: [],
      getFlag(module, key) {
        return this.flags[module]?.[key]
      }
    }
    game.messages.set(doc.id, doc)
    shell.receiveChat(doc)
  })
  await page.waitForFunction(() => window.lastPrompt)
  expect(await page.evaluate(() => lastPrompt.content)).toContain('Roll Investigation')
  await page.evaluate(() => shell.open('requests'))
  await expect(page.locator('[data-command=request-roll]')).toBeVisible()
})
