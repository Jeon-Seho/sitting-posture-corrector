import { useEffect,useRef,useState } from 'react'
import { ACTIVITIES,POSTURES,FACE_FEATURES,FaceDecision,FaceWindow,faceBase,faceInfer,softmax,validateFaceModel,type FaceBaseline,type FaceModel,type FaceObservation,type FaceResult } from '../../../../model/prototype/faceMotion'
import { useFaceCamera } from './useFaceCamera'
import './face.css'
const postureNames=['기준 범위','앞으로 기울기 후보','상체 구부림 후보','머리 기울기 후보']
const activityNames=['머무름','고개 좌우 회전','화면 내 이동','양손 들기 후보','목 움직임 후보']
export default function FaceLabApp() {
  const camera=useFaceCamera()
  const [model,setModel]=useState<FaceModel|null>(null),[modelError,setModelError]=useState('')
  const [baseline,setBaseline]=useState<FaceBaseline|null>(null),[calibrating,setCalibrating]=useState(false),[progress,setProgress]=useState(0)
  const [result,setResult]=useState<FaceResult>({state:'카메라를 연결해 주세요',score:100,posture:'평가 보류',activity:'알 수 없음',bonus:0})
  const [coverage,setCoverage]=useState('미관측'),[probs,setProbs]=useState<number[][]>([]),[holdMs,setHoldMs]=useState(3000),[stretchPoints,setStretchPoints]=useState(0)
  const windowRef=useRef(new FaceWindow()),decision=useRef(new FaceDecision()),calibration=useRef<FaceObservation[]|null>(null)
  const latest=useRef<{sequence:number[][];timesMs:number[]}|null>(null),saved=useRef<unknown[]>([]),captureId=useRef(crypto.randomUUID()),lastSaved=useRef(-Infinity)
  const [count,setCount]=useState(0),[person,setPerson]=useState(''),[posture,setPosture]=useState('neutral'),[activity,setActivity]=useState('still'),[reviewed,setReviewed]=useState(false),[notice,setNotice]=useState('')
  useEffect(()=>{let active=true;fetch('/face-model.json').then(r=>{if(!r.ok)throw Error('얼굴 모델이 없습니다. 얼굴 모델 학습 실행기를 먼저 실행해 주세요.');return r.json()}).then(v=>{if(active)setModel(validateFaceModel(v))}).catch(e=>{if(active)setModelError(String(e.message))});return()=>{active=false}},[])
  useEffect(()=>{
    windowRef.current.reset();latest.current=null;decision.current.pending=null
    return camera.subscribe(o=>{
      setCoverage(o?(o.shoulders?'얼굴 + 어깨':'얼굴만')+(o.hands.every(x=>x!==null)?' + 양손':''):'추적 불가')
      if(calibration.current) {
        if(!o){calibration.current=[];setProgress(0)} else {
          const rows=calibration.current
          if(rows.length&&o.timeMs-rows.at(-1)!.timeMs>350) rows.length=0
          rows.push(o);if(rows.length>40)rows.shift()
          setProgress(Math.min(100,(o.timeMs-rows[0].timeMs)/30))
          const base=faceBase(rows)
          if(base){calibration.current=null;setCalibrating(false);setBaseline(base);setProgress(100)}
        }
        setResult(decision.current.hold('기준 자세 확인 중'));return
      }
      if(!o){windowRef.current.reset();latest.current=null;setProbs([]);setResult(decision.current.hold('추적 불가 · 점수 유지'));return}
      if(!baseline||!model){setResult(decision.current.hold('기준 등록과 모델 준비가 필요합니다'));return}
      const rows=windowRef.current.push(o,baseline)
      if(!rows){latest.current=null;setResult(decision.current.hold('최근 움직임 확인 중'));return}
      latest.current={sequence:rows,timesMs:[...windowRef.current.times]}
      const raw=faceInfer(model,rows),p=softmax(raw.posture),a=softmax(raw.activity);setProbs([p,a])
      const next=decision.current.evaluate(o,baseline,p,a,holdMs);setResult(next)
      if(next.bonus)setStretchPoints(v=>v+next.bonus)
    })
  },[baseline,model,camera.subscribe,holdMs])
  const calibrate=()=>{calibration.current=[];setCalibrating(true);setProgress(0);setBaseline(null);windowRef.current.reset();decision.current.reset();setStretchPoints(0);captureId.current=crypto.randomUUID();saved.current=[];setCount(0);lastSaved.current=-Infinity;latest.current=null}
  const start=()=>{calibrate();void camera.start()}
  const save=()=>{
    const value=latest.current
    if(!/^[A-Za-z0-9_-]{2,40}$/.test(person)){setNotice('실명 대신 영문·숫자로 참여자 코드를 입력해 주세요.');return}
    if(!reviewed||!value){setNotice('최근 4초 동작을 확인하고 라벨 확인을 체크해 주세요.');return}
    if(value.timesMs[0]<=lastSaved.current){setNotice('이전 자료와 겹칩니다. 4초 후 다시 저장해 주세요.');return}
    if(saved.current.length>=300){setNotice('자료를 내려받고 새 기준을 등록해 주세요.');return}
    saved.current.push({...value,posture,activity,reviewed:true});lastSaved.current=value.timesMs.at(-1)!;setCount(saved.current.length);setReviewed(false);setNotice('좌표 특징을 이 창에 저장했습니다. 영상은 저장하지 않습니다.')
  }
  const download=()=>{
    if(!count)return
    const text=JSON.stringify({schema:'face-motion-capture-v2',synthetic:false,participantCode:person,captureId:captureId.current,features:FACE_FEATURES,windows:saved.current})
    const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`face-motion-${captureId.current}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
  }
  const demo=(index:number)=>{
    camera.stop();calibration.current=null;setCalibrating(false);setBaseline(null)
    const probe=(model as FaceModel & {probes?: {sequence:number[][];postureLabel:number;activityLabel:number}[]})?.probes?.[index]
    if(!model||!probe)return
    const output=faceInfer(model,probe.sequence),p=softmax(output.posture),a=softmax(output.activity);setProbs([p,a]);setCoverage('제작 데이터 재생')
    setResult({state:'제작 시퀀스 분류 · 실카메라 아님',score:decision.current.score,posture:POSTURES[p.indexOf(Math.max(...p))],activity:ACTIVITIES[a.indexOf(Math.max(...a))],bonus:0})
  }
  return <main className="face-lab">
    <header><div><small>POSEGOOD · GP-0125</small><h1>얼굴부터, 자연스럽게.</h1><p>얼굴 회전과 자세 변화를 따로 살펴보는 0.2.0 실험</p></div><span className="face-tag">0.2.0 · {!model?'모델 준비 중':model.synthetic?'제작 데이터 학습':'검토 자료 학습'}</span></header>
    <div className="face-grid"><section className="face-card"><div className="face-camera"><video ref={camera.videoRef} autoPlay muted playsInline/><canvas ref={camera.canvasRef}/><span>{coverage}</span></div>
      <div className="face-controls"><button disabled={camera.state==='loading'} onClick={start}>{camera.state==='loading'?'추적기 준비 중…':'카메라 연결'}</button><button disabled={camera.state!=='on'} onClick={calibrate}>기준 다시 등록</button><button onClick={camera.stop}>정지</button></div>
      {calibrating&&<p>편안한 기준 자세를 잠시 유지해 주세요. {Math.round(progress)}%</p>}
      {camera.error&&<p role="alert">{camera.error}</p>}{camera.warning&&<p>{camera.warning}</p>}{modelError&&<p role="alert">{modelError}</p>}
      <p className="face-note">어깨가 안 보여도 얼굴 추적은 이어집니다. 몸 자세를 판단할 근거가 부족하면 점수를 유지합니다.</p>
    </section><section className="face-card face-status"><small>현재 관측</small><h2>{result.state}</h2><div className="face-score">{Math.round(result.score)}<span> / 100</span></div><p>{activityNames[ACTIVITIES.indexOf(result.activity as typeof ACTIVITIES[number])]??result.activity}</p><p>{postureNames[POSTURES.indexOf(result.posture as typeof POSTURES[number])]??result.posture}</p>
      <label>변화 유지 시간 <select value={holdMs} onChange={e=>setHoldMs(Number(e.target.value))}><option value={2000}>2초</option><option value={3000}>3초</option><option value={5000}>5초</option></select></label>
      <p>스트레칭 후보 보너스 +{stretchPoints}</p>
      {probs.length>0&&<details><summary>모델 출력 보기</summary><p>자세 {probs[0].map(x=>x.toFixed(2)).join(' · ')}</p><p>움직임 {probs[1].map(x=>x.toFixed(2)).join(' · ')}</p></details>}
      <p className="face-note">추적 {camera.latency.toFixed(0)}ms / 프레임 · 양손 들기는 스트레칭 후보입니다. 얼굴만으로 거북목·몸 구부림을 확정하지 않습니다.</p>
    </section></div>
    <section className="face-card"><h2>동작 확인</h2><div className="face-controls">{['머무름','고개 회전','위치 이동','양손 들기','목 움직임','앞으로 기울기','상체 구부림','머리 기울기'].map((label,i)=><button key={label} disabled={!model} onClick={()=>demo(i)}>{label}</button>)}</div><p className="face-note">제작 시퀀스로 분류를 확인합니다. 실제 사용 성능은 카메라 테스트로 확인해야 합니다.</p></section>
    <details className="face-card"><summary>오판 자료를 직접 확인해서 남기기 ({count}개)</summary><p>원할 때만 최근 4초의 특징 좌표를 저장합니다. 자동 업로드·즉시 재학습은 하지 않습니다.</p><div className="face-controls"><input aria-label="참여자 코드" placeholder="익명 참여자 코드" value={person} disabled={count>0} onChange={e=>setPerson(e.target.value)}/><select aria-label="실제 자세" value={posture} onChange={e=>setPosture(e.target.value)}>{POSTURES.map((v,i)=><option key={v} value={v}>{postureNames[i]}</option>)}</select><select aria-label="실제 움직임" value={activity} onChange={e=>setActivity(e.target.value)}>{ACTIVITIES.map((v,i)=><option key={v} value={v}>{activityNames[i]}</option>)}</select><label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/>최근 동작의 라벨을 확인했어요</label><button onClick={save}>자료 남기기</button><button disabled={!count} onClick={download}>JSON 내려받기</button></div><p>{notice}</p></details>
  </main>
}
