import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '../platform/api'
import { clearPageError, pageErrorKind, reportPageError, retryPageErrors, usePageErrors } from './pageError'
import { act, create } from 'react-test-renderer'
import { createElement } from 'react'

const api = (status: number | null, code: string | null = null) =>
  new ApiError(status === null ? 'network' : 'server', 'msg', status, code)

describe('which failures become an error page', () => {
  afterEach(() => { clearPageError(); vi.unstubAllGlobals() })

  it.each([
    [401, 'INVALID_CREDENTIALS'], [401, 'UNAUTHENTICATED'],
  ])('leaves %s %s to the login flow', (status, code) => {
    expect(pageErrorKind(api(status, code))).toBeNull()
  })

  it.each([400, 403, 404, 409, 429])('puts every other %s into the one 400번대 page', status => {
    expect(pageErrorKind(api(status))).toBe('request')
  })

  it.each([500, 502, 503, 504])('puts %s into the one 500번대 page', status => {
    expect(pageErrorKind(api(status))).toBe('server')
  })

  it('tells no internet apart from a server that did not answer', () => {
    vi.stubGlobal('navigator', { onLine: false })
    expect(pageErrorKind(api(null))).toBe('offline')
    vi.stubGlobal('navigator', { onLine: true })
    expect(pageErrorKind(api(null))).toBe('server')
  })

  it('ignores errors that are not server answers (storage, bad local data)', () => {
    expect(pageErrorKind(new Error('미확인 기록이 손상됐어요.'))).toBeNull()
  })

  it('keeps one error per data source, retries each and clears on a later success', () => {
    const records = vi.fn()
    const rules = vi.fn()
    let seen: ReturnType<typeof usePageErrors> = {}
    function Probe() { seen = usePageErrors(); return null }
    let ui!: ReturnType<typeof create>
    act(() => { ui = create(createElement(Probe)) })
    act(() => { reportPageError('records', api(503), records); reportPageError('rules', api(400), rules) })
    expect(seen.records?.kind).toBe('server')
    expect(seen.rules?.kind).toBe('request')
    retryPageErrors()
    expect(records).toHaveBeenCalledOnce()
    expect(rules).toHaveBeenCalledOnce()
    act(() => clearPageError('records'))
    expect(seen.records).toBeUndefined()
    expect(seen.rules?.status).toBe(400)
    act(() => reportPageError('records', api(401), records))
    expect(seen.records).toBeUndefined()
    act(() => ui.unmount())
  })
})
