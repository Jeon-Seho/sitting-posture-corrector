import { featureDeltas } from '../../../../../model/prototype/serverFeatures'
import { headTurned } from '../../../../../model/prototype/pose'
import type { Observation } from '../../../hooks/useCamera'
import type { Machine } from '../../../lib/engine'
import { ReturnSettle } from '../../../lib/returnSettle'
import {
  createSessionClient,
  ServerRequestError,
  type ServerReply,
  type SessionClient,
} from './client'
import {
  policyFor,
  type DecisionEvent,
  type FrameRequest,
  type ServerCheckpoint,
  type ServerLiveState,
  type ServerObservation,
  type ServerPendingRequest,
  type ServerSessionDescriptor,
  type SessionView,
} from './contracts'
import { projectLive, projectMachine } from './projection'
import { OrderedRequestQueue } from './queue'
import { validServerCheckpoint, validSessionView } from './validation'
import { immutableCopy } from './immutable'
import { RealtimeClient, type SocketLike } from '../realtime/client'

export type ControllerPhase =
  | 'creating'
  | 'restoring'
  | 'running'
  | 'paused'
  | 'ending'
  | 'ended'
  | 'lost'
export type ServerScreenState = {
  phase: ControllerPhase
  view: SessionView | null
  live: ServerLiveState
  message: string
  queued: number
  retryable: boolean
  canResume: boolean
}
type Options = {
  session: ServerSessionDescriptor
  client?: SessionClient
  now?: () => number
  wallNow?: () => number
  capacity?: number
  onCheckpoint: (machine: Machine, checkpoint: ServerCheckpoint) => boolean | void
  onEnded: (live: ServerLiveState) => void
  onNotifications?: (events: DecisionEvent[]) => void
  onChange?: (state: ServerScreenState) => void
  /**
   * Plan 0022 realtime transport (development only). Session create/end/restore stay on HTTP;
   * live intervals go over WebSocket and results arrive as observation/progress/decision pushes.
   */
  realtime?: { url: string; createSocket?: (url: string) => SocketLike }
}

const MAX_SESSION_MS = 86_400_000
const FRAME_EXPIRY_MS = 1000
// The development backend keeps at most 10,000 accepted observations, including rest.
const LAST_DEVELOPMENT_SEQUENCE = 9998
const STALLED_MESSAGE = '분석이 잠시 멈췄어요. 서버 판정을 기다리고 있습니다.'
const RECONNECTING_MESSAGE = '실시간 연결이 끊겨 다시 연결하고 있습니다. 보낸 구간은 연결 후 다시 보냅니다.'

function sameEvent(a: DecisionEvent, b: DecisionEvent) {
  return (Object.keys(a) as (keyof DecisionEvent)[]).every((key) => a[key] === b[key])
}

/** Owns transport/lifecycle only. Accepted summaries and episodes come exclusively from CEP. */
export class ServerSessionController {
  private readonly session: ServerSessionDescriptor
  private readonly client: SessionClient
  private readonly now: () => number
  private readonly wallNow: () => number
  private readonly origin: number
  private readonly elapsedBase: number
  private readonly queue: OrderedRequestQueue
  private readonly fetchAbort = new AbortController()
  private view: SessionView | null
  private observation: ServerObservation | null = null
  private poorDisplayThroughMs = -1
  private modelVersion: string | null
  private nextSequence: number
  private lastNotificationId: number
  private previousFrame: Observation | null = null
  /** Whether the previous frame could be judged (measurable and past the return settle). */
  private previousJudged = false
  private readonly settle = new ReturnSettle()
  private lastInputEnd: number
  private restCursor: number | null = null
  private restAllowed = false
  private desiredRunning = true
  private phase: ControllerPhase
  private message = ''
  private endAt: number | null = null
  private endQueued = false
  private started = false
  private disposed = false
  private endedNotified = false
  private reconciling = false
  private terminalRejection = false
  private developmentLimit = false
  private realtime: RealtimeClient | null = null
  private realtimeBroken = false

