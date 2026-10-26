import type { Landmark } from '../../../../../model/prototype/pose'
import { apiRequest, ApiError, type ApiErrorKind, type ApiOptions } from '../../platform/api'
import { noteServerTime } from '../../platform/serverClock'
import { SERVER } from '../../platform/serverConfig'
import { FrameBatcher, type FrameBatch, type FramePhase } from '../realtime/frames'
import {
  EMPTY_SUMMARY,
  parseServerMessage,
  parseSessionView,
  type Decision,
  type LiveObservation,
  type PausedReason,
  type ServerMessage,
  type SessionView,
  type Summary,
} from './messages'

/**
 * One measurement against the server (BE api-spec 7장·11장, FE proposal F1·F3, 2026-10-21):
 * S1 creates the session, `/v2/realtime` carries one 0.5 s coordinate interval per message,
 * and everything shown comes from the server. No reconnect, no resend (ADR 0024): a lost
 * connection ends the measurement and the server saves it up to the last interval.
 */
export type LivePhase = 'creating' | 'connecting' | 'running' | 'paused' | 'ending' | 'ended' | 'failed'

export type LiveState = {
  phase: LivePhase
  /** What the app sends while not running: the user's pause or camera input that stopped. */
  sending: FramePhase
  observation: LiveObservation | null
  summary: Summary
  events: Decision[]
  /** The last interval the server reported on (`progress`, S4); -1 before any. */
  lastSequence: number
  /** A confirmed collapse without a later recovery, interruption or end (server decisions). */
  alerting: boolean
  pausedReason: PausedReason
  stalled: boolean
  /** User-facing reason the measurement stopped or could not start; '' otherwise. */
  message: string
  /** Ended because the connection was lost or the server shut down. */
  lost: boolean
  /** When the server started and ended the session (`ready.started_at`, `closed.ended_at`, ADR 0029); null until sent. */
  startedAt: string | null
  endedAt: string | null
}

export type Policy = { hold_ms: number; recovery_ms: number; reminder_ms: number; threshold: number }

