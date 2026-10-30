import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import DeveloperNormalCollection from './DeveloperNormalCollection'
import { emptyNormalCollection } from './normalCollection'
import type { NormalCollectionController } from './useNormalCollection'

const mock = (patch: Partial<NormalCollectionController> = {}): NormalCollectionController => ({ snapshot: emptyNormalCollection(), profile: null,
  connecting: false, error: '', start: vi.fn(), finish: vi.fn(), interrupt: vi.fn(), confirmAndApply: vi.fn(), discard: vi.fn(),
  downloadDataset: vi.fn(), downloadProfile: vi.fn(), importProfile: vi.fn(), clearProfile: vi.fn(), ...patch })
const render = (collection: NormalCollectionController, disabled = false) => { let r!: ReactTestRenderer; act(() => { r = create(<DeveloperNormalCollection collection={collection} cameraState="off" disabled={disabled} />) }); return r }
const button = (r: ReactTestRenderer, text: string) => r.root.findAllByType('button').find(b => b.children.some(c => typeof c === 'string' && c.includes(text)))!
describe('normal collection controls', () => {
  it('explains raw coordinate export and requires an anonymous participant code before starting', () => {
    const c = mock(), r = render(c)
    expect(JSON.stringify(r.toJSON())).toContain('원본 좌표')
    expect(button(r, '30초 측정하기').props.disabled).toBe(true)
    act(() => r.root.findByProps({ id: 'normal-participant' }).props.onChange({ target: { value: 'synthetic_p01' } }))
    act(() => button(r, '30초 측정하기').props.onClick())
    expect(c.start).toHaveBeenCalledWith(expect.objectContaining({ participantCode: 'synthetic_p01', purpose: 'personal_calibration' }))
    expect(c.confirmAndApply).not.toHaveBeenCalled()
    act(() => r.unmount())
  })
  it('requires a positive segment review before profile application, and blocks application during another measurement', () => {
    const c = mock({ snapshot: { ...emptyNormalCollection(), phase: 'review', validMs: 30000, samples: 301, canConfirm: true } }), r = render(c)
    expect(button(r, '확인하고 개인 범위 적용').props.disabled).toBe(true)
    act(() => r.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    expect(button(r, '확인하고 개인 범위 적용').props.disabled).toBe(false)
    act(() => button(r, '확인하고 개인 범위 적용').props.onClick())
    expect(c.confirmAndApply).toHaveBeenCalledOnce()
    act(() => r.update(<DeveloperNormalCollection collection={c} cameraState="on" disabled />))
    expect(button(r, '확인하고 개인 범위 적용').props.disabled).toBe(true)
    act(() => r.unmount())
  })

  it('starts an explicit evaluation-only capture without normal-pose or personal-range instructions', () => {
    const c = mock(), r = render(c)
    const select = r.root.findByProps({ id: 'normal-purpose' })
    expect(select.findAllByType('option').find(option => option.props.value === 'forecast_evaluation')?.children).toEqual(['예측 모델 평가용 · 학습 제외'])
    act(() => select.props.onChange({ target: { value: 'forecast_evaluation' } }))
    act(() => r.root.findByProps({ id: 'normal-participant' }).props.onChange({ target: { value: 'synthetic_eval' } }))
    const text = JSON.stringify(r.toJSON())
    expect(text).toContain('30초 동안 평가할 자세와 움직임을 촬영해요')
    expect(text).toContain('고정된 모델 비교에만 사용하는 평가 전용 파일')
    expect(text).toContain('학습·개인 보정·모델 선택·임계값 조정에 사용하지 않습니다.')
    expect(text).not.toContain('30초 정상 범위 학습')
    expect(button(r, '개인 범위 불러오기')).toBeUndefined()
    act(() => button(r, '30초 측정하기').props.onClick())
    expect(c.start).toHaveBeenCalledWith(expect.objectContaining({ participantCode: 'synthetic_eval', purpose: 'forecast_evaluation' }))
    act(() => r.unmount())
  })

  it('confirms evaluation use only, locks its purpose, and exposes the evaluation download after confirmation', () => {
    const snapshot = { ...emptyNormalCollection(), metadata: { participantCode: 'synthetic_eval', sessionCode: 'synthetic_session', purpose: 'forecast_evaluation' as const }, phase: 'review' as const, validMs: 30000, samples: 301, canConfirm: true }
    const c = mock({ snapshot }), r = render(c)
    const text = JSON.stringify(r.toJSON())
    expect(text).toContain('학습이나 개인 보정에 사용하지 않을 평가 자료임을 확인했어요.')
    expect(text).not.toContain('큰 자세 이탈이 없었음')
    expect(text).not.toContain('학습 자료 준비')
    expect(r.root.findByProps({ id: 'normal-purpose' }).props).toMatchObject({ value: 'forecast_evaluation', disabled: true })
    expect(button(r, '확인하고 평가 자료 준비').props.disabled).toBe(true)
    act(() => r.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    act(() => button(r, '확인하고 평가 자료 준비').props.onClick())
    expect(c.confirmAndApply).toHaveBeenCalledOnce()
    act(() => r.update(<DeveloperNormalCollection collection={c} cameraState="on" disabled />))
    expect(button(r, '확인하고 평가 자료 준비').props.disabled).toBe(true)
    act(() => r.update(<DeveloperNormalCollection collection={{ ...c, snapshot: { ...snapshot, phase: 'confirmed', canConfirm: false } }} cameraState="on" />))
    expect(JSON.stringify(r.toJSON())).toContain('평가 자료를 준비했어요')
    expect(JSON.stringify(r.toJSON())).not.toContain('정상 학습 자료를 준비했어요')
    act(() => button(r, '평가 좌표 데이터 내보내기').props.onClick())
    expect(c.downloadDataset).toHaveBeenCalledOnce()
    act(() => r.unmount())
  })

  it('keeps the normal-training review and preparation action for training captures', () => {
    const c = mock({ snapshot: { ...emptyNormalCollection(), metadata: { participantCode: 'synthetic_train', sessionCode: 'synthetic_session', purpose: 'training_normal' }, phase: 'review', validMs: 30000, samples: 301, canConfirm: true } }), r = render(c)
    expect(JSON.stringify(r.toJSON())).toContain('큰 자세 이탈이 없었음')
    expect(button(r, '확인하고 학습 자료 준비').props.disabled).toBe(true)
    act(() => r.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }))
    expect(button(r, '확인하고 학습 자료 준비').props.disabled).toBe(false)
    expect(button(r, '확인하고 평가 자료 준비')).toBeUndefined()
    act(() => r.unmount())
  })
})
