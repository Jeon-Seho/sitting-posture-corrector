import { rotationFromMatrix, type FaceObservation } from './faceMotion'
export interface Point { x: number; y: number; z?: number; visibility?: number; presence?: number }
export function faceObservation(timeMs:number,face:Point[][],matrices:number[][],pose:Point[][],width:number,height:number):FaceObservation|null {
  if(face.length!==1||matrices.length!==1||width<=0||height<=0||!Number.isFinite(timeMs)) return null
  const landmarks=face[0], top=landmarks[10], chin=landmarks[152]
  const inside=(p:Point|undefined):p is Point=>!!p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>.01&&p.x<.99&&p.y>.01&&p.y<.99
  if(![top,chin,landmarks[33],landmarks[263]].every(inside)) return null
  const rotation=rotationFromMatrix(matrices[0]); if(!rotation) return null
  const center=[(top.x+chin.x)*width/2,(top.y+chin.y)*height/2]
  const size=Math.hypot((top.x-chin.x)*width,(top.y-chin.y)*height)
  if(size<55||size>height*.9) return null
  const points=pose.length===1?pose[0]:[]
  // Web NormalizedLandmark exposes visibility, not per-landmark presence.
  // Task-wide minPosePresenceConfidence is configured in the detector instead.
  const reliable=(p:Point|undefined):p is Point=>inside(p)&&(p.visibility??0)>=.75&&(p.presence===undefined||p.presence>=.75)
  // Reject a body belonging to another person instead of mixing face and wrist observations.
  const nose=points[0]
  const associated=reliable(nose)&&Math.hypot(nose.x*width-center[0],nose.y*height-center[1])<size*.8
  const l=points[11],r=points[12]
  let shoulders:FaceObservation['shoulders']=null
  if(associated&&reliable(l)&&reliable(r)) {
    const span=Math.hypot((l.x-r.x)*width,(l.y-r.y)*height)
    if(span>size*.8&&span<width*.95) shoulders={gap:(center[1]-(l.y+r.y)*height/2)/span,offset:(center[0]-(l.x+r.x)*width/2)/span,roll:Math.atan2((r.y-l.y)*height,Math.abs(r.x-l.x)*width),width:span}
  }
  const hand=(index:number)=>associated&&reliable(points[index])?(points[index].y*height-center[1])/size:null
  return {timeMs,rotation,center,size,shoulders,hands:[hand(15),hand(16)]}
}
