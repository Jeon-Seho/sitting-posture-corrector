import assert from 'node:assert/strict'
import { until } from './cdp.mjs'

/** The direct collection entry with a clearly marked canvas stream; no camera permission. */
export async function verifyCollectionPreview(browser, base) {
  const cdp = browser.cdp
  let checks = 0
  const check = (description, value) => {
    assert.ok(value, description)
    checks++
    console.log(`PASS: browser ${description}`)
  }
  const click = async (label) => {
    await cdp.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)} && !b.disabled);
      if (!button) throw new Error('Missing enabled button: ' + ${JSON.stringify(label)});
      button.click();
    })()`)
  }
  await cdp.call('Page.navigate', { url: `${base}/?synthetic=1&preview=1#collection` })
  await until(() => cdp.evaluate(`!!document.querySelector('#capture-task')`), 'direct collection entry')
  const originalProfile = await cdp.evaluate(`localStorage.getItem('posegood.v2.profile')`)
  for (const width of [1440, 690, 390]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    check(`collection task/length are visible before camera connection at ${width}px`, await cdp.evaluate(`(() => {
      const picker = document.querySelector('#capture-task');
      const rect = picker.getBoundingClientRect();
      return !picker.disabled && picker.options.length === 14 && rect.top >= 0 && rect.bottom < innerHeight &&
        rect.right <= innerWidth && !document.querySelector('#capture-duration').disabled;
    })()`))
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`(() => {
    const select = document.querySelector('#capture-task');
    select.value = 'lean_left'; select.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await until(() => cdp.evaluate(`document.querySelector('.collection-cue').textContent.includes('본인 기준 왼쪽')`), 'selected posture cue')
  check('direct capture does not write a profile or request a camera automatically',
    await cdp.evaluate(`localStorage.getItem('posegood.v2.profile') === ${JSON.stringify(originalProfile)} && window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0`))
  await click('카메라 켜기')
  await until(() => cdp.evaluate(`document.querySelector('.capture-source')?.readyState >= 2`), 'canvas-only capture readiness')
  await browser.screenshot('collection-preview-synthetic')
  // 2026-10-26 (ADR 0028): the web has no small camera window (no floating window, no PiP).
  check('the camera uses the synthetic stream without a permission request or a small window', await cdp.evaluate(`(() => {
    const source = document.querySelector('.capture-source');
    return source.srcObject.getVideoTracks()[0].readyState === 'live' &&
      window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0 &&
      !document.querySelector('.camera-window-controls') && !window.documentPictureInPicture?.window;
  })()`))
  await click('카메라 끄기')
  await until(() => cdp.evaluate(`document.querySelector('.capture-source').srcObject === null`), 'camera shutdown')
  check('turning the camera off clears the capture stream', await cdp.evaluate(`!window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().camera.connected`))
  return checks
}
