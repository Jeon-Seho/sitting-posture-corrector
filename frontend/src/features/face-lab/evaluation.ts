import { ACTIVITIES, POSTURES, type FaceResult } from '../../../../model/prototype/faceMotion'

export interface FaceBuild {
  appVersion: string; buildId: string; builtAt: string; sourceCommit: string
  workingTreeModified: boolean; modelSha256: string; modelSchema: number; synthetic: boolean
}
export interface ReviewedWindow {
  sequence: number[][]; timesMs: number[]; posture: string; activity: string; reviewed: true
  prediction: { posture: string; activity: string; postureProbabilities: number[]; activityProbabilities: number[] }
  decision: FaceResult; holdMs: number
}
export function reviewWindow(sequence:number[][],timesMs:number[],p:number[],a:number[],posture:string,activity:string,decision:FaceResult,holdMs:number): ReviewedWindow {
  return { sequence:sequence.map(row=>[...row]), timesMs:[...timesMs], posture, activity, reviewed:true,
    prediction:{posture:POSTURES[p.indexOf(Math.max(...p))],activity:ACTIVITIES[a.indexOf(Math.max(...a))],postureProbabilities:[...p],activityProbabilities:[...a]}, decision:{...decision}, holdMs }
}
// Conservative coverage exclusions. These are reviewed-window classifier errors,
// not alarm errors/hour, clinical posture accuracy, or a population estimate.
export function reviewedMetrics(windows:ReviewedWindow[]) {
  const metric=(kind:'posture'|'activity')=>{
    const observed=windows.filter(w=>kind==='posture'
      ? w.posture==='tilt'||w.sequence.slice(-10).every(row=>row[13]===1)
      : w.activity!=='arm_raise'||w.sequence.slice(-10).every(row=>row[14]===1&&row[15]===1))
    const errors=observed.filter(w=>w[kind]!==w.prediction[kind]).length
    return { evaluated:observed.length, excluded:windows.length-observed.length, errors, errorRate:observed.length?errors/observed.length:null }
  }
  return { windows:windows.length, posture:metric('posture'), activity:metric('activity') }
}
