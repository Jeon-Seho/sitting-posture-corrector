import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setServerAuth } from '../platform/serverAuth'
import { fetchWorkspace, saveWorkspaceRules } from './serverWorkspace'

const WORKSPACE = {
  schema_version: '2.0',
  profile: { name: '합성 사용자', age: 30, occupation: null },
  rules: { holdSeconds: 3, recoverSeconds: 3, realertSeconds: 60, threshold: 0.7 },
  preferences: { alerts_on: true },
  consents: { optional_profile: true },
  records: [],
}
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200 })

describe('server workspace (W1·W2)', () => {
  beforeEach(() => setServerAuth({ userId: '7', accessToken: async () => 'synthetic-token' }))
  afterEach(() => setServerAuth(null))

  it('reads the account rules from W1', async () => {
    const fetch = vi.fn(async () => json(WORKSPACE))
    const saved = await fetchWorkspace({ fetch })
    expect(saved.rules).toEqual(WORKSPACE.rules)
    expect(fetch).toHaveBeenCalledWith('/api/workspace', expect.objectContaining({ method: 'GET' }))
  })

  it('saves new rules with the latest profile and preferences unchanged', async () => {
    const rules = { holdSeconds: 5, recoverSeconds: 3, realertSeconds: 120, threshold: 0.6 }
    const fetch = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
      json(init?.method === 'PUT' ? { ...WORKSPACE, rules } : WORKSPACE))
    const saved = await saveWorkspaceRules(rules, { fetch })
    expect(saved.rules).toEqual(rules)
    const put = fetch.mock.calls.find(([, init]) => init?.method === 'PUT')!
    expect(JSON.parse(String(put[1]!.body))).toEqual({
      profile: WORKSPACE.profile,
      rules,
      preferences: WORKSPACE.preferences,
    })
  })

  it('refuses an answer without valid rules', async () => {
    const fetch = vi.fn(async () => json({ ...WORKSPACE, rules: { holdSeconds: 0 } }))
    await expect(fetchWorkspace({ fetch })).rejects.toThrow('서버 설정 응답을 확인하지 못했어요.')
  })
})
