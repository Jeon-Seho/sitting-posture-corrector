import { featureDeltas } from '../../../../../model/prototype/serverFeatures'
import type { Observation } from '../../../hooks/useCamera'
import type { Machine } from '../../../lib/engine'
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
}

const MAX_SESSION_MS = 86_400_000
const FRAME_EXPIRY_MS = 1000
// The development backend keeps at most 10,000 accepted observations, including rest.
const LAST_DEVELOPMENT_SEQUENCE = 9998

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
      queued: this.queue.size,
      retryable:
        this.phase !== 'lost' && (this.queue.failed || this.reconciling || this.terminalRejection),
      canResume:
        this.phase === 'paused' &&
        !this.queue.size &&
        !this.queue.failed &&
        !this.reconciling &&
        !this.terminalRejection &&
        !this.developmentLimit &&
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
        (['headGap', 'offset', 'tilt', 'quality'] as const).some(
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
      this.queue.enqueue({ kind: 'create', body: { policy: policyFor(this.session.rules) } })
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
    this.previousFrame = frame
    const current = featureDeltas(frame.features, this.session.server.baseline)
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
    const previousValid = featureDeltas(previous.features, this.session.server.baseline) !== null
    const features = previousValid ? current : null
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
    // Unmount does not fabricate a CEP interruption or end. The last durable request stays intact.
  }
}
