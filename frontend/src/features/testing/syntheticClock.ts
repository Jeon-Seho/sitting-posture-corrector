import { requireSyntheticMode } from './guard'
requireSyntheticMode()

const CLOCK_KEY = 'posegood.synthetic-browser-clock'
const NativeDate = Date
const saved = JSON.parse(localStorage.getItem(CLOCK_KEY) ?? 'null') as { epoch: number; elapsed: number } | null
const clock = saved ?? {
  epoch: NativeDate.now(),
  elapsed: 0
}
let installed = false

export function installClock() {
  if (installed) return
  installed = true
  // Only time supplied to the application is accelerated; network/timer deadlines stay real.
  Object.defineProperty(
    performance,
    'now',
    {
      value: () => clock.elapsed,
      configurable: true
    }
  )
  globalThis.Date = new Proxy(
    NativeDate,
    {
      construct(target, args) {
        return Reflect.construct(target, args.length ? args : [clock.epoch + clock.elapsed])
      },
      get(target, property, receiver) {
        return property === 'now' ? () => clock.epoch + clock.elapsed : Reflect.get(target, property, receiver)
      },
    }
  )
  save()
}

function save() {
  localStorage.setItem(CLOCK_KEY, JSON.stringify(clock))
}

export function advanceClock(milliseconds: number) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > 1000) throw new Error('Synthetic step must be between 0 and 1000 ms.')
  clock.elapsed += milliseconds
  save()
  return clock.elapsed
}
