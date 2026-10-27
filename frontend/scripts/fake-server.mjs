// 가짜 로컬 서버: 실제 BE 없이 앱 화면과 WS 흐름을 보려고 서버 신호를 흉내 낸다(개발 전용, 저장 없음).
//
//   node scripts/fake-server.mjs            # 127.0.0.1:8090 (Vite 개발 서버의 /api 프록시 기본 주소)
//   npm run dev                             # 다른 터미널에서. 아무 이메일·비밀번호로 로그인된다
//
// 흉내 내는 것: 토큰 로그인(A2·A3·A4·A5·A8, BE ADR 0031 — access 토큰 + refresh 쿠키), B1·B2 기준 자세, S1·S4 세션, R1 기록(빈 목록),
// WS /v2/realtime(hello → ready, features → ack·observation·progress, 판정 사건·alert, end → closed).
// 판정은 진짜가 아니다: 코-어깨 높이가 기준보다 낮아질수록 점수가 떨어지는 단순 규칙과
// S1 policy의 시간 규칙(hold·recovery·reminder)만 쓴다. 계약: contracts/realtime/realtime-ws.v2.schema.json.
import { createHash, randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PORT = Number(process.env.FAKE_SERVER_PORT ?? 8090)
// access 토큰 수명(초). 갱신을 보려면 짧게: FAKE_ACCESS_SECONDS=120
const ACCESS_SECONDS = Number(process.env.FAKE_ACCESS_SECONDS ?? 1800)
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
const user = { user_id: '1', email: 'fake@posegood.local', profile: { name: '테스트', age: null, occupation: null } }
let signedIn = false
const tokens = new Map() // access 토큰 → 끝나는 시각(ms)
let baseline = null
const sessions = new Map()

const EMPTY = {
  total_ms: 0, valid_ms: 0, normal_ms: 0, deviation_ms: 0, rest_ms: 0, away_ms: 0, unknown_ms: 0, missing_ms: 0,
  collapse_count: 0, alert_count: 0, interval_count: 0, keep_rate: null, events_per_hour: null,
  mean_interval_ms: null, mean_recovery_ms: null,
}

function view(s) {
  return {
    schema_version: '1.0', session_id: s.id, policy: s.policy, timer_policy: 'legacy-interrupt-v1',
    ended: s.ended, last_sequence: s.lastSequence, summary: summary(s), events: s.events,
  }
}

function summary(s) {
  const t = s.t
  const collapses = s.events.filter((e) => e.kind === 'collapse_confirmed')
  const onsets = collapses.map((e) => e.onset_valid_ms)
  const gaps = onsets.slice(1).map((v, i) => v - onsets[i])
  return {
    ...t,
    collapse_count: collapses.length,
    alert_count: s.events.filter((e) => e.kind === 'collapse_confirmed' || e.kind === 'reminder').length,
    interval_count: gaps.length,
    keep_rate: t.valid_ms ? t.normal_ms / t.valid_ms : null,
    events_per_hour: t.valid_ms ? (collapses.length * 3_600_000) / t.valid_ms : null,
    mean_interval_ms: gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : null,
    mean_recovery_ms: s.recoveries.length ? s.recoveries.reduce((a, b) => a + b, 0) / s.recoveries.length : null,
  }
}

// ---------- HTTP ----------
function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

const REFRESH_COOKIE = 'posegood_refresh=fake; HttpOnly; SameSite=Lax; Path=/'
const CLEAR_COOKIE = 'posegood_refresh=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0'
function issue() {
  const token = randomUUID()
  tokens.set(token, Date.now() + ACCESS_SECONDS * 1000)
  return { user_id: user.user_id, access_token: token, token_type: 'Bearer', expires_in: ACCESS_SECONDS }
}
const tokenValid = (token) => (tokens.get(token) ?? 0) > Date.now()
const bearer = (req) => (req.headers.authorization ?? '').replace(/^Bearer /, '')

async function readBody(req) {
  let text = ''
  for await (const chunk of req) text += chunk
  try { return text ? JSON.parse(text) : null } catch { return null }
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/api(?=\/)/, '')
  const body = ['POST', 'PUT'].includes(req.method) ? await readBody(req) : null
  console.log(`${req.method} ${path}`)
  if (path === '/v2/auth/login' || path === '/v2/auth/register') {
    signedIn = true
    if (body?.email) user.email = body.email
    if (body?.profile?.name) user.profile = { name: body.profile.name, age: body.profile.age ?? null, occupation: body.profile.occupation ?? null }
    return send(res, 200, { ...user, ...issue(), today: today() }, { 'Set-Cookie': REFRESH_COOKIE })
  }
  if (path === '/v2/auth/refresh') {
    if (!signedIn || !(req.headers.cookie ?? '').includes('posegood_refresh=fake'))
      return send(res, 401, { code: 'UNAUTHENTICATED' }, { 'Set-Cookie': CLEAR_COOKIE })
    return send(res, 200, { ...issue(), today: today() }, { 'Set-Cookie': REFRESH_COOKIE })
  }
  if (path === '/v2/auth/logout') { signedIn = false; return send(res, 204, undefined, { 'Set-Cookie': CLEAR_COOKIE }) }
  // 보호 경로: 살아 있는 access 토큰만(서버는 access 토큰을 철회하지 않음)
  if (!tokenValid(bearer(req))) return send(res, 401, { code: 'UNAUTHENTICATED' })
  if (path === '/v2/auth/me') return send(res, 200, { ...user, today: today() })
  if (path === '/v2/baselines/current') return baseline ? send(res, 200, baseline) : send(res, 404, { code: 'BASELINE_NOT_FOUND' })
  if (path === '/v2/baselines' && req.method === 'POST') {
    baseline = { schema_version: '2.0', baseline_id: randomUUID(), registered_at: new Date().toISOString(), landmarks: body?.landmarks }
    return send(res, 201, baseline)
  }
  const session = path.match(/^\/v2\/sessions\/([0-9a-f-]{36})$/i)
  if (session && req.method === 'PUT') {
    const id = session[1]
    if (!sessions.has(id)) sessions.set(id, newSession(id, body?.policy ?? { hold_ms: 3000, recovery_ms: 3000, reminder_ms: 60000, threshold: 0.7 }))
    return send(res, 200, view(sessions.get(id)))
  }
  if (session) return sessions.has(session[1]) ? send(res, 200, view(sessions.get(session[1]))) : send(res, 404, { code: 'SESSION_NOT_FOUND' })
  if (path === '/v2/records') return send(res, 200, { today: today(), records: [] })
  send(res, 404, { code: 'NOT_FOUND' })
})