export type SocketLike = {
  readyState: number
  send: (data: string) => void
  close: (code?: number) => void
  onopen: ((event: unknown) => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: ((event: unknown) => void) | null
  onerror: ((event: unknown) => void) | null
}

type Options = {
  sessionId: string
  policy: Policy
  baselineId: string
  onChange: (state: LiveState) => void
  onAlert?: (kind: 'collapse_confirmed' | 'reminder') => void
  /** Called once when the measurement is over (ended, lost or failed). */
  onEnded?: (state: LiveState) => void
  now?: () => number
  openSocket?: (url: string) => SocketLike
  api?: ApiOptions
  readyTimeoutMs?: number
  endTimeoutMs?: number
}

const OPEN = 1
export const READY_TIMEOUT_MS = 5000
export const END_TIMEOUT_MS = 10_000

const MESSAGES: Record<ApiErrorKind, string> = {
  signed_out: '로그인이 필요해요. 다시 로그인한 뒤 측정해 주세요.',
  invalid: '측정을 시작하지 못했어요. 앱을 새로 고친 뒤 다시 시작해 주세요.',
  conflict: '설정이나 기준 자세가 바뀌었어요. 다시 확인한 뒤 측정해 주세요.',
  not_found: '서버에서 이 측정을 찾지 못했어요.',
  busy: '서버가 다른 작업을 처리하고 있어요. 잠시 뒤 다시 시작해 주세요.',
  limit: '지금은 측정을 시작할 수 없어요. 잠시 뒤 다시 시작해 주세요.',
  server: '서버에 문제가 있어 측정을 시작하지 못했어요. 잠시 뒤 다시 시작해 주세요.',
  network: '서버에 연결하지 못했어요. 연결을 확인한 뒤 다시 시작해 주세요.',
}

/** `closed.reason` → what the user sees (api-ws-spec 5.3). */
const CLOSED: Record<string, { message: string; failed: boolean; lost?: boolean }> = {
  ended: { message: '', failed: false },
  unauthorized: { message: '로그인이 만료됐어요. 다시 로그인해 주세요.', failed: true },
  not_owner: { message: '측정을 이어갈 수 없어요. 다시 시작해 주세요.', failed: true },
  bad_message: { message: '측정을 이어갈 수 없어요. 다시 시작해 주세요.', failed: true },
  no_baseline: { message: '기준 자세가 없어요. 자세를 먼저 등록해 주세요.', failed: true },
  session_lost: { message: '서버에서 측정이 끝났어요. 확인된 시간까지 저장됐어요.', failed: false, lost: true },
  server_shutdown: { message: '서버 연결이 끊겨 측정을 마쳤어요. 끊기기 전까지 저장됐어요.', failed: false, lost: true },
  limit_reached: { message: '한 번에 측정할 수 있는 시간을 넘어 측정을 마쳤어요.', failed: false },
}
const LOST = '서버 연결이 끊겨 측정을 마쳤어요. 끊기기 전까지 저장됐어요.'

/** A server time from a message: kept as given and moves 「오늘」 (ADR 0029); null when absent or not a time. */
function serverTime(value: unknown): string | null {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null
  noteServerTime(value)
  return value
}

export function realtimeUrl(): string {
  if (SERVER.apiBase) return `${SERVER.apiBase.replace(/^http/, 'ws')}/api/v2/realtime`
  const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
  return `${scheme}://${location.host}/api/v2/realtime`
}

export class LiveSession {
  state: LiveState = {
    phase: 'creating',
    sending: 'running',
    observation: null,
    summary: EMPTY_SUMMARY,
    events: [],
    lastSequence: -1,
    alerting: false,
    pausedReason: null,
    stalled: false,
    message: '',
    lost: false,
    startedAt: null,
    endedAt: null,
  }
  private socket: SocketLike | null = null
  private batcher: FrameBatcher | null = null
  private origin = 0
  private ready = false
  private waiting: FrameBatch[] = []
  private timer: ReturnType<typeof setTimeout> | null = null
  private disposed = false
  private readonly now: () => number

  constructor(private readonly options: Options) {
    this.now = options.now ?? (() => performance.now())
  }

  private set(patch: Partial<LiveState>) {
    if (this.disposed) return
    this.state = { ...this.state, ...patch }
    this.options.onChange(this.state)
  }

  private over() {
    return this.state.phase === 'ended' || this.state.phase === 'failed'
  }

  private finish(patch: Partial<LiveState>) {
    if (this.over()) return
    this.clearTimer()
    this.set({ ...patch, alerting: false })
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.onmessage = null
      if (socket.readyState === OPEN) socket.close(1000)
    }
    if (!this.disposed) this.options.onEnded?.(this.state)
  }

  private clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  /** S1, then the socket, `hello` and `ready` (5 s). */
  async start() {
    const { sessionId, policy, baselineId } = this.options
    try {
      const view = parseSessionView(
        await apiRequest(
          `/v2/sessions/${encodeURIComponent(sessionId)}`,
          { method: 'PUT', body: { policy, baseline_id: baselineId } },
          MESSAGES,
          // No answer: the same id and body again (api-ws-spec 4장 S1).
          { retryUnanswered: true, ...this.options.api },
        ),
      )
      if (!view) throw new ApiError('server', MESSAGES.server)
    } catch (cause) {
      const error = cause instanceof ApiError ? cause : new ApiError('server', MESSAGES.server)
      const message =
        error.code === 'BASELINE_REQUIRED' ? '기준 자세가 없어요. 자세를 먼저 등록해 주세요.' : error.message
      this.finish({ phase: 'failed', message })
      return
    }
    // Ended (「측정 종료」, the small window's X) while S1 was still on its way.
    if (this.disposed || this.over()) return
    // `t_ms` 0 is the moment S1 answered (api-ws-spec 4.4).
    this.origin = this.now()
    this.batcher = new FrameBatcher(this.origin, this.state.sending)
    this.set({ phase: 'connecting' })
    let socket: SocketLike
    try {
      socket = (this.options.openSocket ?? ((url) => new WebSocket(url) as unknown as SocketLike))(realtimeUrl())
    } catch {
      this.finish({ phase: 'failed', message: MESSAGES.network })
      return
    }
    this.socket = socket
    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'hello', schema_version: '2.0', purpose: 'measure', session_id: sessionId }))
    }
    socket.onmessage = (event) => {
      if (typeof event.data === 'string') this.receive(event.data)
    }
    socket.onclose = () => this.closedBySocket()
    socket.onerror = () => {}
    this.timer = setTimeout(() => {
      if (!this.ready) this.finish({ phase: 'failed', message: MESSAGES.network })
    }, this.options.readyTimeoutMs ?? READY_TIMEOUT_MS)
  }

  private closedBySocket() {
    this.socket = null
    if (this.over()) return
    if (this.state.phase === 'ending') {
      // S4 now instead of after the 10 s wait.
      this.clearTimer()
      void this.fetchResult()
      return
    }
    if (!this.ready) {
      this.finish({ phase: 'failed', message: MESSAGES.network })
      return
    }
    this.finish({ phase: 'ended', lost: true, message: LOST })
  }

  private receive(text: string) {
    const message = parseServerMessage(text)
    if (!message || this.over()) return
    this.handle(message)
  }

  private handle(message: ServerMessage) {
    switch (message.type) {
      case 'ready':
        if (this.ready) return
        this.ready = true
        this.clearTimer()
        this.set({ phase: this.state.sending === 'running' ? 'running' : 'paused', startedAt: serverTime(message.started_at) })
        // Intervals made before `ready` go first, one per message in order (api-ws-spec 1.1).
        for (const batch of this.waiting.splice(0)) this.send(batch)
        return
      case 'observation':
        this.set({ observation: message.observation, stalled: false })
        return
      case 'progress':
        this.set({
          summary: message.summary,
          lastSequence: message.last_sequence,
          pausedReason: message.paused_reason ?? null,
          stalled: false,
        })
        return
      case 'decision': {
        const event = message.event
        const alerting =
          event.kind === 'collapse_confirmed' || event.kind === 'reminder'
            ? true
            : event.kind === 'recovery_confirmed' || event.kind === 'interrupted' || event.kind === 'session_ended'
              ? false
              : this.state.alerting
        this.set({ events: [...this.state.events, event], summary: message.summary, alerting })
        if (event.kind === 'session_ended' && this.state.phase !== 'ending') this.set({ phase: 'ending' })
        return
      }
      case 'alert':
        this.options.onAlert?.(message.kind)
        return
      case 'stalled':
        this.set({ stalled: true })
        return
      case 'closed': {
        const known = CLOSED[message.reason] ?? CLOSED.bad_message
        this.finish({
          phase: known.failed ? 'failed' : 'ended',
          message: known.message,
          lost: !!known.lost,
          endedAt: serverTime(message.ended_at),
        })
        return
      }
      case 'ack':
        return
    }
  }

  private send(batch: FrameBatch) {
    if (!this.ready) {
      this.waiting.push(batch)
      return
    }
    if (this.socket?.readyState !== OPEN) return
    this.socket.send(JSON.stringify({ type: 'features', items: [batch] }))
  }

  private sendAll(batches: FrameBatch[]) {
    for (const batch of batches) this.send(batch)
  }

  private sendingNow() {
    const phase = this.state.phase
    return !!this.batcher && (phase === 'connecting' || phase === 'running' || phase === 'paused')
  }

  /**
   * One camera observation. `judgeable` false marks a frame where the app cannot tell where the
   * user is (a shoulder out of view, F11); the server leaves it out of the judgement.
   */
  ingest(timeMs: number, landmarks: Landmark[], judgeable: boolean) {
    if (!this.sendingNow()) return
    this.sendAll(this.batcher!.push({ timeMs, landmarks, judgeable }))
  }

  /** Closes intervals on time even without frames, so the server's clock never stalls. */
  tick() {
    if (!this.sendingNow()) return
    this.sendAll(this.batcher!.tick(this.now()))
  }

  private switchTo(phase: FramePhase) {
    if (!this.sendingNow() || this.state.sending === phase) return
    this.sendAll(this.batcher!.setPhase(phase, this.now()))
    const ready = this.state.phase !== 'connecting'
    this.set({ sending: phase, ...(ready ? { phase: phase === 'running' ? 'running' : 'paused' } : {}) })
  }

  /** 「잠시 쉬기」: `rest` intervals (no frames) until resumed. */
  pause() {
    this.switchTo('rest')
  }

  /**
   * The camera picture stopped (frames over 1 s late): `away` until the user resumes. Also during
   * a rest: DB V2.3 puts `ABSENCE` before `PAUSE`, so a stopped camera wins (FE proposal 3.2, 10/15).
   */
  away() {
    this.switchTo('away')
  }

  resume() {
    this.switchTo('running')
  }

  /** 「측정 종료」, the small window's X or an unplugged camera: `end`, then wait 10 s. */
  end() {
    if (this.over() || this.state.phase === 'ending') return
    if (!this.batcher || !this.ready) {
      // Nothing measured yet: just stop.
      this.finish({ phase: 'ended' })
      return
    }
    const now = this.now()
    this.sendAll(this.batcher.finish(now))
    const endMs = Math.max(0, Math.round(now - this.origin))
    this.set({ phase: 'ending' })
    if (this.socket?.readyState === OPEN) this.socket.send(JSON.stringify({ type: 'end', end_ms: endMs }))
    this.clearTimer()
    this.timer = setTimeout(() => void this.fetchResult(), this.options.endTimeoutMs ?? END_TIMEOUT_MS)
  }

  /** No `closed(ended)` in time (or the socket closed while ending): S4 has the saved result. */
  private async fetchResult() {
    if (this.over()) return
    try {
      const view: SessionView | null = parseSessionView(
        await apiRequest(`/v2/sessions/${encodeURIComponent(this.options.sessionId)}`, {}, MESSAGES, this.options.api),
      )
      if (view) {
        this.finish({ phase: 'ended', summary: view.summary, events: view.events, lastSequence: view.last_sequence })
        return
      }
    } catch {
      /* Show what the last `progress` said. */
    }
    this.finish({ phase: 'ended' })
  }

  dispose() {
    this.clearTimer()
    const socket = this.socket
    this.socket = null
    if (socket) {
      socket.onclose = null
      socket.onmessage = null
      if (socket.readyState === OPEN) socket.close(1000)
    }
    this.disposed = true
  }
}
