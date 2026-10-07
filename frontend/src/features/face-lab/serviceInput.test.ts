import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { FaceServiceInput, faceServiceSample } from './serviceInput'
import { FaceDecision, validateFaceModel, type FaceBaseline, type FaceObservation } from '../../../../model/prototype/faceMotion'
import { newMachine, step } from '../../lib/engine'
import { DEFAULT_RULES } from '../../data/posture'
import { recordFromDraft } from '../storage/records'
import { validRecord } from '../storage/validation'
const identity=[1,0,0,0,1,0,0,0,1]
const baseline:FaceBaseline={rotation:identity,size:150,shoulders:{gap:-.65,offset:0,roll:0,width:260}}
const obs=(t=0):FaceObservation=>({timeMs:t,rotation:identity,center:[320,160],size:150,shoulders:{...baseline.shoulders!},hands:[null,null]})
describe('face model connection to POSEGOOD sessions',()=>{
  it('measures head angle without falsely counting missing shoulders as upper-body observation',()=>{
    const d=new FaceDecision();d.score=82
    const held=d.evaluate({...obs(),shoulders:null},baseline,[1,0,0,0],[1,0,0,0,0])
    const machine=newMachine(),s=faceServiceSample(held,[1,0,0,0])
    step(machine,10,'running',DEFAULT_RULES,s)
    expect(machine.unknown).toBe(0);expect(machine.good).toBe(10);expect(machine.evaluationCounts?.head.valid).toBe(10);expect(machine.evaluationCounts?.upper_body.valid).toBe(0);expect(machine.events).toHaveLength(0);expect(d.score).toBe(82)
  })
  it('uses one hold interval for the alert and does not drop score before it',()=>{
    const d=new FaceDecision(),machine=newMachine()
    for(let t=0;t<3000;t+=100){
      const reading=d.evaluate({...obs(t),size:185,shoulders:{...baseline.shoulders!,gap:-.25}},baseline,[0,.99,.005,.005],[1,0,0,0,0],3000)
      step(machine,t?0.1:0,'running',DEFAULT_RULES,faceServiceSample(reading,[0,.99,.005,.005]))
    }
    expect(machine.events).toHaveLength(0);expect(d.score).toBe(100)
    const reading=d.evaluate({...obs(3000),size:185,shoulders:{...baseline.shoulders!,gap:-.25}},baseline,[0,.99,.005,.005],[1,0,0,0,0],3000)
    step(machine,.1,'running',DEFAULT_RULES,faceServiceSample(reading,[0,.99,.005,.005]))
    expect(machine.events).toHaveLength(1);expect(d.score).toBeCloseTo(99.8)
  })
  it('suspends score/hold during pause and starts a fresh session with a fresh score',()=>{
    const input=new FaceServiceInput();input.decision.score=60;input.decision.pending=10;input.setPolicy('paused',5000)
    expect(input.decision.pending).toBeNull();expect(input.decision.score).toBe(60)
    input.setPolicy('ended',5000);input.setPolicy('running',5000)
    expect(input.decision.score).toBe(100);expect(input.holdMs).toBe(5000)
  })
  it('does not turn unavailable forward/slouch body logits into a head-only warning',()=>{
    for(const p of [[0,.99,0,0],[0,0,.99,0]]){
      const d=new FaceDecision()
      for(let t=0;t<10000;t+=100){
        const r=d.evaluate({...obs(t),shoulders:null,size:220,center:[500,260]},baseline,p,[1,0,0,0,0])
        expect(r.scope).toBe('head');expect(r.state).toBe('머리 각도 기준 범위 · 상체 제외')
      }
      expect(d.score).toBe(100)
    }
  })
  it('requires head-tilt persistence and saves separate scope time across shoulder changes',()=>{
    const d=new FaceDecision(),machine=newMachine(),v=.3
    const head=(t:number)=>({...obs(t),shoulders:null,rotation:[Math.cos(v),-Math.sin(v),0,Math.sin(v),Math.cos(v),0,0,0,1]})
    for(let t=0;t<2000;t+=100)step(machine,.1,'running',DEFAULT_RULES,faceServiceSample(d.evaluate(head(t),baseline,[0,0,0,.99],[1,0,0,0,0]),[0,0,0,.99]))
    const bent=(t:number)=>({...obs(t),size:185,shoulders:{...baseline.shoulders!,gap:-.25}})
    for(let t=2000;t<4000;t+=100)step(machine,.1,'running',DEFAULT_RULES,faceServiceSample(d.evaluate(bent(t),baseline,[0,.99,0,0],[1,0,0,0,0]),[0,.99,0,0]))
    expect(machine.events).toHaveLength(0);expect(d.score).toBe(100)
    for(let t=4000;t<5500;t+=100)step(machine,.1,'running',DEFAULT_RULES,faceServiceSample(d.evaluate(head(t),baseline,[0,0,0,.99],[1,0,0,0,0]),[0,0,0,.99]))
    expect(machine.events).toHaveLength(0)
    for(let t=5500;t<8000;t+=100)step(machine,.1,'running',DEFAULT_RULES,faceServiceSample(d.evaluate(head(t),baseline,[0,0,0,.99],[1,0,0,0,0]),[0,0,0,.99]))
    expect(machine.events).toHaveLength(1);expect(machine.events[0].evaluationScope).toBe('head');expect(d.score).toBeLessThan(100)
    const record=recordFromDraft({id:'synthetic-scope',startedAt:'2026-10-07T01:00:00Z',mode:'camera',rules:DEFAULT_RULES,machine},'2026-10-07T01:00:10Z')
    expect(record.evaluationCounts?.head.valid).toBeCloseTo(6);expect(record.evaluationCounts?.upper_body.valid).toBeCloseTo(2)
    expect(validRecord(record)).toBe(true)
    expect(validRecord({...record,evaluationCounts:{head:{valid:100,good:100},upper_body:{valid:0,good:0}}})).toBe(false)
    d.hold();expect(d.pending).toBeNull()
  })
  const path=new URL('../../../public/face-model.json',import.meta.url)
  it.skipIf(!existsSync(path))('keeps a completed model window through ordinary camera timing jitter',()=>{
    const model=validateFaceModel(JSON.parse(readFileSync(path,'utf8'))),input=new FaceServiceInput()
    input.setBaseline(baseline);input.setPolicy('running',3000)
    for(let t=0;t<4500;t+=100)input.update(obs(t),model)
    expect(input.sample.state).toBe('good')
    input.update(obs(4490),model)
    expect(input.sample.state).toBe('good')
    expect(input.result.state).not.toContain('확인 중')
    input.update(obs(5100),model)
    expect(input.sample.state).toBe('good')
    expect(input.sample.evaluationScope).toBe('head')
    expect(input.inferences).toBeGreaterThan(0)
    expect(input.window.rows).toHaveLength(1)
  })
  it.skipIf(!existsSync(path))('does not let skipped camera frames interrupt a sustained posture alert',()=>{
    const model=validateFaceModel(JSON.parse(readFileSync(path,'utf8'))),input=new FaceServiceInput()
    // Synthetic constant classifier isolates the cadence-to-policy connection.
    model.weights['posture.weight']=Array.from({length:4},()=>Array(24).fill(0))
    model.weights['posture.bias']=[-20,20,-20,-20]
    model.weights['activity.weight']=Array.from({length:5},()=>Array(24).fill(0))
    model.weights['activity.bias']=[20,-20,-20,-20,-20]
    input.setBaseline(baseline);input.setPolicy('running',3000)
    const bent=(t:number)=>({...obs(t),size:185,shoulders:{...baseline.shoulders!,gap:-.25}})
    for(let t=0;t<=7100;t+=100){input.update(bent(t),model);input.update(bent(t+90),model)}
    expect(input.result.state).toBe('지속 자세 변화')
    expect(input.decision.score).toBeLessThan(100)
    input.update(null,model)
    expect(input.decision.pending).toBeNull()
  })
  it.skipIf(!existsSync(path))('runs the packaged temporal weights through the service input, including position shifts and missing shoulders',()=>{
    const model=validateFaceModel(JSON.parse(readFileSync(path,'utf8'))),input=new FaceServiceInput()
    input.setBaseline(baseline);input.setPolicy('running',3000)
    for(let t=0;t<4500;t+=100)input.update({...obs(t),center:[320+t/100,160]},model)
    expect(input.decision.score).toBe(100);expect(input.sample.state).not.toBe('collapse')
    for(let t=4500;t<9000;t+=100)input.update({...obs(t),shoulders:null},model)
    expect(input.sample.state).toBe('good');expect(input.sample.evaluationScope).toBe('head');expect(input.decision.score).toBe(100)
    input.update(null,model);expect(input.sample.state).toBe('unknown')
  })
  it.skipIf(!existsSync(path))('reacquires a current head reference immediately without reusing old temporal evidence',()=>{
    const model=validateFaceModel(JSON.parse(readFileSync(path,'utf8'))),input=new FaceServiceInput()
    input.setBaseline(baseline);input.setPolicy('running',3000)
    for(let t=0;t<4500;t+=100)input.update(obs(t),model)
    const previousInferences=input.inferences
    input.decision.pending=4000;input.update(null,model)
    expect(input.sample.state).toBe('unknown');expect(input.decision.pending).toBeNull()
    input.update({...obs(10000),center:[470,240]},model)
    expect(input.sample.state).toBe('good');expect(input.sample.evaluationScope).toBe('head')
    expect(input.window.rows).toHaveLength(1);expect(input.inferences).toBe(previousInferences)
    expect(input.result.posture).toBe('모델 분석 준비');expect(input.result.bonus).toBe(0)
    input.update({...obs(10100),rotation:[Math.cos(.7),0,Math.sin(.7),0,1,0,-Math.sin(.7),0,Math.cos(.7)]},model)
    expect(input.sample.state).toBe('unknown');expect(input.result.state).toBe('고개 회전 · 감점 보류')
    expect(input.decision.score).toBe(100)
  })
})
