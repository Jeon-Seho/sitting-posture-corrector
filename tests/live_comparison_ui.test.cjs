// Synthetic browser state only; does not access a camera or participant data.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup({ pendingCamera = false, notification } = {}) {
  const elements = new Map()
  const callbacks = new Map()
  let now = 0, animation, watchdog, resolveCamera, stopped = false
  const stream = { getTracks: () => [{ stop() { stopped = true } }], getVideoTracks: () => [{ addEventListener() {} }] }
  const getUserMedia = () => pendingCamera ? new Promise((resolve) => { resolveCamera = resolve }) : Promise.resolve(stream)
  const circles = []
  const context2d = { clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, arc(x, y) { circles.push([x, y]) }, fill() {} }
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { id, disabled: false, hidden: false, style: {}, classList: { toggle() {} },
      addEventListener(type, callback) { callbacks.set(`${id}:${type}`, callback) },
      getContext: () => context2d, play: async () => {}, readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 1 })
    return elements.get(id)
  }
  for (const name of ['rule', 'model']) {
    getElement(`${name}-alert-count`).textContent = '0'
    getElement(`${name}-alert-last`).textContent = '아직 알림 없음'
    getElement(`${name}-toast`).hidden = true
  }
  const response = (value) => ({ ok: true, json: async () => value })
  const context = {
    document: { getElementById: getElement }, window: { addEventListener() {}, Notification: notification },
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => now }, AbortSignal,
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: { createFromOptions: async () => ({ close() {}, detectForVideo: () => ({ landmarks: [[]] }) }) },
    fetch: async (url) => response(url === '/api/session' ? { session: 'synthetic', threshold: .65 }
      : url === '/api/frame' ? { status: 'measured', rule: { score: .75, deviation: true },
        model: { score: .3, deviation: false }, model_uncorrected: { score: .4 }, correction_px: 1 } : {}),
    requestAnimationFrame: (callback) => { animation = callback; return 1 }, cancelAnimationFrame() {},
    setInterval: (callback) => { watchdog = callback; return 1 }, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
  }
  const file = path.join(__dirname, '../model/analysis/live_comparison/web/app.js')
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*\n/, '')
  vm.runInNewContext(source, context, { filename: 'app.js' })
  return { elements, callbacks, stream, resolveCamera: () => resolveCamera(stream), stopped: () => stopped,
    setNow: (value) => { now = value }, animate: () => animation(), watchdog: () => watchdog(),
    display: (result, time) => context.displayResult(result, time), tracker: () => context.createAlertTracker(),
    draw: (points) => context.draw(points), circles }
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
  assert.equal(ui.elements.get('rule-score').textContent, '25')
  assert.equal(ui.elements.get('model-score').textContent, '70')
  ui.setNow(1200)
  ui.watchdog()
  assert.equal(ui.elements.get('rule-score').textContent, '—')
  assert.equal(ui.elements.get('model-state').textContent, '측정 불가')
})

function measured(ruleBad, modelBad) {
  return { status: 'measured', rule: { score: ruleBad ? 1 : 0, deviation: ruleBad },
    model: { score: modelBad ? 1 : 0, deviation: modelBad },
    model_uncorrected: { score: modelBad ? 1 : 0 }, correction_px: 0 }
}

test('100 is the reference direction and display smoothing never changes the raw decision', () => {
  const ui = setup()
  ui.display(measured(false, false), 0)
  assert.equal(ui.elements.get('rule-score').textContent, '100')
  ui.display(measured(true, true), 100)
  const score = Number(ui.elements.get('rule-score').textContent)
  assert.ok(score > 0 && score < 100)
  assert.equal(ui.elements.get('rule-state').textContent, '기준 이탈')
  ui.display({ status: 'unmeasurable' }, 200)
  assert.equal(ui.elements.get('rule-score').textContent, '—')
  ui.display(measured(true, true), 300)
  assert.equal(ui.elements.get('rule-score').textContent, '0')
})

