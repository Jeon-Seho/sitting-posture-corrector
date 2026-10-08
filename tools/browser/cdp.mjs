/** Small dependency-free Chrome DevTools transport; all calls have a real-time deadline. */

export class Cdp {

  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    this.listeners = new Map()
    socket.addEventListener(
      'message',
      ({ data }) => {
        const message = JSON.parse(data)
        if (message.id) {
          const pending = this.pending.get(message.id)
          if (!pending) return
          clearTimeout(pending.timer)
          this.pending.delete(message.id)
          if (message.error) pending.reject(new Error(JSON.stringify(message.error)))
          else pending.resolve(message.result)
        } else {
          for (const listener of this.listeners.get(message.method) ?? []) listener(message.params)
        }
      }
    )
    socket.addEventListener(
      'close',
      () => {
        for (const pending of this.pending.values()) {
          clearTimeout(pending.timer)
          pending.reject(new Error('Chrome debugging connection closed.'))
        }
        this.pending.clear()
      }
    )
  }

  static async connect(url) {
    const socket = new WebSocket(url)
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.close()
        reject(new Error('Chrome debugging connection timeout.'))
      }, 10_000)
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timer)
          resolve()
        },
        { once: true }
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timer)
          socket.close()
          reject(new Error('Chrome debugging connection failed.'))
        },
        { once: true }
      )
    })
    return new Cdp(socket)
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, new Set())
    this.listeners.get(method).add(listener)
  }

  call(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`CDP timeout: ${method}`))
      }, 15_000)
      this.pending.set(id, {
        resolve,
        reject,
        timer
      })
      this.socket.send(JSON.stringify({
        id,
        method,
        params
      }))
    })
  }

  async evaluate(expression) {
    const reply = await this.call(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true
      }
    )
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text)
    return reply.result.value
  }

  close() {
    this.socket.close()
  }
}
export const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export async function until(read, description, timeout = 12_000) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    last = await read()
    if (last) return last
    await delay(25)
  }
  throw new Error(`Timeout waiting for ${description}; last value: ${JSON.stringify(last)}`)
}
