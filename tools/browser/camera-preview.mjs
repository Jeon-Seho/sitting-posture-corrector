import assert from 'node:assert/strict'
import { until } from './cdp.mjs'

/** Web camera stays in the page; desktop-only PiP is covered by component tests. */
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
  await until(() => cdp.evaluate(`!!document.querySelector('input[name="email"]')`), 'direct collection requires login', 30_000)
  check('collection is hidden before developer login', await cdp.evaluate(`!document.querySelector('#capture-task')`))
  await cdp.evaluate(`(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    for (const [name, value] of [['email', 'admin'], ['password', '1234']]) {
      const input = document.querySelector('input[name="' + name + '"]');
      setter.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  })()`)
  await click('로그인')
  await until(() => cdp.evaluate(`!!document.querySelector('#capture-task')`), 'developer collection entry', 30_000)
  const originalProfile = await cdp.evaluate(`localStorage.getItem('posegood.v2.profile')`)
  for (const width of [1440, 690, 390]) {
    await cdp.call('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false })
    check(`collection task/length are visible before camera connection at ${width}px`, await cdp.evaluate(`(() => {
      const picker = document.querySelector('#capture-task');
      const rect = picker.getBoundingClientRect();
      return !picker.disabled && picker.getAttribute('aria-haspopup') === 'listbox' && rect.top >= 0 && rect.bottom < innerHeight &&
        rect.right <= innerWidth && !document.querySelector('#capture-duration').disabled;
    })()`))
  }
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false })
  await cdp.evaluate(`(() => {
    document.querySelector('#capture-task').click();
  })()`)
  await until(() => cdp.evaluate(`document.querySelectorAll('[role="option"]').length === 14`), 'posture task options')
  await cdp.evaluate(`(() => {
    const option = [...document.querySelectorAll('[role="option"]')].find(option => option.textContent.includes('왼쪽'));
    if (!option) throw new Error('Missing left posture task');
    option.click();
  })()`)
  await until(() => cdp.evaluate(`document.querySelector('.collection-cue').textContent.includes('본인 기준 왼쪽')`), 'selected posture cue')
  check('direct capture does not write a profile or request a camera automatically',
    await cdp.evaluate(`localStorage.getItem('posegood.v2.profile') === ${JSON.stringify(originalProfile)} && window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0`))
  await click('카메라 켜기')
  await until(() => cdp.evaluate(`document.querySelector('.webcam-preview')?.readyState >= 2`), 'canvas-only web preview readiness')
  await browser.screenshot('collection-preview-synthetic')
  check('web camera preview works without a floating window or camera permission', await cdp.evaluate(`(() => {
    const source = document.querySelector('.capture-source');
    const preview = document.querySelector('.webcam-preview');
    return !window.posegoodDesktop && !document.querySelector('.camera-window-controls') &&
      source.srcObject === preview.srcObject && source.srcObject.getVideoTracks()[0].readyState === 'live' &&
      [...document.querySelectorAll('video')].every(video => video.disablePictureInPicture) &&
      window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0;
  })()`))
  check('web does not open document or video PiP', await cdp.evaluate(`!window.documentPictureInPicture?.window && !document.pictureInPictureElement`))
  await click('카메라 끄기')
  await until(() => cdp.evaluate(`document.querySelector('.capture-source').srcObject === null`), 'web camera shutdown')
  check('web camera shutdown clears the capture stream', await cdp.evaluate(`!document.querySelector('.camera-window-controls') && !window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().camera.connected`))
  return checks
}
