import type { ServerPendingRequest } from './contracts'
import type { ServerReply, SessionClient } from './client'
import { immutableCopy } from './immutable'

type QueueOptions = {
  client: SessionClient
  capacity?: number
  beforeSend: (request: ServerPendingRequest) => boolean | void
  accepted: (request: ServerPendingRequest, reply: ServerReply) => void
  failed: (error: unknown, request: ServerPendingRequest) => boolean | void
  changed?: () => void
}

/** A failed head blocks all later mutations. Retry never regenerates timestamps or payloads. */
export class OrderedRequestQueue {
  private readonly requests: ServerPendingRequest[] = []
  private sending = false
  private blocked = false
  private disposed = false
  private abort: AbortController | null = null
  readonly capacity: number

  constructor(private readonly options: QueueOptions) {
    this.capacity = options.capacity ?? 16
    if (!Number.isInteger(this.capacity) || this.capacity < 1 || this.capacity > 32)
      throw new Error('Invalid queue capacity')
  }

  get size() {
    return this.requests.length
  }
  get pending(): ServerPendingRequest | null {
    return this.requests[0] ?? null
  }
  get failed() {
    return this.blocked
  }
  get busy() {
    return this.sending
  }

  enqueue(request: ServerPendingRequest) {
    if (this.disposed || this.requests.length >= this.capacity) return false
    this.requests.push(immutableCopy(request))
    this.options.changed?.()
    void this.drain()
    return true
  }

  retry() {
    if (this.disposed || this.sending) return
    this.blocked = false
    this.options.changed?.()
    void this.drain()
  }

  private async drain() {
    if (this.sending || this.blocked || this.disposed || !this.pending) return
    this.sending = true
    this.options.changed?.()
    while (this.pending && !this.blocked && !this.disposed) {
      const pending = this.pending
      this.abort = new AbortController()
      try {
        if (this.options.beforeSend(pending) === false)
          throw new Error(
            '전송 전 중간 기록을 저장하지 못했습니다. 저장소를 확인한 뒤 다시 시도해 주세요.',
          )
        const reply = await this.options.client.send(pending, this.abort.signal)
        if (this.disposed) break
        // Clear only a verified response. A validator or persistence failure retains the head.
        this.options.accepted(pending, reply)
        this.requests.shift()
      } catch (error) {
        if (this.disposed) break
        this.blocked = true
        if (this.options.failed(error, pending) === true) this.requests.length = 0
      }
      this.options.changed?.()
    }
    this.sending = false
    this.abort = null
    if (!this.disposed) this.options.changed?.()
  }

  dispose() {
    this.disposed = true
    this.abort?.abort()
  }
}
