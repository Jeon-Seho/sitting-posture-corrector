import { useCallback,useEffect,useRef,useState } from 'react'
import { requestCamera,stopCameraTracks } from '../camera/devices'
import type { FaceObservation } from '../../../../model/prototype/faceMotion'
import type { CameraState } from '../camera/types'
type Listener=(o:FaceObservation|null)=>void
export function useFaceCamera() {
  const videoRef=useRef<HTMLVideoElement>(null),canvasRef=useRef<HTMLCanvasElement>(null)
  const active=useRef(0),worker=useRef<Worker|null>(null),stream=useRef<MediaStream|null>(null),timer=useRef<ReturnType<typeof setInterval>|null>(null)
  const listeners=useRef(new Set<Listener>())
  // Camera processing heartbeat is independent of whether a face was found.
  const lastFrameRef=useRef(0)
  const [state,setState]=useState<CameraState>('off'),[error,setError]=useState(''),[latency,setLatency]=useState(0),[warning,setWarning]=useState(''),[fps,setFps]=useState(0)
  const subscribe=useCallback((listener:Listener)=>{listeners.current.add(listener);return ()=>{listeners.current.delete(listener)}},[])
  const release=useCallback(()=>{
    active.current++; lastFrameRef.current=0; if(timer.current) clearInterval(timer.current);timer.current=null
    worker.current?.terminate();worker.current=null;stopCameraTracks(stream.current);stream.current=null
    if(videoRef.current) videoRef.current.srcObject=null
    const c=canvasRef.current;c?.getContext('2d')?.clearRect(0,0,c.width,c.height)
    for(const listener of listeners.current) listener(null)
  },[])
  const stop=useCallback(()=>{release();setState('off')},[release])
  useEffect(()=>()=>release(),[release])
  const start=async(selectedId?:string)=>{
    release();const generation=active.current;setState('loading');setError('');setWarning('')
    let timeout:ReturnType<typeof setTimeout>|undefined
    try {
      const media=await requestCamera(selectedId)
      if(generation!==active.current) {stopCameraTracks(media);return}
      stream.current=media; const video=videoRef.current;if(!video) throw Error('카메라 화면 준비 실패')
      video.srcObject=media;await video.play();if(generation!==active.current)return
      const detector=new Worker('/face-detector.js');worker.current=detector
      let busy=false,lastFrame=performance.now(),lastVideo=-1,metricStart=performance.now(),frameCount=0
      timeout=setTimeout(()=>{if(generation===active.current){release();setState('error');setError('모델 준비 시간이 초과되었습니다. 카메라를 다시 연결해 주세요.')}},45000)
      detector.onerror=e=>{if(generation===active.current){clearTimeout(timeout);release();setState('error');setError(`얼굴 추적기를 실행하지 못했습니다: ${e.message}`)}}
      detector.onmessage=event=>{
        if(generation!==active.current)return
        const data=event.data
        if(data.type==='ready') {clearTimeout(timeout);setWarning(data.warning);setState('on')}
        if(data.type==='error') {clearTimeout(timeout);release();setState('error');setError(data.message)}
        if(data.type==='frame') {
          busy=false;lastFrame=performance.now();lastFrameRef.current=lastFrame;setLatency(data.durationMs??0)
          frameCount++;if(lastFrame-metricStart>=500){setFps(frameCount*1000/(lastFrame-metricStart));metricStart=lastFrame;frameCount=0}
          if(data.warning)setWarning('추적 오류 · 점수를 유지합니다.')
          const canvas=canvasRef.current,ctx=canvas?.getContext('2d')
          if(canvas&&ctx) {canvas.width=video.videoWidth;canvas.height=video.videoHeight;ctx.clearRect(0,0,canvas.width,canvas.height);ctx.fillStyle='#91b29b';for(const p of data.overlay??[]){ctx.beginPath();ctx.arc(p.x*canvas.width,p.y*canvas.height,4,0,Math.PI*2);ctx.fill()}}
          if(canvas&&ctx&&data.shoulderLine?.length===2){const [left,right]=data.shoulderLine;ctx.strokeStyle='#91b29b';ctx.lineWidth=3;ctx.beginPath();ctx.moveTo(left.x*canvas.width,left.y*canvas.height);ctx.lineTo(right.x*canvas.width,right.y*canvas.height);ctx.stroke()}
          for(const listener of listeners.current)listener(data.observation)
        }
      }
      detector.postMessage({type:'init',base:location.origin})
      timer.current=setInterval(async()=>{
        if(generation!==active.current)return
        if(performance.now()-lastFrame>800)for(const listener of listeners.current)listener(null)
        // Model initialization has not finished yet; no frames queued behind it.
        if(busy||video.readyState<2||video.currentTime===lastVideo||timeout===undefined)return
        // Ready flag is set by the initialization response below.
        if(!ready)return
        busy=true;lastVideo=video.currentTime
        try {const bitmap=await createImageBitmap(video);if(generation!==active.current){bitmap.close();return}detector.postMessage({type:'frame',bitmap,timeMs:performance.now(),width:video.videoWidth,height:video.videoHeight},[bitmap])}
        catch {busy=false;for(const listener of listeners.current)listener(null)}
      },100)
      let ready=false
      const receive=detector.onmessage
      detector.onmessage=e=>{if(e.data.type==='ready')ready=true;receive?.call(detector,e)}
      media.getVideoTracks()[0]?.addEventListener('ended',()=>{if(generation===active.current){release();setState('error');setError('카메라 연결이 끊겼습니다.')}})
    } catch(e) {clearTimeout(timeout);if(generation===active.current){release();setState('error');setError(e instanceof Error?e.message:String(e))}}
  }
  return {videoRef,canvasRef,state,error,warning,latency,fps,start,stop,subscribe,streamRef:stream,lastFrameRef}
}