function newSession(id, policy) {
  return {
    id, policy, startedAt: new Date().toISOString(), ended: false, lastSequence: -1, events: [], recoveries: [],
    t: { total_ms: 0, valid_ms: 0, normal_ms: 0, deviation_ms: 0, rest_ms: 0, away_ms: 0, unknown_ms: 0, missing_ms: 0 },
    hold: 0, recover: 0, collapsed: false, onset: 0, onsetValid: 0, firstAlert: 0, lastAlert: 0, lastProgress: 0,
  }
}

// ---------- 판정 흉내 ----------
// 프레임 9관절 순서: 코·왼눈·오른눈·왼귀·오른귀·입 왼·입 오른·왼어깨·오른어깨.
function headGap(nose, left, right) {
  const span = Math.hypot((left[0] - right[0]) * 640, (left[1] - right[1]) * 480)
  return span < 64 ? null : (((left[1] + right[1]) / 2 - nose[1]) * 480) / span
}

function baseGap() {
  const m = baseline?.landmarks
  if (!m?.nose || !m.left_shoulder || !m.right_shoulder) return null
  return headGap([m.nose.x, m.nose.y], [m.left_shoulder.x, m.left_shoulder.y], [m.right_shoulder.x, m.right_shoulder.y])
}

function score(interval) {
  if (interval.phase !== 'running') return null
  const usable = interval.frames.filter((f) => f.p && f.valid !== false && f.p[0][2] >= 0.65 && f.p[7][2] >= 0.65 && f.p[8][2] >= 0.65)
  const gaps = usable.map((f) => headGap(f.p[0], f.p[7], f.p[8])).filter((g) => g !== null)
  const base = baseGap()
  if (!gaps.length || !base) return null
  const gap = gaps.reduce((a, b) => a + b, 0) / gaps.length
  // 기준보다 코가 어깨 쪽으로 15% 내려오면 확률 1.
  return Math.max(0, Math.min(1, ((base - gap) / base) / 0.15))
}

