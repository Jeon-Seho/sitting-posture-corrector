import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SocialAccountLinkPage } from './SocialAccountLinkPage'
import { LoginPage } from '../../pages/LoginPage'
import { AccountError, type SocialClient } from './accountClient'

describe('social account collision', () => {
  let renderer: ReactTestRenderer
  afterEach(() => act(() => renderer?.unmount()))
  const submit = () => act(async () => { renderer.root.findByType(LoginPage).props.onSubmit() })
  const view = { user_id: '5', email: 'synthetic@example.test', profile: { name: '합성 사용자', age: null, occupation: null } }
  const client = () => ({
    linkDraft: vi.fn(async () => ({ provider: 'discord', email: view.email, verified: false })),
    verifyLink: vi.fn(async (_password: string) => {}), confirmLink: vi.fn(async () => view), cancelLink: vi.fn(async () => {}),
  })

  it('verifies the old password, then waits for explicit approval before linking and logging in', async () => {
    const social = client(), onComplete = vi.fn()
    await act(async () => { renderer = create(<SocialAccountLinkPage social={social as unknown as SocialClient} onComplete={onComplete} onCancel={vi.fn()} onFindPassword={vi.fn()} />) })
    await submit()
    act(() => renderer.root.find(node => node.type === 'input' && node.props.name === 'link-password').props.onChange({ target: { value: 'synthetic-password-123' } }))
    await submit()
    expect(social.verifyLink).toHaveBeenCalledWith('synthetic-password-123')
    expect(social.confirmLink).not.toHaveBeenCalled()
    expect(onComplete).not.toHaveBeenCalled()
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    await submit()
    expect(social.confirmLink).toHaveBeenCalledOnce()
    expect(onComplete).toHaveBeenCalledWith(view)
  })

  it('does not advance after incorrect credentials', async () => {
    const social = client()
    social.verifyLink.mockRejectedValueOnce(new AccountError('synthetic', 400, 'INVALID_PASSWORD'))
    await act(async () => { renderer = create(<SocialAccountLinkPage social={social as unknown as SocialClient} onComplete={vi.fn()} onCancel={vi.fn()} onFindPassword={vi.fn()} />) })
    await submit()
    act(() => renderer.root.find(node => node.type === 'input' && node.props.name === 'link-password').props.onChange({ target: { value: 'wrong' } }))
    await submit()
    expect(social.confirmLink).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('맞지 않아요')
  })
})