  constructor(private readonly options: Options) {
    this.session = structuredClone(options.session)
    this.now = options.now ?? (() => performance.now())
    this.wallNow = options.wallNow ?? Date.now
    this.origin = this.now()
    const checkpoint = this.session.server.checkpoint
    this.elapsedBase = checkpoint
      ? checkpoint.elapsedMs + Math.max(0, this.wallNow() - Date.parse(checkpoint.savedAt))
      : Math.max(0, this.wallNow() - Date.parse(this.session.startedAt))
    this.view = checkpoint?.view ? immutableCopy(checkpoint.view) : null
    this.modelVersion = checkpoint?.modelVersion ?? null
    this.nextSequence = checkpoint?.nextSequence ?? 0
    this.lastNotificationId = checkpoint?.lastNotificationId ?? 0
    this.endAt =
      checkpoint?.endAt ??
      (checkpoint?.pending?.kind === 'end' ? checkpoint.pending.body.end_ms : null)
    this.lastInputEnd = this.view?.summary.total_ms ?? 0
    this.phase = checkpoint ? 'restoring' : 'creating'
    this.desiredRunning = !checkpoint && !this.session.server.finishOnly
    this.client = options.client ?? createSessionClient(this.session.id, this.session.rules)
    this.queue = new OrderedRequestQueue({
      client: this.client,
      capacity: options.capacity,
      beforeSend: (request) => this.saveCheckpoint(request),
      accepted: (request, reply) => this.accept(request, reply),
      failed: (error, request) => this.fail(error, request),
      changed: () => {
        this.emit()
        if (
          this.endAt !== null &&
          !this.endQueued &&
          !this.queue.failed &&
          !this.terminalRejection &&
          !this.reconciling &&
          !this.view?.ended &&
          this.queue.size < this.queue.capacity
        ) {
          queueMicrotask(() => {
            if (!this.disposed) this.enqueueEnd()
          })
        }
      },
    })
  }

  get state(): ServerScreenState {
    return {
      phase: this.phase,
      view: this.view,
      live: projectLive(
        this.view,
        this.phase === 'running' &&
          this.observation &&
          this.observation.end_ms > this.poorDisplayThroughMs &&
          this.elapsed() - this.observation.end_ms <= FRAME_EXPIRY_MS
          ? this.observation
          : null,
        this.modelVersion,
      ),
      message: this.message,
      queued: this.queue.size + (this.realtime?.pendingCount ?? 0),
      retryable:
        this.phase !== 'lost' && (this.queue.failed || this.reconciling || this.terminalRejection),
      canResume:
        this.phase === 'paused' &&
        !this.queue.size &&
        !this.queue.failed &&
        !this.reconciling &&
        !this.terminalRejection &&
        !this.developmentLimit &&
        !this.realtimeBroken &&
        this.endAt === null,
    }
  }

  private elapsed() {
    return Math.max(
      this.view?.summary.total_ms ?? 0,
      Math.round(this.elapsedBase + this.now() - this.origin),
    )
  }

  private checkpoint(pending: ServerPendingRequest | null = this.queue.pending): ServerCheckpoint {
    return {
      schemaVersion: '1.0',
      baselineId: this.session.server.baselineId,
      baseline: { ...this.session.server.baseline },
      deviceId: this.session.server.deviceId,
      frameWidth: this.session.server.frameWidth,
      frameHeight: this.session.server.frameHeight,
      savedAt: new Date(this.wallNow()).toISOString(),
      elapsedMs: Math.min(
        MAX_SESSION_MS,
        Math.max(
          this.elapsed(),
          pending?.kind === 'features'
            ? pending.body.end_ms
            : pending?.kind === 'end'
              ? pending.body.end_ms
              : 0,
        ),
      ),
      view: this.view,
      nextSequence: this.nextSequence,
      lastNotificationId: this.lastNotificationId,
      modelVersion: this.modelVersion,
      endAt: this.endAt,
      pending,
    }
  }

