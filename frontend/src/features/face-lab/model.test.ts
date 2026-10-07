import {describe,it,expect} from 'vitest'
import {existsSync,readFileSync} from 'node:fs'
import {FaceDecision,FaceWindow,faceFeatures,faceBase,faceInfer,rotationFromMatrix,relativeRotation,validateFaceModel,type FaceObservation,type FaceBaseline} from '../../../../model/prototype/faceMotion'
import {faceObservation} from '../../../../model/prototype/faceObservation'
const identity=[1,0,0,0,1,0,0,0,1]
const base:FaceBaseline={rotation:identity,size:150,shoulders:{gap:-.65,offset:0,roll:0,width:260}}
const obs=(timeMs=0):FaceObservation=>({timeMs,rotation:identity,center:[320,160],size:150,shoulders:{...base.shoulders!},hands:[null,null]})
const yaw=(v:number)=>[Math.cos(v),0,Math.sin(v),0,1,0,-Math.sin(v),0,Math.cos(v)]
describe('face motion observability and temporal policy',()=>{
  it('parses column-major MediaPipe rotation including a known positive yaw',()=>{
    const r=yaw(.6),m=[r[0],r[3],r[6],0,r[1],r[4],r[7],0,r[2],r[5],r[8],0,0,0,0,1]
    rotationFromMatrix(m)!.forEach((v,i)=>expect(v).toBeCloseTo(r[i],10))
    relativeRotation(r,r).forEach((v,i)=>expect(v).toBeCloseTo(identity[i],10))
  })
  it('keeps geometric posture inputs invariant after translation, and separates center velocity',()=>{
    const o=obs(),p={...o,timeMs:100,center:[400,220]}
    const a=faceFeatures(o,base,null),b=faceFeatures(p,base,o)
    expect(b.slice(0,24)).toEqual(a.slice(0,24));expect(b[24]).toBeGreaterThan(0)
  })
  it('keeps face-only samples valid and masks unavailable shoulder values',()=>{
    const o={...obs(),shoulders:null},features=faceFeatures(o,base,null)
    expect(features.slice(7,11)).toEqual([0,0,0,0]);expect(features[13]).toBe(0)
    const w=new FaceWindow();for(let t=0;t<4000;t+=100)w.push({...o,timeMs:t},base)
    expect(w.rows).toHaveLength(40);expect(w.push(null,base)).toBeNull();expect(w.rows).toHaveLength(0)
  })
  it('resets a sequence on time reversal or a long observation gap',()=>{
    const w=new FaceWindow();for(let t=0;t<4000;t+=100)w.push(obs(t),base)
    expect(w.push(obs(4500),base)).toBeNull();expect(w.rows).toHaveLength(1)
    expect(w.push(obs(4400),base)).toBeNull();expect(w.rows).toHaveLength(1)
  })
  it('requires a stable calibration and can register without shoulders',()=>{
    const rows=Array.from({length:31},(_,i)=>({...obs(i*100),shoulders:null}))
    expect(faceBase(rows)?.shoulders).toBeNull();rows[10].rotation=yaw(1);expect(faceBase(rows)).toBeNull()
  })
  it('never deducts for a left or right head turn even if posture logits are wrong',()=>{
    for(const direction of [-1,1]) {
      const d=new FaceDecision();for(let t=0;t<12000;t+=100)d.evaluate({...obs(t),rotation:yaw(direction*.7)},base,[0,.99,0,0],[0,.99,0,0,0])
      expect(d.score).toBe(100)
    }
  })
  it('never deducts body posture from face-only enlargement or unavailable shoulders',()=>{
    const d=new FaceDecision();for(let t=0;t<12000;t+=100)d.evaluate({...obs(t),size:200,shoulders:null},base,[0,.99,0,0],[.99,0,0,0,0])
    expect(d.score).toBe(100);expect(d.pending).toBeNull()
  })
  it('requires sustained evidence and resets the timer across tracking loss',()=>{
    const d=new FaceDecision(),o={...obs(),size:180,shoulders:{...base.shoulders!,gap:-.95}}
    for(let t=0;t<2900;t+=100)d.evaluate({...o,timeMs:t},base,[0,.99,0,0],[.99,0,0,0,0])
    expect(d.score).toBe(100);d.hold()
    d.evaluate({...o,timeMs:3100},base,[0,.99,0,0],[.99,0,0,0,0]);expect(d.score).toBe(100)
    for(let t=3200;t<7000;t+=100)d.evaluate({...o,timeMs:t},base,[0,.99,0,0],[.99,0,0,0,0])
    expect(d.score).toBeLessThan(100)
  })
  it('does not grant stretching points for a shrug or one visible raised hand',()=>{
    for(const hands of [[null,null],[-1,null]] as [number|null,number|null][]) {
      const d=new FaceDecision();d.score=80
      const results=Array.from({length:50},(_,i)=>d.evaluate({...obs(i*100),hands},base,[.99,0,0,0],[0,0,0,.99,0]))
      expect(results.every(r=>r.bonus===0)).toBe(true)
    }
  })
  it('caps a two-hand candidate bonus with cooldown and does not hide combined slouch',()=>{
    const d=new FaceDecision();d.score=80
    const results=Array.from({length:100},(_,i)=>d.evaluate({...obs(i*100),hands:[-1,-1]},base,[.99,0,0,0],[0,0,0,.99,0]))
    expect(results.reduce((n,r)=>n+r.bonus,0)).toBe(2)
    const bad={...obs(),shoulders:{...base.shoulders!,gap:-.25},hands:[-1,-1] as [number,number]}
    for(let t=10000;t<15000;t+=100)d.evaluate({...bad,timeMs:t},base,[0,0,.99,0],[0,0,0,.99,0])
    expect(d.score).toBeLessThan(82)
  })
  it('rejects multiple faces and keeps a valid face when shoulders leave the frame',()=>{
    const f=Array.from({length:478},()=>({x:.5,y:.4}));f[10]={x:.5,y:.2};f[152]={x:.5,y:.5};f[33]={x:.4,y:.35};f[263]={x:.6,y:.35}
    const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    const p=Array.from({length:33},()=>({x:.5,y:.35,visibility:.99,presence:.99}));p[11].y=1.1;p[12].y=1.1
    expect(faceObservation(0,[f],[m],[p],640,480)?.shoulders).toBeNull()
    expect(faceObservation(0,[f,f],[m,m],[p],640,480)).toBeNull()
  })
  it('rejects malformed weights',()=>expect(()=>validateFaceModel({})).toThrow())
  it('accepts a detector-confirmed cropped forehead/chin with visible central anchors, but rejects absent faces',()=>{
    const f=Array.from({length:478},()=>({x:.5,y:.4}));f[10]={x:.5,y:-.1};f[152]={x:.5,y:.95}
    f[33]={x:.4,y:.35};f[263]={x:.6,y:.35}
    const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    expect(faceObservation(0,[f],[m],[],640,480)?.size).toBeCloseTo(504)
    f[33]={x:-.1,y:.35};expect(faceObservation(0,[f],[m],[],640,480)).not.toBeNull()
    f[263]={x:1.1,y:.35};expect(faceObservation(0,[f],[m],[],640,480)).toBeNull()
    expect(faceObservation(0,[],[],[],640,480)).toBeNull()
    f[33]={x:.4,y:.35};f[263]={x:.6,y:.35};m[0]=NaN
    expect(faceObservation(0,[f],[m],[],640,480)).toBeNull()
  })
  it('accepts observed shoulders from the Web API which exposes visibility without presence',()=>{
    const f=Array.from({length:478},()=>({x:.5,y:.4}));f[10]={x:.5,y:.2};f[152]={x:.5,y:.5};f[33]={x:.4,y:.35};f[263]={x:.6,y:.35}
    const m=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1]
    const p=Array.from({length:33},()=>({x:.5,y:.35,visibility:.99}));p[11]={x:.28,y:.68,visibility:.99};p[12]={x:.72,y:.68,visibility:.99}
    expect(faceObservation(0,[f],[m],[p],640,480)?.shoulders).not.toBeNull()
    p[11].visibility=.1;expect(faceObservation(0,[f],[m],[p],640,480)?.shoulders).toBeNull()
  })
  const path=new URL('../../../public/face-model.json',import.meta.url)
  it.skipIf(!existsSync(path))('matches both trained PyTorch heads for all probes within 1e-5',()=>{
    const raw=JSON.parse(readFileSync(path,'utf8')),m=validateFaceModel(raw)
    for(const probe of raw.probes) {
      const v=faceInfer(m,probe.sequence)
      for(const key of ['posture','activity'] as const)v[key].forEach((x,i)=>expect(Math.abs(x-probe[key][i])).toBeLessThan(1e-5))
    }
    expect(()=>faceInfer(m,[[NaN]])).toThrow()
  })
})