test('each method emits and counts actual on-screen alerts independently', () => {
  const ui = setup()
  for (let time = 0; time < 3000; time += 100) ui.display(measured(true, false), time)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '0')
  ui.display(measured(true, false), 3000)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  assert.equal(ui.elements.get('model-alert-count').textContent, '0')
  assert.equal(ui.elements.get('rule-toast').hidden, false)
  assert.match(ui.elements.get('rule-alert-last').textContent, /자세 알림/)
})

test('unmeasurable samples interrupt an incident without counting as recovery or accumulating time', () => {
  const ui = setup()
  for (let time = 0; time < 2000; time += 100) ui.display(measured(true, true), time)
  ui.display({ status: 'unmeasurable' }, 2000)
  for (let time = 2100; time < 5100; time += 100) ui.display(measured(true, true), time)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '0')
  ui.display(measured(true, true), 5100)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  assert.equal(ui.elements.get('model-alert-count').textContent, '1')
  assert.equal(ui.elements.get('model-toast').hidden, false)
})

test('reminders, three-second recovery, and gaps follow the research comparison policy', () => {
  const tracker = setup().tracker()
  for (let time = 0; time < 3000; time += 100) assert.equal(tracker.observe(true, time), null)
  assert.equal(tracker.observe(true, 3000), 'first')
  for (let time = 3100; time < 63000; time += 100) assert.equal(tracker.observe(true, time), null)
  assert.equal(tracker.observe(true, 63000), 'reminder')
  for (let time = 63100; time <= 66100; time += 100) assert.equal(tracker.observe(false, time), null)
  for (let time = 66200; time < 69200; time += 100) assert.equal(tracker.observe(true, time), null)
  assert.equal(tracker.observe(true, 69200), 'first')
  assert.equal(tracker.observe(true, 70000), null) // Missing observations interrupt the old incident.
  for (let time = 70100; time < 73000; time += 100) assert.equal(tracker.observe(true, time), null)
  assert.equal(tracker.observe(true, 73000), 'first')
})

test('system alerts require the user action; the count follows on-screen alerts', async () => {
  const delivered = []
  class NotificationStub {
    static permission = 'default'
    static async requestPermission() { this.permission = 'granted'; return this.permission }
    constructor(title) { delivered.push(title) }
  }
  const ui = setup({ notification: NotificationStub })
  assert.equal(NotificationStub.permission, 'default')
  ui.callbacks.get('enable-notifications:click')()
  await tick()
  assert.equal(NotificationStub.permission, 'granted')
  for (let time = 0; time <= 3000; time += 100) ui.display(measured(true, true), time)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  assert.equal(ui.elements.get('model-alert-count').textContent, '1')
  assert.equal(delivered.length, 2)
})

test('a system notification failure does not claim delivery or suppress the on-screen alert', () => {
  class BrokenNotification {
    static permission = 'granted'
    constructor() { throw new Error('unavailable') }
  }
  const ui = setup({ notification: BrokenNotification })
  for (let time = 0; time <= 3000; time += 100) ui.display(measured(true, false), time)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  assert.equal(ui.elements.get('rule-toast').hidden, false)
  assert.match(ui.elements.get('notification-status').textContent, /표시하지 못했습니다/)
})

test('stopping preserves counts and starting a new registration resets them', async () => {
  const ui = setup()
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
  for (let time = 0; time <= 3000; time += 100) ui.display(measured(true, true), time)
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  ui.callbacks.get('stop:click')()
  assert.equal(ui.elements.get('rule-alert-count').textContent, '1')
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
  assert.equal(ui.elements.get('rule-alert-count').textContent, '0')
  assert.equal(ui.elements.get('model-alert-count').textContent, '0')
  assert.equal(ui.elements.get('rule-toast').hidden, true)
})

test('all nine selected points, including the mouth corners, are drawn', () => {
  const ui = setup()
  ui.draw(Array.from({ length: 33 }, (_, index) => ({ x: index / 100, y: index / 100 })))
  assert.equal(ui.circles.length, 9)
  assert.ok(ui.circles.some(([x]) => Math.abs(x - .09 * 640) < .00001))
  assert.ok(ui.circles.some(([x]) => Math.abs(x - .10 * 640) < .00001))
})
