import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AccountLoginPage } from './AccountLoginPage'
import { LoginPage } from '../../pages/LoginPage'

describe('account registration consent and password input', () => {
  let renderer: ReactTestRenderer | undefined
  afterEach(() => act(() => renderer?.unmount()))
  function mount() {
    const authenticate = vi.fn().mockResolvedValue(undefined)
    act(() => {
      renderer = create(<AccountLoginPage busy={false} message="" onAuthenticate={authenticate} />)
    })
    return authenticate
  }
  function click(label: string) {
    act(() =>
      renderer!.root
        .findAllByType('button')
        .find((node) => node.children.join('') === label)!
        .props.onClick(),
    )
  }
  const page = () => renderer!.root.findByType(LoginPage)
  const inputs = () => renderer!.root.findAllByType('input')
  function fill() {
    act(() => {
      const values = ['synthetic@example.test', 'synthetic-password', '합성 계정', 23, '합성 시험']
      inputs()
        .filter((node) => node.props.type !== 'checkbox')
        .forEach((node, index) => {
          node.props.onChange({ target: { value: values[index] } })
        })
    })
  }

  it('starts with consent unchecked and blocks registration until explicitly checked', async () => {
    const authenticate = mount()
    click('새 계정 만들기')
    fill()
    const checkbox = inputs().find((node) => node.props.type === 'checkbox')!
    expect(checkbox.props.checked).toBe(false)
    await act(async () => {
      page().props.onSubmit()
    })
    expect(authenticate).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('동의')
    act(() => checkbox.props.onChange({ target: { checked: true } }))
    await act(async () => {
      page().props.onSubmit()
    })
    expect(authenticate).toHaveBeenCalledWith('synthetic@example.test', 'synthetic-password', {
      email: 'synthetic@example.test',
      password: 'synthetic-password',
      profile: { name: '합성 계정', age: 23, occupation: '합성 시험' },
      consent_version: 'service-v1',
    })
  })

  it('clears the password and consent when switching between sign-in and registration', () => {
    mount()
    click('새 계정 만들기')
    fill()
    click('기존 계정으로 로그인')
    expect(inputs().find((node) => node.props.type === 'password')!.props.value).toBe('')
    click('새 계정 만들기')
    expect(inputs().find((node) => node.props.type === 'checkbox')!.props.checked).toBe(false)
  })

  it('does not submit twice while the same asynchronous sign-in is pending', async () => {
    let resolve!: () => void
    const pending = new Promise<void>((done) => {
      resolve = done
    })
    const authenticate = vi.fn(() => pending)
    act(() => {
      renderer = create(<AccountLoginPage busy={false} message="" onAuthenticate={authenticate} />)
    })
    act(() => {
      inputs()[0].props.onChange({ target: { value: 'synthetic@example.test' } })
      inputs()[1].props.onChange({ target: { value: 'synthetic-password' } })
    })
    const submit = page().props.onSubmit
    act(() => {
      submit()
      submit()
    })
    expect(authenticate).toHaveBeenCalledOnce()
    await act(async () => {
      resolve()
      await pending
    })
  })
})
