import { FilesetResolver, PoseLandmarker } from '/vendor/vision.mjs'

const $ = (id) => document.getElementById(id)
const video = $('video'), canvas = $('overlay'), ctx = canvas.getContext('2d')
// Display-only smoothing; decisions continue to use the original scores.
const SCORE_SMOOTHING_MS = 2400
const ALERT_HOLD_MS = 3000, ALERT_RECOVERY_MS = 3000, ALERT_REMINDER_MS = 60000
const MAX_OBSERVATION_GAP_MS = 500

function createAlertTracker() {
  let previous = null, badSince = null, goodSince = null, active = false, lastAlert = null
  function reset() { previous = badSince = goodSince = lastAlert = null; active = false }
  function observe(deviation, time) {
    if (!Number.isFinite(time) || typeof deviation !== 'boolean') { reset(); return null }
    if (previous !== null && (time <= previous || time - previous > MAX_OBSERVATION_GAP_MS)) reset()
    previous = time
    if (deviation) {
      goodSince = null
      if (!active) {
        if (badSince === null) badSince = time
        if (time - badSince >= ALERT_HOLD_MS) {
          active = true; lastAlert = time
          return 'first'
        }
      } else if (time - lastAlert >= ALERT_REMINDER_MS) {
        lastAlert = time
        return 'reminder'
      }
    } else {
      badSince = null
      if (active) {
        if (goodSince === null) goodSince = time
        if (time - goodSince >= ALERT_RECOVERY_MS) { active = false; goodSince = lastAlert = null }
      }
    }
    return null
  }
  return { observe, reset }
}

const state = { stream: null, detector: null, session: null, animation: 0, generation: 0,
  lastInference: 0, lastVideoTime: -1, lastStamp: -1, lastObservation: 0, watchdog: 0, busy: false,
  displayedScores: {}, alertCounts: { rule: 0, model: 0 },
  toastTimers: { rule: null, model: null },
  alertTrackers: { rule: createAlertTracker(), model: createAlertTracker() } }
const links = [[7, 0], [0, 8], [2, 5], [9, 10], [7, 11], [8, 12], [11, 12]]
const needed = new Set([0, 2, 5, 7, 8, 9, 10, 11, 12])

function resetAlertContinuity() {
  state.alertTrackers.rule.reset()
  state.alertTrackers.model.reset()
}

function resetAlertCounts() {
  resetAlertContinuity()
  for (const name of ['rule', 'model']) {
    state.alertCounts[name] = 0
    $(`${name}-alert-count`).textContent = '0'
    $(`${name}-alert-last`).textContent = '아직 알림 없음'
    clearTimeout(state.toastTimers[name])
    state.toastTimers[name] = null
    $(`${name}-toast`).hidden = true
  }
}

function updateNotificationStatus() {
  const notification = window.Notification
  const button = $('enable-notifications')
  if (!notification) {
    button.disabled = true
    $('notification-status').textContent = '이 브라우저는 시스템 알림을 지원하지 않습니다. 화면 알림은 표시됩니다.'
  } else if (notification.permission === 'granted') {
    button.disabled = true
    button.textContent = '시스템 알림 켜짐'
    $('notification-status').textContent = '화면 알림과 함께 시스템 알림도 요청합니다.'
  } else if (notification.permission === 'denied') {
    button.disabled = true
    $('notification-status').textContent = '시스템 알림이 차단되어 있습니다. 화면 알림은 표시됩니다.'
  } else {
    button.disabled = false
    $('notification-status').textContent = '화면 알림은 항상 표시됩니다.'
  }
}

async function enableNotifications() {
  if (!window.Notification) return
  try { await window.Notification.requestPermission() }
  catch { $('notification-status').textContent = '시스템 알림을 켜지 못했습니다. 화면 알림은 표시됩니다.'; return }
  updateNotificationStatus()
}

function emitAlert(name, kind) {
  const label = name === 'rule' ? '규칙 기반' : '2단계 모델'
  const action = kind === 'reminder' ? '다시 알림' : '자세 알림'
  state.alertCounts[name] += 1
  $(`${name}-alert-count`).textContent = String(state.alertCounts[name])
  $(`${name}-alert-last`).textContent = `${action} · ${new Date().toLocaleTimeString('ko-KR')}`
  const toast = $(`${name}-toast`)
  toast.hidden = false
  clearTimeout(state.toastTimers[name])
  state.toastTimers[name] = setTimeout(() => { toast.hidden = true }, 8000)
  if (window.Notification?.permission === 'granted') {
    try { new window.Notification(`${label} ${action}`, { body: '기준 자세에서 벗어난 상태가 이어지고 있습니다.' }) }
    catch { $('notification-status').textContent = '시스템 알림을 표시하지 못했습니다. 화면 알림은 표시됩니다.' }
  }
}

function updateAlerts(result, time) {
  for (const name of ['rule', 'model']) {
    const kind = state.alertTrackers[name].observe(result[name].deviation, time)
    if (kind) emitAlert(name, kind)
  }
}

