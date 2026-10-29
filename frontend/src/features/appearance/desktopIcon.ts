import { desktopBridge } from '../desktop/bridge'

let timer: ReturnType<typeof setTimeout> | undefined
/** Draw the same vector geometry as BrandMark, without sending file paths over IPC. */
export function updateDesktopIcon(accent: string, foreground: string) {
  const bridge = desktopBridge()
  if (!bridge?.setThemeIcon) return
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) return
    context.scale(0.5, 0.5)
    context.fillStyle = accent
    context.beginPath(); context.roundRect(16, 16, 480, 480, 96); context.fill()
    context.fillStyle = foreground
    context.beginPath(); context.arc(197, 114, 48, 0, Math.PI * 2); context.fill()
    context.strokeStyle = foreground
    context.lineWidth = 64; context.lineCap = context.lineJoin = 'round'
    context.stroke(new Path2D('M197 220V290Q197 316 223 316H308Q334 316 334 342V402'))
    void bridge.setThemeIcon!({ accent, png: canvas.toDataURL('image/png') }).catch(() => {})
  }, 250)
}
