import assert from 'node:assert/strict'
import { until } from './cdp.mjs'
import { verifyPoseTracking } from './pose-tracking.mjs'

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
  await cdp.evaluate(`(async () => {
    const archive = await import('/src/features/camera/baselineArchive.ts');
    const feature = { headGap: 0.5, offset: 0, tilt: 0, quality: 0.95 };
    const points = Array.from({ length: 13 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
    const frames = [{ timeMs: 100, videoTimeMs: 100, features: feature, landmarks: points,
      worldLandmarks: [], inferenceMs: 1, delegate: 'CPU', width: 640, height: 480 }];
    await archive.saveBaseline(archive.baselineRecord('synthetic-browser-baseline-only', feature,
      { durationMs: 3000, sampleCount: 1, spread: { headGap: 0, offset: 0, tilt: 0 }, placement: null }, frames));
    if (archive.archiveError()) throw new Error(archive.archiveError());
  })()`)
  check('baseline archive appears separately in the collection screen', await until(() =>
    cdp.evaluate(`document.querySelector('[aria-label="기준 자세 모음"]').textContent.includes('1건')`), 'baseline archive count'))
  await cdp.call('Page.reload', { ignoreCache: true })
  await until(() => cdp.evaluate(`performance.getEntriesByType('navigation')[0]?.type === 'reload' && !!document.querySelector('#capture-task')`), 'new collection document after reload')
  check('baseline archive survives reload with all 13 points and an unverified assumed label', await until(() =>
    cdp.evaluate(`(async () => {
      const archive = await import('/src/features/camera/baselineArchive.ts');
      const records = await archive.listBaselines();
      return records.length === 1 && records[0].frames[0].landmarks.length === 13 &&
        records[0].label === 'baseline_posture' && records[0].normal_assumed && !records[0].ground_truth_verified &&
        document.querySelector('[aria-label="기준 자세 모음"]')?.textContent.includes('1건');
    })()`), 'persisted baseline after reload'))
  await cdp.evaluate(`(() => {
    const original = URL.createObjectURL;
    URL.createObjectURL = (blob) => { window.__syntheticBaselineDownload = blob.text(); return original(blob); };
  })()`)
  await click('기준 자료 내려받기 (JSON)')
  check('baseline JSON download retains registration identity and label provenance', await cdp.evaluate(`(async () => {
    const records = JSON.parse(await window.__syntheticBaselineDownload);
    return records.length === 1 && records[0].calibration_id === 'synthetic-browser-baseline-only' &&
      records[0].label_source === 'registration_assumption' && records[0].participant_code === null;
  })()`))
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
