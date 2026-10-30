import { act } from 'react'
import { create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import DeveloperFaceComparison from './DeveloperFaceComparison'
import type { FaceTrackingController } from './useFaceTracking'
import { syntheticFace } from './syntheticFixture.test-helper'
const controller = (): FaceTrackingController => ({ enabled:true,setEnabled:vi.fn(),mode:'face',setMode:vi.fn(),active:true,status:'ready',message:'',delegate:'GPU',
 sample:{frame:syntheticFace(),difference:{meanPixels:8,verticalPixels:-4},inferenceMs:7,roundTripMs:20,delegate:'GPU'},glasses:true,setGlasses:vi.fn(),trialProgress:null,trials:[],startTrial:vi.fn() })
const text = (r: ReactTestRenderer) => JSON.stringify(r.toJSON())
describe('face comparison UI uses explicit input provenance',()=>{
 it('shows signed Pose/Face difference without claiming accuracy or changing ML inputs',()=>{
  let r!:ReactTestRenderer; act(()=>{r=create(<DeveloperFaceComparison face={controller()} />)})
  expect(text(r)).toContain('4.0px 위'); expect(text(r)).toContain('얼굴 전용 478점'); expect(text(r)).toContain('정확도 정답은 아닙니다'); expect(text(r)).toContain('LSTM 입력은 Pose 원본')
  act(()=>r.unmount())
 })
 it('labels missing and model-ready input honestly and disables an unavailable comparison',()=>{
  const face=controller();face.sample=null;face.status='missing';face.message='얼굴 관측 없음'
  let r!:ReactTestRenderer;act(()=>{r=create(<DeveloperFaceComparison face={face}/> )})
  expect(text(r)).toContain('얼굴 관측 없음');expect(r.root.findAllByType('button')[0].props.disabled).toBe(true)
  act(()=>r.update(<DeveloperFaceComparison face={{...face,status:'ready'}}/>));expect(text(r)).toContain('첫 관측 대기');expect(text(r)).not.toContain('478점')
  act(()=>r.unmount())
 })
 it('keeps failed trials in the denominator and changes only explicit display controls',()=>{
  const face=controller();face.trials=[{id:1,glasses:true,elapsedMs:10000,attempted:10,detected:8,paired:7,meanDifferencePixels:8,meanVerticalPixels:-4,meanInferenceMs:7,meanRoundTripMs:20,delegate:'GPU'}]
  let r!:ReactTestRenderer;act(()=>{r=create(<DeveloperFaceComparison face={face}/> )})
  expect(text(r)).toContain('안경 착용');expect(text(r)).toContain('10.0');expect(text(r)).toContain('8.0px')
  act(()=>r.root.findAllByType('input').find(p=>p.props.type==='radio'&&p.parent?.children.includes('기존 Pose'))!.props.onChange())
  expect(face.setMode).toHaveBeenCalledWith('pose');act(()=>r.unmount())
 })
})
