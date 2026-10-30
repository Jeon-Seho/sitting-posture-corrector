import assert from 'node:assert/strict'
import { delay, until } from './cdp.mjs'

/** Real tracking/display adapter in the browser; explicit synthetic tracker, no camera or model weights. */
export async function verifyPoseTracking(browser) {
  const cdp = browser.cdp
  await cdp.evaluate(`(async () => {
    const { startPoseFrameLoop } = await import('/src/features/camera/frameLoop.ts');
    const { shoulderUpLandmarks } = await import('/src/features/mediapipe/landmarks.ts');
    const points = Array.from({ length: 33 }, (_, i) => ({
      x: i === 11 ? 0.3 : i === 12 ? 0.7 : 0.5, y: i === 0 ? 0.25 : 0.5, z: 0, visibility: 0.95,
    }));
    const canvas = document.createElement('canvas');
    canvas.width = 640; canvas.height = 480;
    const state = window.__syntheticPoseTracking = { frames: [], failures: 0, expired: 0, active: true, frozen: false };
    const started = performance.now();
    const video = { readyState: 2, videoWidth: 640, videoHeight: 480,
      get currentTime() { return state.frozen ? 100 : (performance.now() - started) / 1000; } };
    const tracker = { delegate: 'GPU', close() {}, detectFrame(video, timeMs) {
      return { ...shoulderUpLandmarks({ landmarks: [points], worldLandmarks: [] }),
        timeMs, videoTimeMs: video.currentTime * 1000, inferenceMs: 5, delegate: 'GPU', width: 640, height: 480 };
    } };
    state.points = points;
    state.stop = startPoseFrameLoop({ video, tracker, isCurrent: () => state.active,
      getCanvas: () => canvas, getVisual: () => ({ mode: 'skeleton', enabled: true, reducedMotion: true, startedAt: started }),
      onPoseStarted() {}, onObservation(frame) { state.frames.push(frame); },
      onFrameUnavailable() { state.expired++; }, onMetrics() {}, onTrackingError() { state.failures++; }
    });
  })()`)
  await until(() => cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.advance(100); window.__syntheticPoseTracking.frames.length >= 3`), 'real tracking adapter observations')
  assert.ok(await cdp.evaluate(`(() => {
    const state = window.__syntheticPoseTracking;
    return !state.failures && state.frames.every(f => f.landmarks.length === 13 && f.features && f.worldLandmarks.length === 0);
  })()`))
  console.log('PASS: browser separated tracker feeds raw 13-point observations into the real camera adapter')
  await cdp.evaluate(`window.__syntheticPoseTracking.points[0].visibility = 0.1`)
  await until(() => cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.advance(100); window.__syntheticPoseTracking.frames.at(-1).features === null`), 'poor-quality tracking observation')
  assert.ok(await cdp.evaluate(`window.__syntheticPoseTracking.frames[0].landmarks[0].visibility === 0.95 && window.__syntheticPoseTracking.frames.at(-1).landmarks[0].visibility === 0.1`))
  console.log('PASS: browser raw observations keep poor quality and do not reuse or smooth earlier frames')
  await cdp.evaluate(`window.__syntheticPoseTracking.frozen = true`)
  await until(() => cdp.evaluate(`window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__.advance(200); window.__syntheticPoseTracking.expired > 0`), 'tracking expiry on frozen video')
  await cdp.evaluate(`window.__syntheticPoseTracking.stop(); window.__syntheticPoseTracking.active = false; window.__syntheticPoseTracking.count = window.__syntheticPoseTracking.frames.length`)
  await delay(150)
  assert.ok(await cdp.evaluate(`window.__syntheticPoseTracking.count === window.__syntheticPoseTracking.frames.length && !window.__syntheticPoseTracking.failures`))
  console.log('PASS: browser stale video expires and stopping the tracking clock prevents later observations')
  return 3
}