function judge(s, interval, out) {
  const duration = interval.end_ms - interval.start_ms
  if (interval.start_ms > s.t.total_ms) s.t.missing_ms += interval.start_ms - s.t.total_ms
  s.t.total_ms = interval.end_ms
  s.lastSequence = interval.sequence
  const probability = score(interval)
  const valid = probability !== null
  out.push({
    type: 'observation',
    observation: {
      schema_version: '3.0', sequence: interval.sequence, start_ms: interval.start_ms, end_ms: interval.end_ms,
      phase: interval.phase, valid, valid_ms: valid ? duration : 0, collapse_probability: valid ? probability : 0,
      deviation_type: valid && probability >= s.policy.threshold ? 'forward_slouch' : 'none',
      invalid_reason: valid ? null : 'unmeasurable', model_version: 'fake-rule',
    },
  })
  const event = (kind, extra = {}) => {
    const e = {
      event_id: s.events.length + 1, kind, timestamp_ms: interval.end_ms, onset_ms: s.onset, onset_valid_ms: s.onsetValid,
      deviation_type: kind === 'collapse_confirmed' || kind === 'reminder' ? 'forward_slouch' : 'none', reason: null, ...extra,
    }
    s.events.push(e)
    out.push({ type: 'decision', event: e, summary: summary(s) })
    if (kind === 'collapse_confirmed' || kind === 'reminder') out.push({ type: 'alert', event_id: e.event_id, kind, deviation_type: 'forward_slouch' })
  }
  if (!valid) {
    if (interval.phase === 'rest') s.t.rest_ms += duration
    else if (interval.phase === 'away') s.t.away_ms += duration
    else s.t.unknown_ms += duration
    if (s.collapsed) { s.collapsed = false; event('interrupted', { reason: interval.phase === 'running' ? 'unmeasurable' : interval.phase }) }
    s.hold = 0; s.recover = 0
    return
  }
  const deviating = probability >= s.policy.threshold
  if (deviating && s.hold === 0) { s.onset = interval.start_ms; s.onsetValid = s.t.valid_ms }
  s.t.valid_ms += duration
  if (deviating) { s.t.deviation_ms += duration; s.hold += duration; s.recover = 0 } else { s.t.normal_ms += duration; s.hold = 0; s.recover += duration }
  if (!s.collapsed && deviating && s.hold >= s.policy.hold_ms) {
    s.collapsed = true; s.firstAlert = s.lastAlert = interval.end_ms; event('collapse_confirmed')
  } else if (s.collapsed && deviating && interval.end_ms - s.lastAlert >= s.policy.reminder_ms) {
    s.lastAlert = interval.end_ms; event('reminder')
  } else if (s.collapsed && !deviating && s.recover >= s.policy.recovery_ms) {
    s.collapsed = false; s.recoveries.push(interval.end_ms - s.firstAlert); event('recovery_confirmed')
  }
}

