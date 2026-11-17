// Synthetic browser state only; does not access a camera or participant data.
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

function setup({ pendingCamera = false, notification, cameraPoints = syntheticPose(.5), inputMode = 'window', thresholdStatus = 'exploratory', visibilityMinimum = .65 } = {}) {
  const elements = new Map()
  const callbacks = new Map()
  let now = 0, animation, watchdog, resolveCamera, stopped = false
  const stream = { getTracks: () => [{ stop() { stopped = true } }], getVideoTracks: () => [{ addEventListener() {} }] }
  const getUserMedia = () => pendingCamera ? new Promise((resolve) => { resolveCamera = resolve }) : Promise.resolve(stream)
  const circles = []
  const canvasCircles = new Map(), canvasStrokes = new Map(), canvasFills = new Map(), contexts = new Map()
  const getContext = (id) => {
    if (!contexts.has(id)) {
      const drawn = []
      const strokes = []
      const fills = []
      canvasCircles.set(id, drawn)
      canvasStrokes.set(id, strokes)
      canvasFills.set(id, fills)
      contexts.set(id, { clearRect() { drawn.length = 0; strokes.length = 0; fills.length = 0 }, beginPath() {}, moveTo() {}, lineTo() {},
        stroke() { strokes.push(this.strokeStyle) },
        arc(x, y) { drawn.push([x, y]); if (id === 'overlay') circles.push([x, y]) }, fill() { fills.push(this.fillStyle) }, setLineDash() {} })
    }
    return contexts.get(id)
  }
  const getElement = (id) => {
    if (!elements.has(id)) elements.set(id, { id, disabled: false, hidden: false, value: '', style: {}, attributes: {}, classList: { toggle() {} },
      setAttribute(name, value) { this.attributes[name] = value },
      addEventListener(type, callback) { callbacks.set(`${id}:${type}`, callback) },
      getContext: () => getContext(id), play: async () => {}, width: 640, height: 480,
      readyState: 2, videoWidth: 640, videoHeight: 480, currentTime: 1 })
    return elements.get(id)
  }
  for (const name of ['rule', 'model']) {
    getElement(`${name}-alert-count`).textContent = '0'
    getElement(`${name}-current-alerts`).textContent = '알림 0회'
    getElement(`${name}-alert-last`).textContent = '아직 알림 없음'
    getElement(`${name}-toast`).hidden = true
  }
  const response = (value) => ({ ok: true, json: async () => value })
  const posted = []
  let failSave = false
  let frameResult = { status: 'measured', rule: { score: .75, deviation: true },
    model: { score: .3, deviation: false }, model_uncorrected: { score: .4 }, correction_px: 1 }
  const context = {
    document: { getElementById: getElement }, window: { addEventListener() {}, Notification: notification },
    navigator: { mediaDevices: { getUserMedia } }, performance: { now: () => now }, AbortSignal,
    FilesetResolver: { forVisionTasks: async () => ({}) },
    PoseLandmarker: { createFromOptions: async () => ({ close() {}, detectForVideo: () => ({ landmarks: [cameraPoints] }) }) },
    fetch: async (url, options = {}) => {
      if (url === '/api/scenarios/save') {
        const body = JSON.parse(options.body)
        posted.push(body)
        if (failSave) return { ok: false, status: 500 }
        return response({ records: body.records.length, directory: '/synthetic/scenarios', filename: 'scenario-test.json' })
      }
      return response(url === '/api/session' ? { session: 'synthetic', threshold: .65, input_mode: inputMode, threshold_status: thresholdStatus, visibility_minimum: visibilityMinimum }
        : url === '/api/frame' ? frameResult : {})
    },
    requestAnimationFrame: (callback) => { animation = callback; return 1 }, cancelAnimationFrame() {},
    setInterval: (callback) => { watchdog = callback; return 1 }, clearInterval() {},
    setTimeout: () => 1, clearTimeout() {},
  }
  const file = path.join(__dirname, '../model/analysis/live_comparison/web/app.js')
  const source = fs.readFileSync(file, 'utf8').replace(/^import .*\n/, '')
  const scope = vm.createContext(context)
  vm.runInContext(source, scope, { filename: 'app.js' })
  return { elements, callbacks, stream, resolveCamera: () => resolveCamera(stream), stopped: () => stopped,
    setNow: (value) => { now = value }, animate: () => animation(), watchdog: () => watchdog(),
    display: (result, time, points = result.status === 'measured' ? syntheticPose(.5) : undefined) => context.displayResult(result, time, points), tracker: () => context.createAlertTracker(),
    draw: (points) => context.draw(points), state: () => vm.runInContext('state', scope),
    setFrameResult: (value) => { frameResult = value }, setFailSave: (value) => { failSave = value },
    posted, circles, canvasCircles, canvasStrokes, canvasFills }
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

test('4:3 camera sizes are accepted and frame input is clearly labelled', async () => {
  const ui = setup({ inputMode: 'frame' })
  ui.elements.get('video').videoWidth = 1280
  ui.elements.get('video').videoHeight = 960
  ui.callbacks.get('start:click')()
  await tick()
  assert.equal(ui.elements.get('camera-status').textContent, '카메라 연결됨')
  ui.callbacks.get('register:click')()
  await tick()
  assert.equal(ui.elements.get('observation-scope').textContent, '현재 프레임')
  assert.match(ui.elements.get('pose-description').textContent, /현재 프레임/)
})

test('a non-4:3 camera is rejected', async () => {
  const ui = setup()
  ui.elements.get('video').videoWidth = 1280
  ui.elements.get('video').videoHeight = 720
  ui.callbacks.get('start:click')()
  await tick()
  assert.match(ui.elements.get('guidance').textContent, /4:3/)
  assert.equal(ui.stopped(), true)
})

test('an unselected threshold is labelled as an unvalidated placeholder', async () => {
  const ui = setup({ inputMode: 'frame', thresholdStatus: 'display_only_not_selected_or_validated' })
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
  assert.match(ui.elements.get('model-threshold').textContent, /임시 비교 기준.*검증 전/)
  assert.match(ui.elements.get('model-threshold-mini').textContent, /임시 기준/)
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
  assert.equal(ui.elements.get('rule-current-alerts').textContent, '알림 1회')
  assert.equal(ui.elements.get('model-current-alerts').textContent, '알림 0회')
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

function syntheticPose(noseX) {
  return Array.from({ length: 33 }, (_, index) => ({ x: index === 0 ? noseX : .5, y: .4, visibility: .99 }))
}

function measuredScores(rule, model) {
  return { status: 'measured', rule: { score: rule, deviation: rule >= .7 },
    model: { score: model, deviation: model >= .65 },
    model_uncorrected: { score: model }, correction_px: 0 }
}

function explainedResult() {
  const names = ['head_gap', 'lateral_offset', 'shoulder_tilt', 'face_height', 'shoulder_height', 'shoulder_width']
  const ruleLevels = ['red', 'green', 'yellow']
  const modelLevels = ['green', 'yellow', 'red', 'yellow', 'green', 'yellow']
  const effects = [-.12, 0, .08, 0, -.04, 0]
  return { ...measuredScores(.8, .2), explanation: { schema_version: '1.0',
    rule: names.slice(0, 3).map((feature, i) => ({ feature, level: ruleLevels[i],
      component_score: [.8, .1, .3][i], dominant: i === 0 })),
    model: names.map((feature, i) => ({ feature, level: modelLevels[i], effect: effects[i] })) } }
}

test('comparison uses the two decisions rather than numerical score differences', () => {
  const ui = setup()
  ui.display(measuredScores(.8, .9), 100, syntheticPose(.4))
  assert.equal(ui.elements.get('pose-comparison-status').textContent, '판정 일치 · 둘 다 이탈')
  ui.display(measuredScores(.69, .66), 200, syntheticPose(.3))
  assert.equal(ui.elements.get('rule-live-decision').textContent, '유지')
  assert.equal(ui.elements.get('model-live-decision').textContent, '이탈')
  assert.equal(ui.elements.get('pose-comparison-status').textContent, '판정 차이 · 모델만 이탈')
})

test('the camera switches between explained rule and model colors and textual details', () => {
  const ui = setup(), pose = syntheticPose(.4)
  ui.display(explainedResult(), 100, pose)
  ui.draw(pose)
  assert.equal(ui.elements.get('mode-rule').attributes['aria-pressed'], 'true')
  assert.equal(ui.elements.get('feature-face_height').hidden, true)
  assert.match(ui.elements.get('feature-head_gap-detail').textContent, /이탈 기준 도달.*점수 결정/)
  assert.deepEqual(ui.canvasFills.get('overlay'), ['#ff7178', '#b7c1ba', '#b7c1ba', '#77eaa5', '#77eaa5', '#b7c1ba', '#b7c1ba', '#ffd15c', '#ffd15c'])
  ui.callbacks.get('mode-model:click')()
  ui.draw(pose)
  assert.equal(ui.elements.get('mode-model').attributes['aria-pressed'], 'true')
  assert.equal(ui.elements.get('mode-rule').attributes['aria-pressed'], 'false')
  assert.equal(ui.elements.get('feature-face_height').hidden, false)
  assert.match(ui.elements.get('feature-head_gap-detail').textContent, /−12.0점/)
  assert.match(ui.elements.get('feature-shoulder_tilt-detail').textContent, /\+8.0점/)
  assert.deepEqual(ui.canvasFills.get('overlay'), ['#77eaa5', '#ffd15c', '#ffd15c', '#ffd15c', '#ffd15c', '#ffd15c', '#ffd15c', '#ff7178', '#ff7178'])
})

test('unmeasurable, malformed, invisible, or missing explanations never show false normal colors', () => {
  const ui = setup(), pose = syntheticPose(.5)
  ui.display(explainedResult(), 100, pose)
  ui.display({ status: 'unmeasurable' }, 200, [])
  ui.draw(pose)
  assert.equal(ui.elements.get('rule-score').textContent, '—')
  assert.equal(ui.elements.get('rule-live-decision').textContent, '측정 불가')
  assert.ok(ui.canvasFills.get('overlay').every((color) => color === '#b7c1ba'))
  assert.match(ui.elements.get('pose-comparison-status').textContent, /측정할 수 없습니다/)
  const malformed = syntheticPose(.2)
  malformed[9].x = NaN
  ui.display(explainedResult(), 300, malformed)
  assert.equal(ui.elements.get('rule-score').textContent, '—')
  ui.display(measuredScores(.8, .3), 400, pose) // A server without this optional explanation.
  ui.draw(pose)
  assert.ok(ui.canvasFills.get('overlay').every((color) => color === '#b7c1ba'))
  ui.display(explainedResult(), 500, pose)
  pose[0].visibility = .2
  ui.draw(pose)
  assert.equal(ui.canvasFills.get('overlay')[0], '#b7c1ba')
  const unavailable = explainedResult()
  unavailable.explanation.model = null
  ui.display(unavailable, 600, syntheticPose(.5))
  ui.callbacks.get('mode-model:click')()
  ui.draw(syntheticPose(.5))
  assert.match(ui.elements.get('feature-head_gap-detail').textContent, /설명 제공 불가/)
  assert.ok(ui.canvasFills.get('overlay').every((color) => color === '#b7c1ba'))
})

test('stop, registration, and camera watchdog clear explanations', async () => {
  const ui = setup()
  ui.display(explainedResult(), 100, syntheticPose(.5))
  ui.callbacks.get('stop:click')()
  assert.equal(ui.state().explanation, null)
  ui.callbacks.get('start:click')()
  await tick()
  ui.display(explainedResult(), 200, syntheticPose(.5))
  ui.callbacks.get('register:click')()
  await tick()
  assert.equal(ui.state().explanation, null)
  ui.setFrameResult(explainedResult())
  ui.setNow(300)
  ui.animate()
  await tick()
  assert.ok(ui.state().explanation)
  ui.setNow(1400)
  ui.watchdog()
  assert.equal(ui.state().explanation, null)
  assert.equal(ui.canvasCircles.get('overlay').length, 0)
})

test('camera loop draws current feature colors and neutralizes an unmeasurable frame', async () => {
  const ui = setup({ cameraPoints: syntheticPose(.4) })
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
  ui.setFrameResult(explainedResult())
  ui.setNow(100)
  ui.animate()
  await tick()
  assert.equal(ui.canvasFills.get('overlay')[0], '#ff7178')
  assert.equal(ui.canvasCircles.get('overlay').length, 9)
  assert.equal(ui.elements.get('pose-comparison-status').textContent, '판정 차이 · 규칙만 이탈')
  ui.setFrameResult({ status: 'unmeasurable' })
  ui.elements.get('video').currentTime = 2
  ui.setNow(200)
  ui.animate()
  await tick()
  assert.ok(ui.canvasFills.get('overlay').every((color) => color === '#b7c1ba'))
  assert.match(ui.elements.get('pose-comparison-status').textContent, /측정할 수 없습니다/)
})

test('the obsolete frozen pose panels are absent and camera mode buttons are present', () => {
  const html = fs.readFileSync(path.join(__dirname, '../model/analysis/live_comparison/web/index.html'), 'utf8')
  assert.doesNotMatch(html, /rule-comparison|model-comparison|pose-grid/)
  assert.match(html, /id="mode-rule"/)
  assert.match(html, /id="mode-model"/)
})

async function startScenarioSession(ui) {
  ui.callbacks.get('start:click')()
  await tick()
  ui.callbacks.get('register:click')()
  await tick()
}

test('landmark colors use the loaded visibility policy and frame precision', async () => {
  const pose = syntheticPose(.4), ui = setup({ inputMode: 'frame', visibilityMinimum: .8 })
  await startScenarioSession(ui)
  pose[0].visibility = .794
  ui.display(explainedResult(), 100, pose)
  ui.draw(pose)
  assert.equal(ui.canvasFills.get('overlay')[0], '#b7c1ba')
  pose[0].visibility = .799
  ui.draw(pose)
  assert.equal(ui.canvasFills.get('overlay')[0], '#ff7178')
})

function measuredForScenario(rule = .8, model = .2) {
  const result = measuredScores(rule, model)
  result.rule.threshold = .7
  result.model.threshold = .65
  result.explanation = null
  return result
}

test('each scenario has its own labeled controls and automatic snapshot', async () => {
  const ui = setup()
  assert.match(ui.elements.get('scenario-list').innerHTML, /의자 왼쪽 이동/)
  assert.match(ui.elements.get('scenario-list').innerHTML, /1초 숙였다가 복귀/)
  assert.equal(ui.elements.get('scenario-chair_left-capture').disabled, true)
  await startScenarioSession(ui)
  ui.setNow(100)
  ui.display(measuredForScenario(), 100)
  assert.equal(ui.elements.get('scenario-live-rule').textContent, '20점')
  assert.equal(ui.elements.get('scenario-live-rule-state').textContent, '이탈')
  assert.equal(ui.elements.get('scenario-live-model-state').textContent, '유지')
  ui.callbacks.get('scenario-chair_left-capture:click')()
  assert.equal(ui.elements.get('scenario-chair_left-rule').value, '20')
  assert.equal(ui.elements.get('scenario-chair_left-model').value, '80')
  assert.equal(ui.elements.get('scenario-chair_right-rule').value, '')
  assert.equal(ui.elements.get('scenario-progress').textContent, '1개 기록')
  assert.match(ui.elements.get('scenario-chair_left-status').textContent, /기준 1.*규칙 이탈.*모델 유지/)
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  assert.equal(ui.posted.length, 1)
  const row = ui.posted[0].records[0]
  assert.equal(row.id, 'chair_left')
  assert.equal(row.source, 'automatic')
  assert.equal(row.rule_score, 20)
  assert.equal(row.model_score, 80)
  assert.equal(row.snapshot.rule.raw_score, .8)
  assert.equal(row.snapshot.model.deviation, false)
  assert.equal(row.snapshot.rule.alert_count, 0)
  assert.equal(row.snapshot.baseline_index, 1)
  assert.ok(!JSON.stringify(ui.posted[0]).includes('landmarks'))
  assert.match(ui.elements.get('scenario-save-status').textContent, /1개 자세 저장 완료/)
})

test('a manual edit clears automatic metadata and permits either score to be entered', async () => {
  const ui = setup()
  await startScenarioSession(ui)
  ui.setNow(100)
  ui.display(measuredForScenario(), 100)
  ui.callbacks.get('scenario-head_down-capture:click')()
  ui.elements.get('scenario-head_down-rule').value = '0'
  ui.callbacks.get('scenario-head_down-rule:input')()
  ui.elements.get('scenario-head_down-model').value = ''
  ui.callbacks.get('scenario-head_down-model:input')()
  assert.match(ui.elements.get('scenario-head_down-status').textContent, /직접 입력/)
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  const row = ui.posted[0].records[0]
  assert.equal(row.id, 'head_down')
  assert.equal(row.source, 'manual')
  assert.equal(row.rule_score, 0)
  assert.equal(row.model_score, null)
  assert.equal(row.snapshot, null)
})

test('empty, out-of-range and stale measurements cannot be saved as valid scores', async () => {
  const ui = setup()
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  assert.equal(ui.posted.length, 0)
  assert.match(ui.elements.get('scenario-save-status').textContent, /하나 이상/)
  ui.elements.get('scenario-baseline-rule').value = '101'
  ui.callbacks.get('scenario-baseline-rule:input')()
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  assert.equal(ui.posted.length, 0)
  assert.match(ui.elements.get('scenario-save-status').textContent, /0~100/)
  await startScenarioSession(ui)
  ui.setNow(100)
  ui.display(measuredForScenario(), 100)
  ui.setNow(1200)
  ui.callbacks.get('scenario-chair_right-capture:click')()
  assert.equal(ui.elements.get('scenario-chair_right-rule').value, '')
  assert.match(ui.elements.get('scenario-save-status').textContent, /유효한 현재 관측이 없습니다/)
  ui.display({ status: 'unmeasurable' }, 1200, [])
  assert.equal(ui.elements.get('scenario-head_down-capture').disabled, true)
})

test('scenario entries survive camera stop and record the reference number', async () => {
  const ui = setup()
  await startScenarioSession(ui)
  ui.setNow(100)
  ui.display(measuredForScenario(), 100)
  ui.callbacks.get('scenario-baseline-capture:click')()
  ui.callbacks.get('stop:click')()
  assert.equal(ui.elements.get('scenario-baseline-rule').value, '20')
  await startScenarioSession(ui)
  ui.setNow(200)
  ui.display(measuredForScenario(.2, .8), 200)
  ui.callbacks.get('scenario-chair_right-capture:click')()
  assert.equal(ui.state().scenarioRecords.baseline.snapshot.baseline_index, 1)
  assert.equal(ui.state().scenarioRecords.chair_right.snapshot.baseline_index, 2)
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  assert.equal(ui.posted[0].records.length, 2)
})

test('a failed JSON save leaves entered scores in place and shows an error', async () => {
  const ui = setup()
  ui.elements.get('scenario-expression-model').value = '65'
  ui.callbacks.get('scenario-expression-model:input')()
  ui.setFailSave(true)
  ui.callbacks.get('save-scenarios:click')()
  await tick()
  assert.equal(ui.elements.get('scenario-expression-model').value, '65')
  assert.match(ui.elements.get('scenario-save-status').textContent, /저장하지 못했습니다/)
  assert.equal(ui.elements.get('save-scenarios').disabled, false)
})