  private saveCheckpoint(pending: ServerPendingRequest | null = this.queue.pending) {
    const checkpoint = this.checkpoint(pending)
    if (!validServerCheckpoint(checkpoint, this.session.id, this.session.rules))
      throw new Error('서버 중간 기록이 계약과 일치하지 않습니다.')
    return (
      this.options.onCheckpoint(projectMachine(this.view), structuredClone(checkpoint)) !== false
    )
  }

  private emit() {
    if (!this.disposed) this.options.onChange?.(this.state)
  }

  async start() {
    if (this.started || this.disposed) return
    this.started = true
    const checkpoint = this.session.server.checkpoint
    if (
      checkpoint &&
      (!validServerCheckpoint(checkpoint, this.session.id, this.session.rules) ||
        checkpoint.baselineId !== this.session.server.baselineId ||
        (['headGap', 'offset', 'tilt', 'quality', 'turn'] as const).some(
          (key) => checkpoint.baseline[key] !== this.session.server.baseline[key],
        ) ||
        checkpoint.deviceId !== this.session.server.deviceId ||
        checkpoint.frameWidth !== this.session.server.frameWidth ||
        checkpoint.frameHeight !== this.session.server.frameHeight)
    ) {
      this.phase = 'lost'
      this.message = '저장된 서버 중간 기록을 검증하지 못했습니다. 원래 자료를 보존했습니다.'
      this.emit()
      return
    }
    if (!checkpoint) {
      const policy = policyFor(this.session.rules)
      const setup = this.session.server.setup
      this.queue.enqueue({ kind: 'create', body: setup ? { policy, setup } : { policy } })
      return
    }
    await this.restore(checkpoint)
  }

  private async restore(checkpoint: ServerCheckpoint) {
    this.reconciling = true
    this.emit()
    try {
      let restored: SessionView | null = null
      try {
        restored = await this.client.get(this.fetchAbort.signal)
      } catch (error) {
        // A create without any acknowledged view may not have reached the server at all.
        if (
          !(
            error instanceof ServerRequestError &&
            error.status === 404 &&
            checkpoint.view === null &&
            checkpoint.pending?.kind === 'create'
          )
        )
          throw error
      }
      if (this.disposed) return
      if (restored) this.adopt(restored, true)
      this.startRealtime()
      this.phase = this.view?.ended ? 'ended' : this.endAt !== null ? 'ending' : 'paused'
      this.message =
        '서버 기록을 확인했습니다. 카메라 위치가 시작 때와 같은지 확인한 뒤 직접 재개해 주세요.'
      this.reconciling = false
      if (checkpoint.pending) {
        if (checkpoint.pending.kind === 'end') {
          this.endAt = checkpoint.pending.body.end_ms
          this.endQueued = true
        }
        this.queue.enqueue(checkpoint.pending)
      } else {
        if (!this.saveCheckpoint(null)) throw new Error('복구한 서버 기록을 저장하지 못했습니다.')
        this.completeIfEnded()
        if ((this.session.server.finishOnly || this.endAt !== null) && !this.view?.ended) this.end()
      }
    } catch (error) {
      if (this.disposed) return
      this.reconciling = true
      this.phase = error instanceof ServerRequestError && error.status === 404 ? 'lost' : 'paused'
      this.message = error instanceof Error ? error.message : '서버 기록을 확인하지 못했습니다.'
    }
    this.emit()
  }

  /** A response must extend the previously verified ledger without rewriting its prefix. */
  private adopt(view: SessionView, quiet = false) {
    if (!validSessionView(view, this.session.id, this.session.rules))
      throw new Error('서버 세션 응답이 계약과 일치하지 않습니다.')
    if (
      this.view &&
      (view.last_sequence < this.view.last_sequence ||
        view.summary.total_ms < this.view.summary.total_ms ||
        (
          [
            'valid_ms',
            'normal_ms',
            'deviation_ms',
            'rest_ms',
            'away_ms',
            'unknown_ms',
            'missing_ms',
            'collapse_count',
            'alert_count',
            'interval_count',
          ] as const
        ).some((key) => view.summary[key] < this.view!.summary[key]) ||
        view.events.length < this.view.events.length ||
        this.view.events.some((event, index) => !sameEvent(event, view.events[index])))
    ) {
      throw new Error('서버 기록이 마지막 확인 기록보다 뒤로 갔거나 사건이 변경되었습니다.')
    }
    this.view = immutableCopy(view)
    this.nextSequence = Math.max(this.nextSequence, view.last_sequence + 1)
    this.lastInputEnd = Math.max(this.lastInputEnd, view.summary.total_ms)
    if (quiet) this.lastNotificationId = view.events.at(-1)?.event_id ?? 0
  }