// ---------- WebSocket (RFC 6455 텍스트 프레임만) ----------
server.on('upgrade', (req, socket) => {
  const path = new URL(req.url, 'http://x').pathname.replace(/^\/api(?=\/)/, '')
  if (path !== '/v2/realtime') return socket.destroy()
  const accept = createHash('sha1').update(req.headers['sec-websocket-key'] + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64')
  socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`)
  console.log('WS open')
  let buffer = Buffer.alloc(0)
  let session = null
  const write = (message) => {
    if (socket.destroyed) return
    const data = Buffer.from(JSON.stringify(message))
    const head = data.length < 126 ? Buffer.from([0x81, data.length])
      : data.length < 65536 ? Buffer.from([0x81, 126, data.length >> 8, data.length & 255])
        : Buffer.concat([Buffer.from([0x81, 127, 0, 0, 0, 0]), Buffer.from([(data.length >>> 24) & 255, (data.length >> 16) & 255, (data.length >> 8) & 255, data.length & 255])])
    socket.write(Buffer.concat([head, data]))
  }
  const close = (reason) => {
    write({ type: 'closed', reason, ended_at: session?.ended ? new Date(Date.parse(session.startedAt) + session.t.total_ms).toISOString() : null })
    socket.end(Buffer.from([0x88, 0]))
    console.log(`WS closed(${reason})`)
  }
  const handle = (text) => {
    let m
    try { m = JSON.parse(text) } catch { return close('bad_message') }
    if (m.type === 'hello') {
      // 연결 때 한 번만 확인한다(BE ADR 0031). 측정 중 만료돼도 끝까지 간다.
      if (!tokenValid(m.access_token)) return close('unauthorized')
      session = sessions.get(m.session_id)
      if (!session) return close('not_owner')
      return write({ type: 'ready', purpose: 'measure', session_id: session.id, started_at: session.startedAt })
    }
    if (!session) return close('bad_message')
    if (m.type === 'features') {
      for (const interval of m.items ?? []) {
        const out = []
        judge(session, interval, out)
        write({ type: 'ack', last_sequence: session.lastSequence })
        out.forEach(write)
        if (session.t.total_ms - session.lastProgress >= 1000 || out.some((o) => o.type === 'decision')) {
          session.lastProgress = session.t.total_ms
          write({ type: 'progress', last_sequence: session.lastSequence, summary: summary(session), paused_reason: interval.phase === 'running' ? null : interval.phase })
        }
      }
      return
    }
    if (m.type === 'end') {
      session.t.total_ms = Math.max(session.t.total_ms, m.end_ms ?? 0)
      session.ended = true
      session.events.push({
        event_id: session.events.length + 1, kind: 'session_ended', timestamp_ms: session.t.total_ms, onset_ms: session.t.total_ms,
        onset_valid_ms: session.t.valid_ms, deviation_type: 'none', reason: 'ended',
      })
      write({ type: 'decision', event: session.events.at(-1), summary: summary(session) })
      return close('ended')
    }
    close('bad_message')
  }
  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 2) {
      const opcode = buffer[0] & 15
      let length = buffer[1] & 127
      let offset = 2
      if (length === 126) { if (buffer.length < 4) return; length = buffer.readUInt16BE(2); offset = 4 }
      else if (length === 127) { if (buffer.length < 10) return; length = Number(buffer.readBigUInt64BE(2)); offset = 10 }
      const masked = buffer[1] & 128
      if (buffer.length < offset + (masked ? 4 : 0) + length) return
      const mask = masked ? buffer.subarray(offset, offset + 4) : null
      offset += masked ? 4 : 0
      const payload = Buffer.from(buffer.subarray(offset, offset + length))
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4]
      buffer = buffer.subarray(offset + length)
      if (opcode === 8) { socket.end(Buffer.from([0x88, 0])); return }
      if (opcode === 9) { socket.write(Buffer.concat([Buffer.from([0x8a, payload.length]), payload])); continue }
      if (opcode === 1) handle(payload.toString('utf8'))
    }
  })
  socket.on('error', () => {})
  socket.on('close', () => console.log('WS gone'))
})

server.listen(PORT, '127.0.0.1', () => console.log(`가짜 서버: http://127.0.0.1:${PORT} (Ctrl+C로 끝)`))
