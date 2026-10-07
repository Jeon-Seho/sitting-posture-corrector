import { describe, expect, it } from 'vitest'
import { reviewedMetrics, reviewWindow } from './evaluation'
const sequence=()=>Array.from({length:40},()=>{const row=Array(26).fill(0);row[13]=row[14]=row[15]=1;return row})
const times=Array.from({length:40},(_,i)=>i*100)
const decision={state:'평가 보류',score:100,posture:'neutral',activity:'still',bonus:0}
describe('reviewed camera evaluation',()=>{
  it('keeps the measured prediction and decision even after subsequent live changes',()=>{
    const rows=sequence(),p=[.9,.05,.03,.02],a=[.1,.8,.03,.04,.03]
    const w=reviewWindow(rows,times,p,a,'neutral','head_turn',decision,3000)
    rows[0][0]=99;p[0]=0;decision.score=20
    expect(w.sequence[0][0]).toBe(0);expect(w.prediction.postureProbabilities[0]).toBe(.9);expect(w.decision.score).toBe(100)
    expect(reviewedMetrics([w]).activity.errors).toBe(0)
    decision.score=100
  })
  it('counts errors against reviewed labels, and excludes hidden body and hands',()=>{
    const full=reviewWindow(sequence(),times,[1,0,0,0],[1,0,0,0,0],'slouch','head_turn',decision,3000)
    const hidden=sequence();hidden.forEach(row=>{row[13]=row[14]=row[15]=0})
    const missing=reviewWindow(hidden,times,[1,0,0,0],[1,0,0,0,0],'neutral','arm_raise',decision,3000)
    expect(reviewedMetrics([full,missing])).toEqual({windows:2,posture:{evaluated:1,excluded:1,errors:1,errorRate:1},activity:{evaluated:1,excluded:1,errors:1,errorRate:1}})
    expect(reviewedMetrics([]).posture.errorRate).toBeNull()
  })
})