  private accept(request: ServerPendingRequest, reply: ServerReply) {
    if (this.disposed) return
    const cursor = this.lastNotificationId
    this.adopt(reply.view)
    if (reply.observation) {
      this.observation = immutableCopy(reply.observation)
      this.modelVersion = reply.observation.model_version
    }
    const notifications = reply.view.events.filter(
      (event) =>
        event.event_id > cursor &&
        (event.kind === 'collapse_confirmed' || event.kind === 'reminder'),
    )
    const nextCursor = reply.view.events.at(-1)?.event_id ?? cursor
    this.lastNotificationId = nextCursor
    if (!this.saveCheckpoint(null)) {
      this.lastNotificationId = cursor
      throw new Error(
        '서버 응답은 받았지만 중간 기록을 저장하지 못했습니다. 같은 요청을 유지합니다.',
      )
    }
    if (request.kind === 'create') {
      this.startRealtime()
      this.phase = this.endAt !== null ? 'ending' : this.desiredRunning ? 'running' : 'paused'
      if (this.phase === 'paused' && !this.session.server.checkpoint) {
        this.restAllowed = true
        this.restCursor = this.elapsed()
      }
    }
    if (this.phase === 'running' && notifications.length)
      this.options.onNotifications?.(notifications)
    this.completeIfEnded()
    if (this.session.server.finishOnly && !reply.view.ended && this.endAt === null) {
      // Defer until the queue removes its accepted head, preserving request order and capacity.
      queueMicrotask(() => {
        if (!this.disposed) this.end()
      })
    }
    this.emit()
  }

  private completeIfEnded() {
    if (!this.view?.ended) return
    this.realtime?.close()
    this.phase = 'ended'
    this.restAllowed = false
    if (!this.endedNotified) {
      this.options.onEnded(projectLive(this.view, null, this.modelVersion))
      this.endedNotified = true
    }
  }

  private fail(error: unknown, request: ServerPendingRequest) {
    this.desiredRunning = false
    this.previousFrame = null
    this.restAllowed = false
    this.observation = null
    this.phase = error instanceof ServerRequestError && error.status === 404 ? 'lost' : 'paused'
    this.message =
      error instanceof Error ? error.message : '서버 요청에 실패했습니다. 입력을 멈췄습니다.'
    const rejected =
      request.kind === 'features' &&
      error instanceof ServerRequestError &&
      (error.status === 409 || error.status === 429)
    if (rejected) {
      this.terminalRejection = true
      this.endQueued = false
      // The rejection proves this payload was not accepted. Later unsent frames are abandoned.
      try {
        this.saveCheckpoint(null)
      } catch {
        /* The previous durable checkpoint is preserved. */
      }
    }
    this.emit()
    return rejected
  }

