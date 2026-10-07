import { useCallback, useEffect, useRef, useState } from 'react'
import { faceBase, type FaceObservation, type FaceModel } from '../../../../model/prototype/faceMotion'
import type { Features } from '../../../../model/prototype/pose'
import type { CameraController } from '../../hooks/useCamera'
import type { VisualMode, VisualOptions } from '../../lib/poseVisual'
import { listVideoDevices } from '../camera/devices'
import { useFaceCamera } from './useFaceCamera'
import { FaceServiceInput } from './serviceInput'
import { loadFacePackage } from './loadPackage'
import type { FaceBuild } from './evaluation'

// Legacy feature fields only support local readiness/UI. They are never fed to the old rules,
// old collection exporter or server inference when this controller is selected.
const localFeatures=(o:FaceObservation):Features=>({headGap:-(o.shoulders?.gap??0),offset:o.shoulders?.offset??0,tilt:o.shoulders?.roll??0,quality:1})
export function useServiceFaceCamera():CameraController {
  const camera=useFaceCamera(),input=useRef(new FaceServiceInput()),model=useRef<FaceModel|null>(null)
  const [build,setBuild]=useState<FaceBuild|null>(null),[modelError,setModelError]=useState('')
  const [quality,setQuality]=useState(false),[baseline,setBaseline]=useState<Features|null>(null),[progress,setProgress]=useState<number|null>(null)
  const [calibrationId,setCalibrationId]=useState<string|null>(null),[devices,setDevices]=useState<MediaDeviceInfo[]>([]),[deviceId,setDeviceId]=useState('')
  const [visual,setVisual]=useState<VisualOptions>({mode:'skeleton',enabled:true,reducedMotion:false,startedAt:0})
  const current=useRef<Features|null>(null),lastFrame=camera.lastFrameRef,lastObservation=useRef<FaceObservation|null>(null),draft=useRef<FaceObservation[]|null>(null)
  const [notice,setNotice]=useState('얼굴 모델 준비 중')
  useEffect(()=>{let active=true;loadFacePackage().then(v=>{if(active){model.current=v.model;setBuild(v.build)}}).catch(e=>{if(active)setModelError(e.message)});return()=>{active=false}},[])
  useEffect(()=>camera.subscribe(o=>{
    lastObservation.current=o;current.current=o?.shoulders?localFeatures(o):null
    setQuality(!!o&&!!model.current)
    if(draft.current){
      if(!o){draft.current=[];setProgress(0)}else{
        const rows=draft.current
        if(rows.length&&o.timeMs-rows.at(-1)!.timeMs>350)rows.length=0
        rows.push(o);if(rows.length>40)rows.shift()
        const elapsed=o.timeMs-rows[0].timeMs;setProgress(Math.min(1,elapsed/3000))
        const ready=elapsed>=3000?faceBase(rows):null
        if(ready){input.current.setBaseline(ready);setBaseline(localFeatures(o));setCalibrationId(crypto.randomUUID());draft.current=null;setProgress(null)}
      }
      input.current.hold('얼굴 기준 자세 확인 중')
    }else input.current.update(o,model.current)
    setNotice(input.current.result.state)
  }),[camera.subscribe])
  const stop=useCallback(()=>{camera.stop();draft.current=null;input.current=new FaceServiceInput();setQuality(false);setBaseline(null);setCalibrationId(null);setProgress(null);lastFrame.current=0},[camera.stop])
  const connect=useCallback(async(selectedId?:string)=>{
    if(!model.current){setModelError('얼굴 모델을 준비한 뒤 다시 연결해 주세요.');return}
    setModelError('');stop();await camera.start(selectedId)
    setDevices(await listVideoDevices());setDeviceId(camera.streamRef.current?.getVideoTracks()[0]?.getSettings().deviceId??'')
  },[stop,camera.start,camera.streamRef])
  const calibrate=()=>{if(camera.state==='on'&&lastObservation.current&&model.current&&!draft.current){draft.current=[];setProgress(0)}}
  const cancelCalibration=()=>{draft.current=null;setProgress(null)}
  const setOverlayEnabled=useCallback((enabled:boolean)=>setVisual(v=>({...v,enabled})),[])
  return {visual,setVisualMode:(mode:VisualMode)=>setVisual(v=>({...v,mode})),reassemble:()=>setVisual(v=>({...v,startedAt:performance.now()})),setReducedMotion:(reducedMotion:boolean)=>setVisual(v=>({...v,reducedMotion})),setOverlayEnabled,
    metrics:{fps:camera.fps,inferenceMs:camera.latency,delegate:'CPU'},subscribe:()=>()=>{},videoRef:camera.videoRef,canvasRef:camera.canvasRef,streamRef:camera.streamRef,
    devices,deviceId,state:camera.state,error:modelError||camera.error||camera.warning,quality,baseline,calibrationId,calibrationSummary:null,progress,current,lastFrame,connect,stop,calibrate,cancelCalibration,
    face:{sample:()=>input.current.sample,score:()=>input.current.decision.score,bonus:()=>input.current.bonusTotal,setPolicy:(phase,holdMs)=>input.current.setPolicy(phase,holdMs),buildVersion:build?.appVersion??'준비 중',modelSha:build?.modelSha256??'',notice,
      diagnostics:()=>({frames:input.current.window.rows.length,inferences:input.current.inferences,posture:input.current.result.posture,activity:input.current.result.activity,scope:input.current.result.scope,shouldersObserved:!!lastObservation.current?.shoulders,shoulderBaseline:!!input.current.baseline?.shoulders})}}
}
