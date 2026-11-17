import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { ServerAccountPage } from './ServerAccountPage'
import { apiRequest } from '../platform/api'
import { DEFAULT_RULES } from '../../data/posture'
vi.mock('../platform/api', () => ({ apiRequest: vi.fn() }))
const workspace = { profile: { name: '합성', age: null, occupation: null }, rules: DEFAULT_RULES, preferences: { alerts_on: true }, consents: { optional_profile: false } }
let renderer: ReactTestRenderer
const onSignedOut = vi.fn(), onProfile = vi.fn(), onBusy = vi.fn()
beforeEach(() => { vi.clearAllMocks(); vi.mocked(apiRequest).mockResolvedValue(workspace) })
afterEach(() => act(() => renderer?.unmount()))
const mount = async (blocked = false) => act(async () => { renderer = create(<ServerAccountPage blocked={blocked} onProfile={onProfile} onSignedOut={onSignedOut} onBusy={onBusy} />) })
const change = (index: number, value: string) => act(() => renderer.root.findAllByType('input')[index].props.onChange({ target: { value } }))
it('refuses an overwrite when settings changed since the form loaded', async () => {
  await mount()
  change(0, '편집')
  vi.mocked(apiRequest).mockResolvedValueOnce({ ...workspace, profile: { ...workspace.profile, name: '다른 기기' } })
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  expect(apiRequest).toHaveBeenCalledTimes(2)
  expect(onProfile).not.toHaveBeenCalled()
  expect(onBusy.mock.calls).toEqual([[true], [false]])
})
it('blocks account mutation while measurement or storage confirmation is pending', async () => {
  await mount(true)
  await act(async () => renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }))
  expect(apiRequest).toHaveBeenCalledTimes(1)
})
it('signs out only after password change is acknowledged and clears typed secrets', async () => {
  await mount()
  change(1, 'Synthetic-current-1234!'); change(2, 'Synthetic-new-1234!')
  const button = renderer.root.findAllByType('button').find(b => b.children.includes('비밀번호 변경'))!
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('offline'))
  await act(async () => button.props.onClick())
  expect(onSignedOut).not.toHaveBeenCalled()
  expect(renderer.root.findAllByType('input')[1].props.value).toBe('')
  change(1, 'Synthetic-current-1234!'); change(2, 'Synthetic-new-1234!')
  await act(async () => button.props.onClick())
  expect(onSignedOut).toHaveBeenCalledOnce()
  expect(apiRequest).toHaveBeenLastCalledWith('/auth/password', expect.objectContaining({ method: 'PUT' }), expect.anything(), { retries: 0 })
})
const button = (label: string) => renderer.root.findAllByType('button').find(b => b.children.join('') === label)!
it('withdraws without a password: the button opens 「정말 삭제하시겠습니까?」 and 「탈퇴」 sends A7 with no body (요구 1)', async () => {
  await mount()
  expect(renderer.root.findAllByType('input').some(i => i.props.type === 'checkbox')).toBe(false)
  expect(button('서버 계정 탈퇴').props.disabled).toBe(false)
  act(() => button('서버 계정 탈퇴').props.onClick())
  expect(JSON.stringify(renderer.toJSON())).toContain('정말 삭제하시겠습니까?')
  act(() => button('취소').props.onClick())
  expect(JSON.stringify(renderer.toJSON())).not.toContain('정말 삭제하시겠습니까?')
  expect(apiRequest).toHaveBeenCalledTimes(1)
  act(() => button('서버 계정 탈퇴').props.onClick())
  vi.mocked(apiRequest).mockResolvedValueOnce(null)
  await act(async () => button('탈퇴').props.onClick())
  expect(apiRequest).toHaveBeenLastCalledWith('/auth/account', { method: 'DELETE', body: undefined }, expect.anything(), { retries: 0 })
  expect(onSignedOut).toHaveBeenCalledWith('서버에 탈퇴를 접수했어요.')
  expect(onBusy.mock.calls).toEqual([[true], [false]])
})
it('keeps the withdrawal dialog open with the reason when A7 fails', async () => {
  await mount()
  act(() => button('서버 계정 탈퇴').props.onClick())
  vi.mocked(apiRequest).mockRejectedValueOnce(new Error('변경하지 못했어요. 입력과 서버 연결을 확인해 주세요.'))
  await act(async () => button('탈퇴').props.onClick())
  expect(onSignedOut).not.toHaveBeenCalled()
  expect(JSON.stringify(renderer.toJSON())).toContain('변경하지 못했어요. 입력과 서버 연결을 확인해 주세요.')
})
it('keeps the withdrawal button off while measuring', async () => {
  await mount(true)
  expect(button('서버 계정 탈퇴').props.disabled).toBe(true)
})
