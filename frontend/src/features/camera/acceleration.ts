import { desktopBridge } from '../desktop/bridge'

export type AccelerationStatus = 'available' | 'limited' | 'unknown'

/** A capability hint, not access to the browser's hardware acceleration preference. */
export function probeAcceleration(createContext?: () => WebGL2RenderingContext | null): AccelerationStatus {
  if (!createContext && typeof document === 'undefined') return 'unknown'
  let gl: WebGL2RenderingContext | null = null
  try {
    gl = createContext ? createContext() : document.createElement('canvas').getContext('webgl2', { failIfMajorPerformanceCaveat: true })
    if (!gl) return 'limited'
    const info = gl.getExtension('WEBGL_debug_renderer_info')
    if (!info) return 'unknown'
    const renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL))
    return /swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(renderer) ? 'limited' : 'available'
  } catch (error) {
    console.error('[camera] Graphics capability check failed', error)
    return 'unknown'
  } finally {
    try {
      gl?.getExtension('WEBGL_lose_context')?.loseContext()
    } catch (error) {
      console.error('[camera] Graphics probe cleanup failed', error)
    }
  }
}

export type PerformanceNotice = 'limited' | 'cpu' | 'available' | 'unknown'
let notice: PerformanceNotice | null = null
const shown = new Set<PerformanceNotice>()
const listeners = new Set<() => void>()
export const subscribePerformanceNotice = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
export const getPerformanceNotice = () => notice
export function dismissPerformanceNotice() {
  notice = null
  listeners.forEach((listener) => listener())
}
export function reportPerformance(value: PerformanceNotice, preview = false) {
  if (desktopBridge() || (!preview && shown.has(value))) return
  if (!preview) shown.add(value)
  notice = value
  listeners.forEach((listener) => listener())
}
export function checkCameraPerformance() {
  reportPerformance(probeAcceleration(), true)
}
