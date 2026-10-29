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
  expect(apiRequest).toHaveBeenLastCalledWith('/v2/auth/password', expect.objectContaining({ method: 'PUT' }), expect.anything(), { retries: 0 })
})