  private startRealtime() {
    const options = this.options.realtime
    if (!options || this.realtime || this.disposed || this.view?.ended || this.realtimeBroken) return
    const createSocket =
      options.createSocket ?? ((url: string) => new WebSocket(url) as unknown as SocketLike)
    this.realtime = new RealtimeClient({
      url: options.url,
      sessionId: this.session.id,
      createSocket,
      lastEventId: this.view?.events.at(-1)?.event_id ?? 0,
      handlers: {
        onStatus: (status) => {
          if (status === 'reconnecting' && this.phase === 'running') this.message = RECONNECTING_MESSAGE
          if (status === 'open' && this.message === RECONNECTING_MESSAGE) this.message = ''
          this.emit()
        },
        onAck: () => {
          // nextSequence must survive a reload once intervals are in the ordered topic.
          try {
            this.saveCheckpoint(null)
          } catch {
            /* The previous durable checkpoint is preserved. */
          }
          if (this.endAt !== null) this.enqueueEnd()
          this.emit()
        },
        onObservation: (observation) => {
          if (this.phase !== 'running') return
          this.observation = immutableCopy(observation)
          this.modelVersion = observation.model_version
          if (this.message === STALLED_MESSAGE) this.message = ''
          this.emit()
        },
        onProgress: (lastSequence, summary) => {
          if (!this.view) return
          if (this.message === STALLED_MESSAGE) this.message = ''
          this.applyRealtime({
            ...this.view,
            last_sequence: Math.max(this.view.last_sequence, lastSequence),
            summary,
          })
        },
        onDecision: (event, summary) => {
          if (!this.view) return
          this.applyRealtime({
            ...this.view,
            summary,
            events: [...this.view.events, event],
            ended: this.view.ended || event.kind === 'session_ended',
          })
        },
        onStalled: () => {
          if (this.phase !== 'running') return
          this.observation = null
          this.message = STALLED_MESSAGE
          this.emit()
        },
        onClosed: (reason) => {
          if (reason === 'local' || reason === 'ended' || this.disposed) return
          this.realtimeBroken = true
          this.realtime = null
          if (reason === 'session_lost') {
            this.phase = 'lost'
            this.message = '서버에서 이 세션을 찾지 못했습니다. 마지막으로 확인된 기록을 보존했습니다.'
            this.emit()
            return
          }
          this.pause('실시간 연결 권한이 없습니다. 다시 로그인한 뒤 측정을 종료해 주세요.', false)
        },
      },
    })
    this.realtime.start()
  }

  /** Pushed results pass the same ledger checks, checkpoint and notification path as HTTP replies. */
  private applyRealtime(next: SessionView) {
    if (this.disposed) return
    const cursor = this.lastNotificationId
    try {
      this.adopt(next)
    } catch (error) {
      this.realtimeBroken = true
      this.realtime?.close()
      this.realtime = null
      this.pause(error instanceof Error ? error.message : '실시간 판정 결과를 확인하지 못했습니다.', false)
      return
    }
    const notifications = next.events.filter(
      (event) =>
        event.event_id > cursor &&
        (event.kind === 'collapse_confirmed' || event.kind === 'reminder'),
    )
    this.lastNotificationId = next.events.at(-1)?.event_id ?? cursor
    try {
      if (!this.saveCheckpoint(null)) this.lastNotificationId = cursor
    } catch {
      this.lastNotificationId = cursor
    }
    if (this.phase === 'running' && notifications.length) this.options.onNotifications?.(notifications)
    this.completeIfEnded()
    this.emit()
  }

