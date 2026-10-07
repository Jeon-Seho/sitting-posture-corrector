import { FaceDecision, FaceWindow, faceInfer, softmax, type FaceBaseline, type FaceModel, type FaceObservation, type FaceResult } from '../../../../model/prototype/faceMotion'
import { sampleAt, type Sample, type SessionPhase } from '../../lib/engine'

export interface FaceServiceController {
  sample: () => Sample
  score: () => number
  bonus: () => number
  setPolicy: (phase:SessionPhase|'inactive',holdMs:number) => void
  buildVersion: string
  modelSha: string
  notice: string
  diagnostics?: () => {frames:number;inferences:number;posture:string;activity:string;scope?:string;shouldersObserved?:boolean;shoulderBaseline?:boolean}
}
export function faceServiceSample(result:FaceResult,p:number[]):Sample {
  const base=sampleAt(0),candidate=['지속 변화 확인 중','지속 자세 변화','머리 기울기 확인 중 · 상체 제외','지속 머리 기울기 · 상체 제외'].includes(result.state)
  const good=result.state==='기준 범위 · 상체 관측'||result.state==='머리 각도 기준 범위 · 상체 제외'
  // Head-only time is explicitly scoped and never interpreted as upper-body time.
  return {...base,state:candidate?'collapse':good?'good':'unknown',collapse:candidate?(result.posture==='tilt'?'tilt':'forwardHead'):null,
    prob:candidate?1:0,confidence:candidate||good?Math.max(...p):0,notice:result.state,
    ...(result.scope==='head'||result.scope==='upper_body'?{evaluationScope:result.scope}: {})}
}
/** The model owns input/score; the existing session machine owns alerts and record timing. */
export class FaceServiceInput {
  window=new FaceWindow(); decision=new FaceDecision(); baseline:FaceBaseline|null=null
  phase:SessionPhase|'inactive'='inactive'; holdMs=3000; bonusTotal=0
  result:FaceResult=this.decision.hold('얼굴 모델 준비 중')
  sample:Sample=faceServiceSample(this.result,[0,0,0,0])
  inferences=0
  setBaseline(base:FaceBaseline) { this.baseline=base;this.window.reset();this.decision.reset();this.bonusTotal=0;this.inferences=0;this.hold('얼굴 움직임 분석 준비 · 입력 0/40') }
  setPolicy(phase:SessionPhase|'inactive',holdMs:number) {
    if(phase==='running'&&(this.phase==='inactive'||this.phase==='ended')){this.decision.reset();this.bonusTotal=0}
    if(phase!==this.phase)this.decision.hold()
    this.phase=phase;this.holdMs=holdMs
  }
  hold(notice:string) {this.result=this.decision.hold(notice);this.sample=faceServiceSample(this.result,[0,0,0,0]);return this.sample}
  update(o:FaceObservation|null,model:FaceModel|null) {
    if(!o){this.window.reset();return this.hold('추적 불가 · 점수 유지')}
    if(!this.baseline||!model)return this.hold('얼굴 기준 등록과 모델 준비가 필요합니다')
    const rows=this.window.push(o,this.baseline)
    // A frame skipped by the 10 Hz sampler is not a tracking loss. Preserve the
    // completed prediction and its continuous hold instead of restarting them.
    if(!rows&&this.window.rows.length===40)return this.sample
    if(!rows){
      const evaluator=this.phase==='running'?this.decision:new FaceDecision()
      const reference=evaluator.evaluateReference(o,this.baseline)
      this.result=this.phase==='running'?reference:{...reference,score:this.decision.score,bonus:0}
      this.sample=faceServiceSample(this.result,[0,0,0,0]);return this.sample
    }
    const raw=faceInfer(model,rows),p=softmax(raw.posture),a=softmax(raw.activity)
    this.inferences++
    const evaluator=this.phase==='running'?this.decision:new FaceDecision()
    const preview=evaluator.evaluate(o,this.baseline,p,a,this.holdMs)
    this.result=this.phase==='running'?preview:{...preview,score:this.decision.score,bonus:0}
    this.bonusTotal+=this.result.bonus
    this.sample=faceServiceSample(this.result,p)
    return this.sample
  }
}
