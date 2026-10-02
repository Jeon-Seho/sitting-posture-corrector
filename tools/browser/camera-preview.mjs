import assert from 'node:assert/strict'
import { until } from './cdp.mjs'

/** Real rendering/native PiP with a clearly marked canvas stream; no camera permission. */
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
  await until(() => cdp.evaluate(`document.querySelector('.camera-window-controls video')?.readyState >= 2`), 'canvas-only preview readiness')
  await browser.screenshot('collection-preview-synthetic')
  check('floating preview shares the capture stream and does not request camera permission', await cdp.evaluate(`(() => {
    const source = document.querySelector('.capture-source');
    const preview = document.querySelector('.camera-window-controls video');
    return source.srcObject === preview.srcObject && source.srcObject.getVideoTracks()[0].readyState === 'live' &&
      window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().permissionCalls === 0;
  })()`))
  const rect = await cdp.evaluate(`(() => { const r = document.querySelector('.camera-window-drag').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`)
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...rect, button: 'left', clickCount: 1 })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 160, y: 40, button: 'left', buttons: 1 })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: 160, y: 40, button: 'left', clickCount: 1 })
  check('floating camera can be dragged and remains inside the viewport', await cdp.evaluate(`(() => {
    const r = document.querySelector('.camera-window-controls').getBoundingClientRect();
    return r.left >= 0 && r.top >= 0 && r.left < 200 && r.right <= innerWidth;
  })()`))
  const beforeKeyboard = await cdp.evaluate(`document.querySelector('.camera-window-controls').getBoundingClientRect().x`)
  await cdp.evaluate(`document.querySelector('.camera-window-drag').focus()`)
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  await cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 })
  check('keyboard users can move the floating camera', await cdp.evaluate(`document.querySelector('.camera-window-controls').getBoundingClientRect().x > ${beforeKeyboard}`))
  const beforeResize = await cdp.evaluate(`(() => {
    const r = document.querySelector('.camera-window-controls').getBoundingClientRect();
    return { x: r.right - 4, y: r.bottom - 4, width: r.width };
  })()`)
  await cdp.call('Input.dispatchMouseEvent', { type: 'mousePressed', x: beforeResize.x, y: beforeResize.y, button: 'left', clickCount: 1 })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: beforeResize.x - 30, y: beforeResize.y - 30, button: 'left', buttons: 1 })
  await cdp.call('Input.dispatchMouseEvent', { type: 'mouseReleased', x: beforeResize.x - 30, y: beforeResize.y - 30, button: 'left', clickCount: 1 })
  check('floating camera can be resized using its corner', await cdp.evaluate(`document.querySelector('.camera-window-controls').getBoundingClientRect().width < ${beforeResize.width}`))
  await browser.screenshot('collection-preview-moved-synthetic')
  await click('접기')
  check('collapsing the preview keeps the capture stream alive', await cdp.evaluate(`!document.querySelector('.camera-window-controls video') && document.querySelector('.capture-source').srcObject.getVideoTracks()[0].readyState === 'live'`))
  await click('펼치기')
  await click('카메라 작은 창 열기')
  await until(() => cdp.evaluate(`!!window.documentPictureInPicture?.window?.document.querySelector('video')?.srcObject`), 'real native document PiP portal')
  check('native PiP has the same stream and working controls in its own document', await cdp.evaluate(`(() => {
    const popup = window.documentPictureInPicture.window;
    return popup.document.querySelector('video').srcObject === document.querySelector('.capture-source').srcObject &&
      popup.document.body.textContent.includes('카메라 끄기');
  })()`))
  await click('작은 창 닫기')
  await until(() => cdp.evaluate(`!window.documentPictureInPicture.window`), 'native PiP close')
  check('closing native PiP leaves the capture alive', await cdp.evaluate(`document.querySelector('.capture-source').srcObject.getVideoTracks()[0].readyState === 'live'`))
  await click('카메라 작은 창 열기')
  await until(() => cdp.evaluate(`!!window.documentPictureInPicture.window`), 'native PiP reopen')
  await click('카메라 사용 종료')
  await until(() => cdp.evaluate(`!window.documentPictureInPicture.window && !document.querySelector('.camera-window-controls')`), 'camera and preview shutdown')
  check('camera shutdown removes both previews and clears the capture stream', await cdp.evaluate(`document.querySelector('.capture-source').srcObject === null && !window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.snapshot().camera.connected`))
  return checks
}