  ingest(frame: Observation, deviceId: string) {
    if (this.phase !== 'running' || this.disposed || this.endAt !== null) return
    if (
      deviceId !== this.session.server.deviceId ||
      frame.width !== this.session.server.frameWidth ||
      frame.height !== this.session.server.frameHeight
    ) {
      this.pause(
        '시작 때와 카메라 장치 또는 영상 크기가 달라졌습니다. 기존 기준으로 측정을 재개할 수 없습니다.',
        false,
      )
      return
    }
    if (!Number.isFinite(frame.timeMs)) return
    const previous = this.previousFrame
    const previousJudged = this.previousJudged
    this.previousFrame = frame
    // A turned head is not judged; send it as poor.
    const turned = headTurned(frame.features, this.session.server.baseline)
    const measured = turned ? null : featureDeltas(frame.features, this.session.server.baseline)
    // Right after an unjudged frame the user is still settling; send it as poor.
    const judged = this.settle.judge(
      frame.timeMs,
      turned ? 'head_turn' : measured !== null ? 'measurable' : 'unmeasurable',
    )
    this.previousJudged = judged
    const current = judged ? measured : null
    const frameEnd = Math.round(this.elapsedBase + frame.timeMs - this.origin)
    if (current === null) this.poorDisplayThroughMs = Math.max(this.poorDisplayThroughMs, frameEnd)
    if (current === null) this.emit()
    if (!previous) return // The first real frame only anchors the next observed interval.
    const gap = frame.timeMs - previous.timeMs
    if (gap <= 0) return
    if (gap > FRAME_EXPIRY_MS) {
      this.pause(
        '카메라 관측에 공백이 생겼습니다. 공백은 제외하며 준비 후 직접 재개해 주세요.',
        false,
      )
      return
    }
    const start = Math.round(this.elapsedBase + previous.timeMs - this.origin)
    const end = Math.round(this.elapsedBase + frame.timeMs - this.origin)
    if (start < this.lastInputEnd || start < 0 || end <= start) return
    const features = previousJudged ? current : null
    if (!features) this.poorDisplayThroughMs = Math.max(this.poorDisplayThroughMs, end)
    // The current endpoint approximates this genuinely observed [previous,current) interval.
    // It never supplies a prior score throughout an unobserved scheduling/network gap.
    this.enqueueFrame({
      start_ms: start,
      end_ms: end,
      phase: 'running',
      measurement_quality: features ? 'good' : 'poor',
      features,
    })
  }

  private enqueueFrame(
    interval: Pick<
      FrameRequest,
      'start_ms' | 'end_ms' | 'phase' | 'measurement_quality' | 'features'
    >,
  ) {
    if (interval.end_ms > MAX_SESSION_MS || this.nextSequence > LAST_DEVELOPMENT_SEQUENCE) {
      this.developmentLimit = true
      this.pause('개발용 측정 시간·관측 수 한도에 도달했습니다. 현재 측정을 종료해 주세요.', false)
      return false
    }
    if (this.realtime) {
      const live: FrameRequest = {
        schema_version: '2.0',
        feature_version: 'shoulder-relative-deltas-v1',
        baseline_id: this.session.server.baselineId,
        sequence: this.nextSequence,
        ...interval,
      }
      if (!this.realtime.push(live)) {
        this.pause(
          '실시간 전송 대기가 가득 찼습니다. 입력을 멈췄으며 연결이 회복된 뒤 직접 재개할 수 있습니다.',
          false,
        )
        return false
      }
      this.nextSequence++
      this.lastInputEnd = interval.end_ms
      this.emit()
      return true
    }
    if (this.queue.size >= this.queue.capacity) {
      this.pause(
        '서버 전송 대기가 가득 찼습니다. 입력을 멈췄으며 대기가 끝난 뒤 직접 재개할 수 있습니다.',
        false,
      )
      return false
    }
    const request: FrameRequest = {
      schema_version: '2.0',
      feature_version: 'shoulder-relative-deltas-v1',
      baseline_id: this.session.server.baselineId,
      sequence: this.nextSequence++,
      ...interval,
    }
    this.lastInputEnd = interval.end_ms
    return this.queue.enqueue({ kind: 'features', body: request })
  }

  pause(message = '휴식 중입니다. 준비 후 직접 재개해 주세요.', recordRest = true) {
    if (this.phase === 'ended' || this.phase === 'ending' || this.phase === 'lost') return
    this.desiredRunning = false
    this.previousFrame = null
    this.observation = null
    this.message = message
    if (this.phase !== 'creating' && this.phase !== 'restoring') this.phase = 'paused'
    const now = this.elapsed()
    this.restAllowed =
      recordRest &&
      !!this.view &&
      !this.queue.failed &&
      !this.terminalRejection &&
      !this.developmentLimit
    this.restCursor = now - this.lastInputEnd <= FRAME_EXPIRY_MS ? this.lastInputEnd : now
    if (this.restAllowed) this.tick()
    this.emit()
  }