function displayValue(name, deviation, time) {
  const target = 100 * (1 - Math.min(1, Math.max(0, deviation)))
  const previous = state.displayedScores[name]
  const elapsed = previous ? Math.max(0, time - previous.time) : 0
  const value = previous ? previous.value + (target - previous.value) * (1 - Math.exp(-elapsed / SCORE_SMOOTHING_MS)) : target
  state.displayedScores[name] = { value, time }
  return value
}

async function post(path, data) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(5000) })
  if (!response.ok) throw new Error(`요청 실패 (${response.status})`)
  return response.json()
}

function updateCamera(active, text) {
  $('camera-status').textContent = text
  $('camera-status').classList.toggle('active', active)
  $('placeholder').hidden = active
  $('start').disabled = active
  $('register').disabled = !active
  $('stop').disabled = !active
}

function clearScores(label = '대기 중') {
  state.displayedScores = {}
  for (const name of ['rule', 'model']) {
    $(`${name}-score`).textContent = '—'
    $(`${name}-bar`).style.width = '0%'
    $(`${name}-state`).textContent = label
    $(`${name}-state`).className = 'score-state'
  }
  $('raw-score').textContent = '—'
  $('correction').textContent = '—'
}

function displayScore(name, result, time) {
  const value = displayValue(name, result.score, time)
  $(`${name}-score`).textContent = String(Math.round(value))
  $(`${name}-bar`).style.width = `${value}%`
  $(`${name}-state`).textContent = result.deviation ? '기준 이탈' : '기준 유지'
  $(`${name}-state`).className = `score-state ${result.deviation ? 'alert' : 'active'}`
}

function displayResult(result, time) {
  if (result.status !== 'measured') resetAlertContinuity()
  switch (result.status) {
    case 'registering':
      clearScores('기준 등록 중')
      $('view-label').textContent = `기준 등록 중 · ${Math.round(result.progress * 100)}%`
      $('guidance').textContent = '편안한 기준 자세를 유지해 주세요. 추적이 끊기면 등록을 다시 시작합니다.'
      break
    case 'ready':
      clearScores('관측 준비 중')
      $('view-label').textContent = '기준 등록 완료'
      $('guidance').textContent = '기준 등록이 완료되었습니다. 1초 관측이 모이면 비교 결과를 표시합니다.'
      break
    case 'warming':
      clearScores('관측 준비 중')
      $('view-label').textContent = '관측 수집 중'
      break
    case 'unmeasurable':
      clearScores('측정 불가')
      $('view-label').textContent = '측정 불가'
      $('guidance').textContent = '얼굴과 양쪽 어깨가 화면에 잘 보이는지 확인해 주세요.'
      break
    case 'measured':
      displayScore('rule', result.rule, time)
      displayScore('model', result.model, time)
      $('raw-score').textContent = `${Math.round(displayValue('raw', result.model_uncorrected.score, time))}점`
      $('correction').textContent = `${result.correction_px.toFixed(1)} px`
      updateAlerts(result, time)
      $('view-label').textContent = '실시간 비교 중'
      $('guidance').textContent = '같은 최근 1초 관측으로 두 점수를 비교합니다. 기준을 바꾸려면 다시 등록하세요.'
      break
    default:
      clearScores('확인 필요')
  }
}

function draw(points) {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (!points?.length) return
  ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(169, 238, 184, .88)'; ctx.fillStyle = '#b9f9c3'
  for (const [a, b] of links) {
    if (!points[a] || !points[b]) continue
    ctx.beginPath(); ctx.moveTo(points[a].x * 640, points[a].y * 480); ctx.lineTo(points[b].x * 640, points[b].y * 480); ctx.stroke()
  }
  for (const index of needed) {
    const point = points[index]
    if (!point) continue
    ctx.beginPath(); ctx.arc(point.x * 640, point.y * 480, 3, 0, Math.PI * 2); ctx.fill()
  }
}

async function loop(generation) {
  if (generation !== state.generation || !state.detector) return
  if (!state.busy && video.readyState >= 2 && performance.now() - state.lastInference >= 100 && video.currentTime !== state.lastVideoTime) {
    state.busy = true
    try {
      state.lastInference = performance.now()
      state.lastVideoTime = video.currentTime
      const stamp = Math.max(state.lastStamp + 1, Math.round(video.currentTime * 1000))
      state.lastStamp = stamp
      const result = await state.detector.detectForVideo(video, stamp)
      if (generation !== state.generation) return
      const points = result.landmarks[0] || []
      draw(points)
      const session = state.session
      if (session) {
        const landmarks = points.length === 33
          ? points.map(({ x, y, visibility }, index) => needed.has(index) ? { x, y, visibility } : {})
          : []
        const observedAt = performance.now()
        const data = await post('/api/frame', { session, time_ms: observedAt, width: video.videoWidth, height: video.videoHeight, landmarks })
        if (generation === state.generation && session === state.session && performance.now() - observedAt <= 1000) {
          state.lastObservation = observedAt
          displayResult(data, observedAt)
        }
      }
    } catch {
      if (generation === state.generation) {
        resetAlertContinuity()
        clearScores('연결 오류')
        $('guidance').textContent = '카메라 또는 로컬 비교 서버에 문제가 생겼습니다. 종료 후 다시 시작해 주세요.'
        $('view-label').textContent = '연결 오류'
      }
    } finally { state.busy = false }
  }
  if (generation === state.generation) state.animation = requestAnimationFrame(() => void loop(generation))
}

