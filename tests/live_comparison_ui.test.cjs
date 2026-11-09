// Synthetic browser state only; does not access a camera or participant data.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup({ pendingCamera = false } = {}) {
  const elements = new Map()
  const callbacks = new Map()
  let now = 0, animation, watchdog, resolveCamera, stopped = false
  const stream = { getTracks: () => [{ stop() { stopped = true } }], getVideoTracks: () => [{ addEventListener() {} }] }
  const getUserMedia = () => pendingCamera ? new Promise((resolve) => { resolveCamera = resolve }) : Promise.resolve(stream)
  const context2d = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc() {}, fill() {} }
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { id, disabled: false, hidden: false, style: {}, classList: { toggle() {} },
      addEventListener(type, callback) { callbacks.set(`${id}:${type}`, callback) },
      getContext: () => context2d, play: async () => {}, readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 1 })
    return elements.get(id)
  }
  const response = (value) => ({ ok: true, json: async () => value })
  const context = {
    document: { getElementById: getElement }, window: { addEventListener() {} },
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => now }, AbortSignal,
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: { createFromOptions: async () => ({ close() {}, detectForVideo: () => ({ landmarks: [[]] }) }) },
    fetch: async (url) => response(url === '/api/session' ? { session: 'synthetic', threshold: .65 }
      : url === '/api/frame' ? { status: 'measured', rule: { score: .75, deviation: true },
        model: { score: .3, deviation: false }, model_uncorrected: { score: .4 }, correction_px: 1 } : {}),
    requestAnimationFrame: (callback) => { animation = callback; return 1 }, cancelAnimationFrame() {},
    setInterval: (callback) => { watchdog = callback; return 1 }, clearInterval() {},
  }
  const file = path.join(__dirname, '../model/analysis/live_comparison/web/app.js')
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*\n/, '')
  vm.runInNewContext(source, context, { filename: 'app.js' })
  return { elements, callbacks, stream, resolveCamera: () => resolveCamera(stream), stopped: () => stopped,
    setNow: (value) => { now = value }, animate: () => animation(), watchdog: () => watchdog() }
}

const tick = () => new Promise((resolve) => setImmediate(resolve))

test('a pending camera request can be cancelled and a late stream is stopped', async () => {
  const ui = setup({ pendingCamera: true })
  ui.callbacks.get('start:click')()
  assert.equal(ui.elements.get('stop').disabled, false)
  ui.callbacks.get('stop:click')()
  assert.equal(ui.elements.get('start').disabled, false)
  ui.resolveCamera()
  await tick()
  assert.equal(ui.stopped(), true)
})

test('stale observations clear both model and rule scores', async () => {
  const ui = setup()
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
  ui.setNow(100)
  ui.animate()
  await tick()
  assert.equal(ui.elements.get('rule-score').textContent, '0.75')
  assert.equal(ui.elements.get('model-score').textContent, '0.30')
  ui.setNow(1200)
  ui.watchdog()
  assert.equal(ui.elements.get('rule-score').textContent, '—')
  assert.equal(ui.elements.get('model-state').textContent, '측정 불가')
})
