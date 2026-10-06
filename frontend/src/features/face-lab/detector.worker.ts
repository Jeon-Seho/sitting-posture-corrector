import { FaceLandmarker, PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'
import { faceObservation } from '../../../../model/prototype/faceObservation'
import poseAsset from '../../../model-asset.json'
let face:FaceLandmarker|null=null,pose:PoseLandmarker|null=null
const scope=self as unknown as {onmessage:((e:MessageEvent)=>void)|null;postMessage:(v:unknown)=>void}
scope.onmessage=async event=>{
  if(event.data.type==='init') {
    try {
      const base=event.data.base as string
      const vision=await FilesetResolver.forVisionTasks(`${base}/mediapipe/wasm`)
      face=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${base}/mediapipe/face_landmarker.task`,delegate:'CPU'},runningMode:'VIDEO',numFaces:2,outputFacialTransformationMatrixes:true,minFaceDetectionConfidence:.65,minFacePresenceConfidence:.65,minTrackingConfidence:.65})
      let warning=''
      try { pose=await PoseLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:`${base}/mediapipe/${poseAsset.filename}`,delegate:'CPU'},runningMode:'VIDEO',numPoses:1,minPoseDetectionConfidence:.65,minPosePresenceConfidence:.65,minTrackingConfidence:.65}) }
      catch { warning='상체 모델을 준비하지 못해 얼굴만 추적합니다.' }
      scope.postMessage({type:'ready',warning})
    } catch(e) { scope.postMessage({type:'error',message:String(e)}) }
    return
  }
  const {bitmap,timeMs,width,height}=event.data
  if(!(bitmap instanceof ImageBitmap)) return
  try {
    const start=performance.now()
    if(!face) throw Error('Face detector not ready')
    const f=face.detectForVideo(bitmap,timeMs)
    const p=pose?.detectForVideo(bitmap,timeMs)
    const observation=faceObservation(timeMs,f.faceLandmarks,f.facialTransformationMatrixes.map(m=>m.data),p?.landmarks??[],width,height)
    const overlay=observation ? [...[10,152,33,263,1].map(i=>f.faceLandmarks[0][i]),...(observation.shoulders?[p!.landmarks[0][11],p!.landmarks[0][12]]:[])] : []
    scope.postMessage({type:'frame',observation,overlay,durationMs:performance.now()-start})
  } catch(e) { scope.postMessage({type:'frame',observation:null,overlay:[],warning:String(e)}) }
  finally { bitmap.close() }
}
