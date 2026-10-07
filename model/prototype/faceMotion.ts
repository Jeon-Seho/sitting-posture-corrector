/** GP-0125: research-only face motion features; independent of service contracts. */
export const POSTURES = ['neutral', 'forward', 'slouch', 'tilt'] as const
export const ACTIVITIES = ['still', 'head_turn', 'translation', 'arm_raise', 'neck_motion'] as const
export const FACE_FEATURES = ['r00','r10','r20','r01','r11','r21','faceScale','headGap','headOffset','shoulderRoll','shoulderScale','leftHandY','rightHandY','shouldersMask','leftHandMask','rightHandMask','dr00','dr10','dr20','dr01','dr11','dr21','gapVelocity','offsetVelocity','centerVX','centerVY']
export type Rotation = number[]
export interface FaceObservation {
  timeMs: number; rotation: Rotation; center: number[]; size: number
  shoulders: { gap: number; offset: number; roll: number; width: number } | null
  hands: [number | null, number | null]
}
export interface FaceBaseline { rotation: Rotation; size: number; shoulders: FaceObservation['shoulders'] }
export interface FaceModel {
  version: 2; synthetic: boolean; frames: number; features: string[]; mean: number[]; scale: number[]
  postures: string[]; activities: string[]; dilations: number[]; channels: number[]
  weights: Record<string, unknown>; probe: { sequence: number[][]; posture: number[]; activity: number[] }
}
export function relativeRotation(current: Rotation, baseline: Rotation): Rotation {
  return Array.from({ length: 9 }, (_, n) => {
    const row = Math.floor(n / 3), col = n % 3
    return [0,1,2].reduce((v, k) => v + baseline[k * 3 + row] * current[k * 3 + col], 0)
  })
}
export function rotation6(r: Rotation) { return [r[0], r[3], r[6], r[1], r[4], r[7]] }
export function rotationFromMatrix(data: number[]): Rotation | null {
  // MediaPipe Face Geometry MatrixData uses COLUMN_MAJOR packed data.
  if (data.length !== 16 || !data.every(Number.isFinite)) return null
  const r = Array.from({ length: 9 }, (_, n) => data[(n % 3) * 4 + Math.floor(n / 3)])
  for (let c = 0; c < 3; c++) {
    const norm = Math.hypot(r[c], r[c+3], r[c+6]); if (norm < .001) return null
    for (let row = 0; row < 3; row++) r[row*3+c] /= norm
  }
  const det = r[0]*(r[4]*r[8]-r[5]*r[7])-r[1]*(r[3]*r[8]-r[5]*r[6])+r[2]*(r[3]*r[7]-r[4]*r[6])
  if (Math.abs(det-1) > .1) return null
  return r
}
export function faceBase(rows: FaceObservation[]): FaceBaseline | null {
  if (rows.length < 20 || rows.at(-1)!.timeMs - rows[0].timeMs < 2500) return null
  const median = (x: number[]) => [...x].sort((a,b)=>a-b)[Math.floor(x.length/2)]
  const center = rows[Math.floor(rows.length/2)]
  if (rows.some(r => {
    const rotation=relativeRotation(r.rotation,center.rotation)
    return Math.acos(Math.max(-1,Math.min(1,(rotation[0]+rotation[4]+rotation[8]-1)/2))) > .22 || Math.abs(r.size / center.size - 1) > .15
  })) return null
  const shoulders = rows.filter(r => r.shoulders).map(r => r.shoulders!)
  return { rotation: center.rotation, size: median(rows.map(r => r.size)), shoulders: shoulders.length >= rows.length*.8 ? {
    gap: median(shoulders.map(r=>r.gap)), offset: median(shoulders.map(r=>r.offset)), roll: median(shoulders.map(r=>r.roll)), width: median(shoulders.map(r=>r.width)),
  } : null }
}
export function faceFeatures(o: FaceObservation, b: FaceBaseline, previous: FaceObservation | null): number[] {
  const r = rotation6(relativeRotation(o.rotation, b.rotation))
  const p = previous ? rotation6(relativeRotation(previous.rotation, b.rotation)) : r
  const dt = previous ? (o.timeMs-previous.timeMs)/1000 : 0
  const velocity = dt > 0 && dt <= .35
  const s = o.shoulders && b.shoulders ? o.shoulders : null
  const ps = previous?.shoulders && s ? previous.shoulders : null
  return [...r, Math.log(o.size/b.size), s ? s.gap-b.shoulders!.gap : 0, s ? s.offset-b.shoulders!.offset : 0,
    s ? s.roll-b.shoulders!.roll : 0, s ? Math.log(s.width/b.shoulders!.width) : 0,
    o.hands[0] ?? 0, o.hands[1] ?? 0, s ? 1 : 0, o.hands[0] === null ? 0 : 1, o.hands[1] === null ? 0 : 1,
    ...r.map((v,i)=>velocity ? (v-p[i])/dt : 0), velocity && s && ps ? (s.gap-ps.gap)/dt : 0,
    velocity && s && ps ? (s.offset-ps.offset)/dt : 0,
    velocity ? (o.center[0]-previous!.center[0])/o.size/dt : 0, velocity ? (o.center[1]-previous!.center[1])/o.size/dt : 0]
}
export class FaceWindow {
  rows: number[][] = []; times: number[] = []; previous: FaceObservation | null = null
  reset() { this.rows=[]; this.times=[]; this.previous=null }
  push(o: FaceObservation | null, b: FaceBaseline) {
    if (!o) { this.reset(); return null }
    if (this.previous && (o.timeMs <= this.previous.timeMs || o.timeMs-this.previous.timeMs > 350)) this.reset()
    if (this.previous && o.timeMs-this.previous.timeMs < 95) return null
    const row=faceFeatures(o,b,this.previous); this.previous=o
    if (!row.every(Number.isFinite)) { this.reset(); return null }
    this.rows.push(row); this.times.push(o.timeMs)
    if (this.rows.length>40) { this.rows.shift(); this.times.shift() }
    return this.rows.length===40 ? this.rows.map(r=>[...r]) : null
  }
}
export function validateFaceModel(v: unknown): FaceModel {
  const m=v as FaceModel
  const vector=(v: unknown,n:number): v is number[] => Array.isArray(v)&&v.length===n&&v.every(Number.isFinite)
  const matrix=(v:unknown,r:number,c:number)=>Array.isArray(v)&&v.length===r&&v.every(x=>vector(x,c))
  if (!m || m.version!==2 || typeof m.synthetic!=='boolean' || m.frames!==40 ||
    JSON.stringify(m.features)!==JSON.stringify(FACE_FEATURES) || JSON.stringify(m.postures)!==JSON.stringify(POSTURES) ||
    JSON.stringify(m.activities)!==JSON.stringify(ACTIVITIES) || JSON.stringify(m.dilations)!=='[1,2,4]' ||
    JSON.stringify(m.channels)!=='[26,24,24,24]' || !vector(m.mean,26) || !vector(m.scale,26) || m.scale.some(x=>x<=0) || !m.weights) throw Error('얼굴 모델 형식이 맞지 않습니다.')
  for (let l=0;l<3;l++) {
    const w=m.weights[`convs.${l}.weight`]
    if (!Array.isArray(w)||w.length!==24||!w.every(row=>matrix(row,m.channels[l],3))||!vector(m.weights[`convs.${l}.bias`],24)) throw Error('시간 모델 가중치 오류')
  }
  for (const [key,n] of [['posture',4],['activity',5]] as const)
    if (!matrix(m.weights[`${key}.weight`],n,24)||!vector(m.weights[`${key}.bias`],n)) throw Error('분류기 가중치 오류')
  return m
}
export function faceInfer(m: FaceModel, sequence: number[][]) {
  if (sequence.length!==40||sequence.some(r=>r.length!==26||!r.every(Number.isFinite))) throw Error('얼굴 입력 오류')
  let rows=sequence.map(r=>r.map((v,i)=>(v-m.mean[i])/m.scale[i]))
  for (let l=0;l<3;l++) {
    const w=m.weights[`convs.${l}.weight`] as number[][][], b=m.weights[`convs.${l}.bias`] as number[]
    const input=rows, d=m.dilations[l]
    rows=input.map((_,t)=>w.map((filter,out)=>{
      let sum=b[out]
      for (let c=0;c<filter.length;c++) for (let k=0;k<3;k++) { const at=t+(k-2)*d; if(at>=0) sum+=filter[c][k]*input[at][c] }
      return Math.max(0,sum)
    }))
  }
  const pooled=Array.from({length:24},(_,c)=>rows.slice(-10).reduce((s,r)=>s+r[c],0)/10)
  const head=(name:string)=>(m.weights[`${name}.weight`] as number[][]).map((w,i)=>w.reduce((s,v,c)=>s+v*pooled[c],(m.weights[`${name}.bias`] as number[])[i]))
  return {posture:head('posture'),activity:head('activity')}
}
export function softmax(x:number[]) { const e=x.map(v=>Math.exp(v-Math.max(...x))); return e.map(v=>v/e.reduce((s,x)=>s+x,0)) }
export interface FaceResult { state: string; score: number; posture: string; activity: string; bonus: number; scope?:'head'|'upper_body'|'unavailable' }
/** Safety policy remains separate from classifier: unavailable evidence never becomes normal. */
export class FaceDecision {
  score=100; pending:number|null=null; previous:number|null=null; raisedAt:number|null=null; lastBonus=-Infinity; previousScope:string|null=null
  reset() { this.score=100; this.pending=null; this.previous=null; this.raisedAt=null; this.lastBonus=-Infinity; this.previousScope=null }
  hold(state='추적 확인 중'): FaceResult { this.pending=null; this.previous=null; this.raisedAt=null; this.previousScope=null; return {state,score:this.score,posture:'평가 보류',activity:'알 수 없음',bonus:0,scope:'unavailable'} }
  // Current observed geometry can assess the registered head reference while a
  // fresh temporal window fills. No posture/action logits or bonuses invented.
  evaluateReference(o:FaceObservation,b:FaceBaseline):FaceResult {
    const result=this.evaluate({...o,shoulders:null,hands:[null,null]},b,[0,0,0,0],[0,0,0,0,0])
    return {...result,posture:'모델 분석 준비',activity:'모델 분석 준비'}
  }
  evaluate(o:FaceObservation,b:FaceBaseline,p:number[],a:number[],holdMs=3000):FaceResult {
    const gap=this.previous===null?0:o.timeMs-this.previous
    if (this.previous!==null && (gap<=0||gap>350)) this.hold()
    const elapsed=gap>0&&gap<=350?gap/1000:0; this.previous=o.timeMs
    const pi=p.indexOf(Math.max(...p)), ai=a.indexOf(Math.max(...a))
    const r=relativeRotation(o.rotation,b.rotation)
    const yaw=Math.abs(Math.atan2(r[2],r[8])), roll=Math.abs(Math.atan2(r[3],r[4]))
    const pitch=Math.abs(Math.atan2(-r[5],Math.hypot(r[3],r[4])))
    const s=o.shoulders&&b.shoulders
    let state='기준 범위 · 얼굴 관측', bonus=0, scope:'head'|'upper_body'|'unavailable'='unavailable'
    const currentScope=s?'upper_body':'head'
    if(this.previousScope!==null&&this.previousScope!==currentScope){this.pending=null;this.raisedAt=null}
    this.previousScope=currentScope
    const result=()=>({state,score:this.score,posture:POSTURES[pi],activity:ACTIVITIES[ai],bonus,scope})
    if (yaw>.32) { this.pending=null; this.raisedAt=null; state='고개 회전 · 감점 보류'; return result() }
    const bothRaised=o.hands.every(v=>v!==null&&v<-.65)
    const bodyEvidence=!!s&&(Math.abs(o.shoulders!.gap-b.shoulders!.gap)>.12||Math.abs(o.shoulders!.offset-b.shoulders!.offset)>.15)
    if (bothRaised&&a[3]>.75&&p[0]>.75&&!bodyEvidence&&pitch<.25&&roll<.25) {
      this.pending=null; this.raisedAt??=o.timeMs; state='양손 들기 · 스트레칭 후보'
      if(o.timeMs-this.raisedAt>=2000&&o.timeMs-this.lastBonus>=60000) { bonus=2; this.score=Math.min(100,this.score+bonus); this.lastBonus=o.timeMs }
      return result()
    }
    this.raisedAt=null
    if (ai===4&&a[4]>.75) { this.pending=null; state='목 움직임 · 감점 보류'; return result() }
    // Face-only observations can assess the registered head angle, not torso
    // position. Forward/slouch logits without shoulders are not head labels.
    if (!s) {
      if(pitch>.25){this.pending=null;state='머리 각도 변화 · 해석 보류';return result()}
      if(roll>.22){
        if(pi!==3||p[3]<.8){this.pending=null;state='머리 기울기 근거 확인 중 · 감점 보류';return result()}
        scope='head';this.pending??=o.timeMs;state='머리 기울기 확인 중 · 상체 제외'
        if(o.timeMs-this.pending>=holdMs){state='지속 머리 기울기 · 상체 제외';this.score=Math.max(0,this.score-2*elapsed)}
      }else{
        scope='head';this.pending=null;state='머리 각도 기준 범위 · 상체 제외';this.score=Math.min(100,this.score+elapsed)
      }
      return result()
    }
    if (Math.max(...p)<.8) { this.pending=null; state='불확실 · 감점 보류'; return result() }
    const evidence=pi===1?bodyEvidence&&Math.log(o.size/b.size)>.08:pi===2?bodyEvidence:pi===3?roll>.22:false
    if(pi!==0&&evidence) {
      scope='upper_body'
      this.pending??=o.timeMs; state='지속 변화 확인 중'
      if(o.timeMs-this.pending>=holdMs) { state='지속 자세 변화'; this.score=Math.max(0,this.score-2*elapsed) }
    } else { this.pending=null; state=pi===0?'기준 범위 · 상체 관측':'추가 근거 부족 · 감점 보류'; if(pi===0){scope='upper_body';this.score=Math.min(100,this.score+elapsed)} }
    return result()
  }
}