async function start() {
  $('start').disabled = true
  $('stop').disabled = false
  $('camera-status').textContent = '카메라 준비 중'
  $('guidance').textContent = '카메라 권한을 확인하고 있습니다. 취소하려면 종료를 눌러 주세요.'
  const generation = ++state.generation
  let stream, detector
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, aspectRatio: { ideal: 4 / 3 } }, audio: false })
    if (generation !== state.generation) { stream.getTracks().forEach((track) => track.stop()); return }
    video.srcObject = stream
    await video.play()
    if (video.videoWidth !== 640 || video.videoHeight !== 480) throw new Error('resolution')
    const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm')
    const options = { baseOptions: { modelAssetPath: '/mediapipe/pose_landmarker_heavy.task', delegate: 'GPU' }, runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.6, minPosePresenceConfidence: 0.6, minTrackingConfidence: 0.6 }
    try { detector = await PoseLandmarker.createFromOptions(vision, options) }
    catch { options.baseOptions.delegate = 'CPU'; detector = await PoseLandmarker.createFromOptions(vision, options) }
    if (generation !== state.generation) { detector.close(); stream.getTracks().forEach((track) => track.stop()); return }
    state.stream = stream; state.detector = detector; state.lastInference = 0; state.lastVideoTime = -1; state.lastStamp = -1
    stream.getVideoTracks()[0]?.addEventListener('ended', () => {
      if (generation !== state.generation) return
      stop()
      $('guidance').textContent = '카메라 연결이 끊겼습니다. 다시 연결한 뒤 시작해 주세요.'
    })
    state.watchdog = setInterval(() => {
      if (state.session && performance.now() - state.lastObservation > 1000) {
        resetAlertContinuity()
        clearScores('측정 불가')
        $('view-label').textContent = '관측 끊김'
        $('guidance').textContent = '카메라 관측이 끊겼습니다. 카메라 상태를 확인해 주세요.'
      }
    }, 250)
    canvas.width = 640; canvas.height = 480
    updateCamera(true, '카메라 연결됨')
    $('view-label').textContent = '기준 등록 전'
    $('guidance').textContent = '편안한 자세를 취한 뒤 ‘기준 자세 등록’을 눌러 주세요.'
    state.animation = requestAnimationFrame(() => void loop(generation))
  } catch (error) {
    detector?.close(); stream?.getTracks().forEach((track) => track.stop()); video.srcObject = null
    if (generation !== state.generation) return
    updateCamera(false, '카메라 꺼짐')
    $('guidance').textContent = error?.message === 'resolution'
      ? '카메라가 640×480 영상을 제공하지 않습니다. 해당 해상도를 지원하는 카메라를 사용해 주세요.'
      : '카메라 권한과 로컬 MediaPipe 자산을 확인한 뒤 다시 시도해 주세요.'
    $('view-label').textContent = '준비 실패'
  }
}

async function register() {
  if (!state.detector) return
  $('register').disabled = true
  const generation = state.generation
  const previous = state.session
  state.session = null
  resetAlertContinuity()
  clearScores('기준 등록 준비')
  try {
    if (previous) await post('/api/end', { session: previous })
    const data = await post('/api/session', {})
    if (generation !== state.generation) { await post('/api/end', { session: data.session }); return }
    resetAlertCounts()
    state.session = data.session
    state.lastObservation = performance.now()
    $('model-threshold').textContent = `이탈 기준 ${Number((100 * (1 - data.threshold)).toFixed(2))}점 이하`
    $('view-label').textContent = '기준 등록 시작'
    $('guidance').textContent = '편안한 기준 자세를 3초 이상 유지해 주세요.'
  } catch {
    $('guidance').textContent = '로컬 비교 서버에 연결하지 못했습니다.'
  } finally { if (generation === state.generation) $('register').disabled = false }
}

function stop() {
  state.generation++
  cancelAnimationFrame(state.animation)
  clearInterval(state.watchdog)
  const session = state.session
  state.session = null
  resetAlertContinuity()
  if (session) void post('/api/end', { session }).catch(() => {})
  state.detector?.close(); state.detector = null
  state.stream?.getTracks().forEach((track) => track.stop()); state.stream = null
  video.srcObject = null
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  state.busy = false
  clearScores()
  updateCamera(false, '카메라 꺼짐')
  $('view-label').textContent = '대기 중'
  $('guidance').textContent = '카메라를 켠 뒤 편안한 기준 자세를 취하고 등록해 주세요.'
}

$('start').addEventListener('click', () => void start())
$('register').addEventListener('click', () => void register())
$('stop').addEventListener('click', stop)
$('enable-notifications').addEventListener('click', () => void enableNotifications())
updateNotificationStatus()
window.addEventListener('pagehide', stop)
