import type { DecisionEvent, FrameRequest, ServerObservation, ServerSummary } from '../server/contracts'
import { immutableCopy } from '../server/immutable'
import { MAX_BATCH_ITEMS, type ClientMessage, type ClosedReason, type ServerMessage } from './contracts'

/** The subset of the browser WebSocket used here, so tests can drive a synthetic gateway. */
export type SocketLike = {
  readonly readyState: number
  send(data: string): void
  close(code?: number): void
  onopen: (() => void) | null
  onmessage: ((event: { data: unknown }) => void) | null
  onclose: (() => void) | null
  onerror: (() => void) | null
}

export type RealtimeStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export type RealtimeHandlers = {
  onStatus?(status: RealtimeStatus): void
  onAck?(lastSequence: number): void
  onObservation?(observation: ServerObservation): void
  /** Periodic CEP counts between events; never moves backwards. */
  onProgress?(lastSequence: number, summary: ServerSummary): void
  /** Each event_id arrives once, in order, including events replayed after a reconnect. */
  onDecision?(event: DecisionEvent, summary: ServerSummary): void
  /** Live notifications only; a replayed or duplicate alert is dropped. */
  onAlert?(alert: Extract<ServerMessage, { type: 'alert' }>): void
  onStalled?(sinceLastSequence: number): void
  /** Terminal: no further reconnects. `local` means the app closed the channel itself. */
  onClosed?(reason: ClosedReason | 'local'): void
}

export type RealtimeOptions = {
  url: string
  sessionId: string
  createSocket: (url: string) => SocketLike
  handlers: RealtimeHandlers
  /** Resume point after a reload; events up to this id are not delivered again. */
  lastEventId?: number
  batchMs?: number
  /** Accepted but unacknowledged intervals. Beyond this the caller must stop input. */
  capacity?: number
  reconnectMs?: { initial: number; max: number }
}

const OPEN = 1
const TERMINAL: ReadonlySet<ClosedReason> = new Set(['ended', 'unauthorized', 'not_owner', 'session_lost'])

/**
 * Realtime transport of plan 0022 step 4: batches input v2 intervals, keeps them until the gateway acknowledges
 * them, resends after reconnecting and delivers each server event once. It never invents time or results:
 * a gap stays a gap, and the screen changes only on observations and decisions sent by the server.
 */
export class RealtimeClient {
  private socket: SocketLike | null = null
  private readonly unacked: FrameRequest[] = []
  private sentThrough = -1
  private ackedThrough = -1
  private lastEventId: number
  private lastAlertId = 0
  private progressThrough = -1
  private status: RealtimeStatus = 'connecting'
  private batchTimer: ReturnType<typeof setTimeout> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private delay: number
  private stopped = false
  readonly capacity: number

  constructor(private readonly options: RealtimeOptions) {
    this.lastEventId = options.lastEventId ?? 0
    this.capacity = options.capacity ?? 60
    this.delay = options.reconnectMs?.initial ?? 500
    if (!Number.isInteger(this.capacity) || this.capacity < 1) throw new Error('Invalid realtime capacity')
  }

  get pendingCount() {
    return this.unacked.length
  }

  start() {
    if (this.stopped || this.socket) return
    this.connect()
  }

  /** Returns false when the channel is closed or the unacknowledged window is full. */
  push(request: FrameRequest) {
    if (this.stopped || this.unacked.length >= this.capacity) return false
    const last = this.unacked.at(-1)?.sequence ?? this.ackedThrough
    if (request.sequence <= last) return false
    this.unacked.push(immutableCopy(request))
    this.batchTimer ??= setTimeout(() => this.flush(), this.options.batchMs ?? 500)
    return true
  }

  close() {
    if (this.stopped) return
    this.finish('local')
    this.socket?.close(1000)
  }

