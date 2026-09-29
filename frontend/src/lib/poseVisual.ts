import type { Landmark } from '../../../model/prototype/pose'

export type VisualMode = 'skeleton' | 'matrix'
export type VisualOptions = { mode: VisualMode; enabled: boolean; reducedMotion: boolean; startedAt: number }
// MediaPipe Pose's actual 33 landmarks. No fabricated chin landmark.
export const POSE_EDGES: [number, number][] = [
  [0,1],[1,2],[2,3],[3,7],[0,4],[4,5],[5,6],[6,8],[9,10],
  [11,12],[11,13],[13,15],[15,17],[15,19],[15,21],[17,19],
  [12,14],[14,16],[16,18],[16,20],[16,22],[18,20],
  [11,23],[12,24],[23,24],[23,25],[24,26],[25,27],[26,28],
  [27,29],[28,30],[29,31],[30,32],[27,31],[28,32],
]
export function visiblePoint(p: Landmark | undefined): p is Landmark {
  return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)
    && (p.visibility ?? 0) >= 0.65 && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1
}
export function validEdges(points: Landmark[]) {
  return POSE_EDGES.filter(([a,b]) => visiblePoint(points[a]) && visiblePoint(points[b]))
}
type Particle = { x: number; y: number; z: number; seed: number }
const mix = (a: number, b: number, t: number) => a + (b-a)*t
const noise = (seed: number) => { const x = Math.sin(seed * 127.1 + 31.7) * 43758.5453; return x - Math.floor(x) }

/** Decorative samples between visible joints, never measurements. Linear, bounded cost. */
export function cloudTargets(points: Landmark[]): Particle[] {
  const result: Particle[] = []
  for (const [a,b] of validEdges(points)) {
    const p = points[a], q = points[b]
    for (let i=0; i<8; i++) {
      const t = i/7
      result.push({ x: mix(p.x,q.x,t), y: mix(p.y,q.y,t), z: mix(p.z,q.z,t), seed: a*1000+b*10+i })
    }
  }
  if ([11,12,23,24].every(i => visiblePoint(points[i]))) {
    for (let row=0; row<11; row++) for (let col=0; col<15; col++) {
      const v=row/10, u=col/14, left=points[11], right=points[12], hipL=points[23], hipR=points[24]
      result.push({ x: mix(mix(left.x,hipL.x,v),mix(right.x,hipR.x,v),u),
        y: mix(mix(left.y,hipL.y,v),mix(right.y,hipR.y,v),u),
        z: mix(mix(left.z,hipL.z,v),mix(right.z,hipR.z,v),u), seed: 100000+row*15+col })
    }
  }
  return result // <= 35*8 + 165 = 445 particles
}

export function drawPose(canvas: HTMLCanvasElement | null, points: Landmark[], width: number, height: number,
  time: number, options: VisualOptions) {
  if (!canvas) return
  if (canvas.width !== width) canvas.width = width
  if (canvas.height !== height) canvas.height = height
  const ctx = canvas.getContext('2d'); if (!ctx) return
  ctx.clearRect(0,0,width,height)
  if (!options.enabled || !points.length) return
  const matrix = options.mode === 'matrix'
  const elapsed = Math.max(0,time-options.startedAt)
  const assembly = options.reducedMotion ? 1 : 1-Math.pow(1-Math.min(1,elapsed/1200),3)
  if (matrix) {
    // Darken only the video stage. Not a 3D body reconstruction.
    ctx.fillStyle = 'rgba(4,17,16,0.78)'; ctx.fillRect(0,0,width,height)
    ctx.strokeStyle='rgba(111,255,206,0.07)'; ctx.lineWidth=1
    for(let x=0; x<width; x+=32) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,height);ctx.stroke()}
    for(let y=0; y<height; y+=32) {ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(width,y);ctx.stroke()}
    for (const p of cloudTargets(points)) {
      const drift = options.reducedMotion ? 0 : Math.sin(time/650 + p.seed)*0.0015
      const x = mix(noise(p.seed),p.x,assembly)+drift
      const y = mix(noise(p.seed+12),p.y,assembly)+drift
      const depth = Math.max(0.3,Math.min(1,0.7-p.z))
      ctx.fillStyle = `rgba(111,255,206,${depth})`
      ctx.beginPath(); ctx.arc(x*width,y*height,1+depth,0,Math.PI*2); ctx.fill()
    }
    if (!options.reducedMotion) {
      const scan = (time/6500%1)*height
      const gradient = ctx.createLinearGradient(0,scan-20,0,scan+20)
      gradient.addColorStop(0,'rgba(109,255,215,0)'); gradient.addColorStop(.5,'rgba(109,255,215,0.13)'); gradient.addColorStop(1,'rgba(109,255,215,0)')
      ctx.fillStyle=gradient; ctx.fillRect(0,scan-20,width,40)
    }
  }
  ctx.strokeStyle = matrix ? `rgba(153,255,223,${0.25*assembly})` : '#98efd2'
  ctx.lineWidth = matrix ? 1 : 2
  for (const [a,b] of validEdges(points)) {
    const p=points[a],q=points[b]
    ctx.beginPath();ctx.moveTo(p.x*width,p.y*height);ctx.lineTo(q.x*width,q.y*height);ctx.stroke()
  }
  points.slice(0,33).forEach((p,i) => {
    if (!visiblePoint(p)) return
    ctx.fillStyle = i<11 ? '#fff3c4' : '#dcfff3'
    ctx.beginPath();ctx.arc(p.x*width,p.y*height,matrix?2:i<11?2.5:4,0,Math.PI*2);ctx.fill()
  })
}
