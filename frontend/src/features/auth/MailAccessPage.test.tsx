import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MailAccessPage } from './MailAccessPage'
import { LoginPage } from '../../pages/LoginPage'
import { MailApiError } from './mailApi'

describe('account email screens', () => {
  let renderer: ReactTestRenderer
  const api = { enabledFor: () => true, request: vi.fn(), validate: vi.fn(), verify: vi.fn(), reset: vi.fn() }
  const type = (name: string, value: string) => act(() => renderer.root.find(node => node.type === 'input' && node.props.name === name).props.onChange({ target: { value } }))
  const submit = () => act(async () => { renderer.root.findByType(LoginPage).props.onSubmit() })
  beforeEach(() => {
    vi.resetAllMocks()
    for (const fn of [api.request, api.validate, api.verify, api.reset]) fn.mockResolvedValue(undefined)
    vi.stubGlobal('window', { location: { hash: '', pathname: '/', search: '' }, history: { replaceState: vi.fn() }, setTimeout, clearTimeout })
  })
  afterEach(() => { act(() => renderer?.unmount()); vi.unstubAllGlobals() })

  it('checks an email link before showing passwords and rejects mismatched confirmation', async () => {
    window.location.hash = '#password-reset?token=synthetic-secret'
    await act(async () => { renderer = create(<MailAccessPage api={api} onBack={vi.fn()} />) })
    expect(api.validate).toHaveBeenCalledWith('synthetic-secret', expect.any(AbortSignal))
    expect(window.history.replaceState).toHaveBeenCalledWith(null, '', '/')
    expect(renderer.root.findByType(LoginPage).props.title).toBe('비밀번호 재설정')
    type('new-password', 'synthetic-new-password')
    type('password-again', 'different-password')
    await submit()
    expect(api.reset).not.toHaveBeenCalled()
    type('password-again', 'synthetic-new-password')
    await submit()
    expect(api.reset).toHaveBeenCalledWith('synthetic-secret', 'synthetic-new-password', expect.any(AbortSignal))
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
  })

  it('keeps expired links out of the password screen', async () => {
    window.location.hash = '#password-reset?token=expired'
    api.validate.mockRejectedValueOnce(new MailApiError('INVALID_TOKEN', '만료된 링크예요.'))
    await act(async () => { renderer = create(<MailAccessPage api={api} onBack={vi.fn()} />) })
    expect(renderer.root.findAllByProps({ name: 'new-password' })).toHaveLength(0)
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('만료')
  })

  it('sends a signup code and only continues registration after confirmation', async () => {
    const onVerified = vi.fn()
    await act(async () => { renderer = create(<MailAccessPage purpose="verify" initialEmail="synthetic@example.test" api={api} onVerified={onVerified} onBack={vi.fn()} />) })
    await submit()
    expect(api.request).toHaveBeenCalledWith('verify', 'synthetic@example.test', expect.any(AbortSignal))
    expect(onVerified).not.toHaveBeenCalled()
    type('mail-token', '123456')
    await submit()
    expect(api.verify).toHaveBeenCalledWith('123456', expect.any(AbortSignal))
    await submit()
    expect(onVerified).toHaveBeenCalledOnce()
  })
})