  private connect() {
    this.setStatus(this.status === 'open' || this.status === 'reconnecting' ? 'reconnecting' : 'connecting')
    const socket = this.options.createSocket(this.options.url)
    this.socket = socket
    socket.onopen = () => {
      if (socket !== this.socket) return
      this.delay = this.options.reconnectMs?.initial ?? 500
      this.setStatus('open')
      this.send({
        type: 'hello',
        schema_version: '1.0',
        session_id: this.options.sessionId,
        last_event_id: this.lastEventId,
      })
      // Everything not acknowledged is sent again; the gateway ignores sequences it already accepted.
      this.sentThrough = this.ackedThrough
      this.flush()
    }
    socket.onmessage = (event) => {
      if (socket === this.socket) this.receive(event.data)
    }
    socket.onerror = () => undefined
    socket.onclose = () => {
      if (socket !== this.socket || this.stopped) return
      this.socket = null
      this.scheduleReconnect()
    }
  }

  private scheduleReconnect() {
    this.setStatus('reconnecting')
    const max = this.options.reconnectMs?.max ?? 8000
    const wait = this.delay
    this.delay = Math.min(max, this.delay * 2)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.stopped) this.connect()
    }, wait)
  }

  private flush() {
    if (this.batchTimer !== null) clearTimeout(this.batchTimer)
    this.batchTimer = null
    if (!this.socket || this.socket.readyState !== OPEN) return
    const waiting = this.unacked.filter((item) => item.sequence > this.sentThrough)
    for (let at = 0; at < waiting.length; at += MAX_BATCH_ITEMS) {
      const items = waiting.slice(at, at + MAX_BATCH_ITEMS)
      this.send({ type: 'features', session_id: this.options.sessionId, items })
      this.sentThrough = items.at(-1)!.sequence
    }
  }

  private send(message: ClientMessage) {
    this.socket?.send(JSON.stringify(message))
  }

  private receive(data: unknown) {
    let message: ServerMessage
    try {
      message = JSON.parse(String(data)) as ServerMessage
    } catch {
      return
    }
    if (!message || message.session_id !== this.options.sessionId) return
    const { handlers } = this.options
    switch (message.type) {
      case 'ack':
        if (message.last_sequence <= this.ackedThrough) return
        this.ackedThrough = message.last_sequence
        while (this.unacked.length && this.unacked[0].sequence <= message.last_sequence) this.unacked.shift()
        handlers.onAck?.(message.last_sequence)
        return
      case 'observation':
        handlers.onObservation?.(message.observation)
        return
      case 'progress':
        if (message.last_sequence < this.progressThrough) return
        this.progressThrough = message.last_sequence
        handlers.onProgress?.(message.last_sequence, message.summary)
        return
      case 'decision':
        // Kafka delivers at least once; replay after hello may repeat what was already shown.
        if (message.event.session_id !== this.options.sessionId) return
        if (message.event.event_id <= this.lastEventId) return
        this.lastEventId = message.event.event_id
        handlers.onDecision?.(message.event, message.summary)
        return
      case 'alert':
        if (message.event_id <= this.lastAlertId || message.event_id > this.lastEventId) return
        this.lastAlertId = message.event_id
        handlers.onAlert?.(message)
        return
      case 'stalled':
        handlers.onStalled?.(message.since_last_sequence)
        return
      case 'closed':
        if (TERMINAL.has(message.reason)) {
          this.finish(message.reason)
          this.socket?.close(1000)
        }
        // server_shutdown: wait for the socket to close and reconnect.
        return
    }
  }

  private finish(reason: ClosedReason | 'local') {
    this.stopped = true
    if (this.batchTimer !== null) clearTimeout(this.batchTimer)
    if (this.reconnectTimer !== null) clearTimeout(this.reconnectTimer)
    this.batchTimer = this.reconnectTimer = null
    this.setStatus('closed')
    this.options.handlers.onClosed?.(reason)
  }

  private setStatus(status: RealtimeStatus) {
    if (this.status === status) return
    this.status = status
    this.options.handlers.onStatus?.(status)
  }
}