  /** A heartbeat marks only known rest. Long scheduler/network gaps stay missing. */
  tick() {
    if (
      this.disposed ||
      this.phase !== 'paused' ||
      !this.restAllowed ||
      this.queue.failed ||
      this.restCursor === null ||
      this.endAt !== null
    )
      return
    const now = this.elapsed()
    const duration = now - this.restCursor
    if (duration <= 0) return
    if (duration > 1500) {
      this.restCursor = now
      return
    }
    const start = Math.max(this.restCursor, this.lastInputEnd)
    if (
      now > start &&
      this.enqueueFrame({
        start_ms: start,
        end_ms: now,
        phase: 'rest',
        measurement_quality: 'poor',
        features: null,
      })
    )
      this.restCursor = now
  }

  resume() {
    if (!this.state.canResume) return false
    this.phase = 'running'
    this.desiredRunning = true
    this.previousFrame = null
    this.restAllowed = false
    this.restCursor = null
    this.message = ''
    this.emit()
    return true
  }

  end() {
    if (this.disposed || this.phase === 'lost' || this.view?.ended) return
    if (this.endAt === null) {
      if (this.phase === 'paused') this.tick()
      this.endAt = Math.min(MAX_SESSION_MS, this.elapsed())
    }
    this.desiredRunning = false
    this.restAllowed = false
    this.previousFrame = null
    this.observation = null
    this.phase = 'ending'
    try {
      if (!this.saveCheckpoint())
        throw new Error('고정 종료 시각을 저장하지 못했습니다. 같은 요청을 유지합니다.')
    } catch (error) {
      this.phase = 'paused'
      this.message = error instanceof Error ? error.message : '종료 시각을 저장하지 못했습니다.'
      this.reconciling = true
      this.emit()
      return
    }
    if (this.terminalRejection || this.reconciling) {
      void this.retry()
      return
    }
    this.enqueueEnd()
  }

  private enqueueEnd() {
    if (this.endAt === null || this.endQueued || this.view?.ended || this.disposed) return
    // The HTTP end must follow every live interval into the same ordered topic.
    if (this.realtime && this.realtime.pendingCount > 0) {
      this.message = '실시간으로 보낸 구간이 모두 확인되면 같은 종료 시각으로 종료를 요청합니다.'
      this.emit()
      return
    }
    // A full queue cannot drop an uncertain head. Wait for a slot without changing end time.
    if (this.queue.size >= this.queue.capacity) {
      this.message = '남은 전송을 마친 뒤 같은 종료 시각으로 서버에 종료를 요청합니다.'
      this.emit()
      return
    }
    this.endQueued = true
    if (!this.queue.enqueue({ kind: 'end', body: { end_ms: this.endAt } })) this.endQueued = false
  }

  async retry() {
    if (this.disposed || this.phase === 'lost' || this.queue.busy) return
    if (this.reconciling && this.session.server.checkpoint && !this.queue.pending) {
      await this.restore(this.session.server.checkpoint)
      if (this.endAt !== null && !this.queue.pending && !this.reconciling) this.enqueueEnd()
      return
    }
    if (this.terminalRejection) {
      this.reconciling = true
      this.emit()
      try {
        this.adopt(await this.client.get(this.fetchAbort.signal), true)
        if (this.disposed) return
        this.reconciling = false
        this.terminalRejection = false
        this.developmentLimit = true // A terminal rejection permits ending, never automatic capture resumption.
        this.queue.retry()
        if (!this.saveCheckpoint(null)) throw new Error('서버 확인 기록을 저장하지 못했습니다.')
        if (this.endAt !== null) this.enqueueEnd()
      } catch (error) {
        if (this.disposed) return
        this.phase = error instanceof ServerRequestError && error.status === 404 ? 'lost' : 'paused'
        this.message = error instanceof Error ? error.message : '서버 기록을 확인하지 못했습니다.'
      }
      this.emit()
      return
    }
    this.queue.retry()
    if (this.endAt !== null && !this.queue.pending) this.enqueueEnd()
  }

  dispose() {
    this.disposed = true
    this.fetchAbort.abort()
    this.queue.dispose()
    this.realtime?.close()
    // Unmount does not fabricate a CEP interruption or end. The last durable request stays intact.
  }
}
