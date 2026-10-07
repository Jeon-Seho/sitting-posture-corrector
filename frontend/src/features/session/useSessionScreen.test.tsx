import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionScreen } from './useSessionScreen'
import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import { DEFAULT_RULES } from '../../data/posture'
import { sampleAt, type Sample } from '../../lib/engine'

describe('face session continuity with synthetic input',()=>{
  let renderer:ReactTestRenderer,screen:ReturnType<typeof useSessionScreen>,camera:CameraController,sample:Sample
  function Probe(){screen=useSessionScreen({rules:DEFAULT_RULES,alertsOn:true,camera,mode:'camera',collection:{setPhase:vi.fn()} as unknown as CollectionController,
    service:{active:true,onCheckpoint:vi.fn(),onEnded:vi.fn(),saveMessage:'',onRetry:vi.fn()}});return null}
  beforeEach(()=>{
    vi.useFakeTimers();vi.setSystemTime(0);vi.spyOn(performance,'now').mockImplementation(()=>Date.now())
    vi.stubGlobal('document',Object.assign(new EventTarget(),{hidden:false}))
    sample={...sampleAt(0),state:'good',evaluationScope:'head',prob:0}
    camera={state:'on',baseline:{headGap:0,offset:0,tilt:0,quality:1},lastFrame:{current:0},current:{current:null},stop:vi.fn(),face:{sample:()=>sample,score:()=>100,bonus:()=>0,setPolicy:vi.fn(),notice:'',buildVersion:'synthetic',modelSha:''}} as unknown as CameraController
    act(()=>{renderer=create(<Probe/> )})
  })
  afterEach(()=>{act(()=>renderer.unmount());vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals()})
  it('stays running when hidden and through face loss, then resumes only fresh observation',()=>{
    act(()=>{Object.assign(document,{hidden:true});document.dispatchEvent(new Event('visibilitychange'));sample={...sample,state:'unknown'};vi.advanceTimersByTime(5000)})
    expect(screen.phase).toBe('running');expect(screen.live.validSeconds).toBe(0);expect(screen.live.unknownSeconds).toBeGreaterThan(4)
    act(()=>{sample={...sample,state:'good'};camera.lastFrame.current=Date.now();vi.advanceTimersByTime(500)})
    expect(screen.phase).toBe('running');expect(screen.live.goodSeconds).toBeGreaterThan(.4);expect(screen.live.events).toHaveLength(0)
  })
  it('excludes a scheduling stall and continues without a manual resume',()=>{
    act(()=>{vi.setSystemTime(5000);camera.lastFrame.current=5000;vi.advanceTimersByTime(50)})
    expect(screen.phase).toBe('running');expect(screen.live.unknownSeconds).toBeGreaterThan(4);expect(screen.live.validSeconds).toBe(0)
    act(()=>{camera.lastFrame.current=Date.now();vi.advanceTimersByTime(500)})
    expect(screen.phase).toBe('running');expect(screen.live.goodSeconds).toBeGreaterThan(.4)
  })
  it('keeps explicit user pause and actual disconnected camera as pauses',()=>{
    act(()=>screen.togglePause());act(()=>{vi.advanceTimersByTime(1000)});expect(screen.phase).toBe('paused')
    act(()=>screen.togglePause());act(()=>{camera.state='error';renderer.update(<Probe/>);vi.advanceTimersByTime(500)})
    expect(screen.phase).toBe('paused');expect(screen.pauseReason).toContain('카메라 입력이 끊겼습니다')
  })
})
