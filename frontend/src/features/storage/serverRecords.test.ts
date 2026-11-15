import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_RULES } from '../../data/posture'
import { BASELINE_ID, view } from '../session/server/testFixtures'
import { setServerAuth } from '../platform/serverAuth'
import { dropOldPendingResults, settleUnconfirmed } from './serverRecords'
import type { RecordItem } from './types'

/** Synthetic server only: a stubbed fetch for S4 and an in-memory localStorage. */
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

const STORED = '11111111-1111-4111-8111-111111111111'
const LOST = '22222222-2222-4222-8222-222222222222'
const SAVING = '33333333-3333-4333-8333-333333333333'
const OFFLINE = '44444444-4444-4444-8444-444444444444'
const IN_R1 = '55555555-5555-4555-8555-555555555555'

function record(id: string): RecordItem {
  return { id, startedAt: '2026-10-29T00:00:00Z', endedAt: '2026-10-29T00:00:02Z', mode: 'camera', total: 2, valid: 0, good: 0, events: [], rules: DEFAULT_RULES,
    server: { baselineId: BASELINE_ID, modelVersion: 'synthetic', confirmed: true, view: view({ session_id: id, ended: true }) } }
}

describe('measurements the server did not confirm (nothing kept on this device)', () => {
  let data: Map<string, string>
  let fetch: ReturnType<typeof vi.fn<typeof globalThis.fetch>>
  beforeEach(() => {
    data = new Map()
    vi.stubGlobal('localStorage', { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => data.set(k, v), removeItem: (k: string) => data.delete(k) })
    vi.stubGlobal('location', { protocol: 'https:', host: 'app.example.test' })
    fetch = vi.fn<typeof globalThis.fetch>()
    vi.stubGlobal('fetch', fetch)
    setServerAuth({ userId: 'a', accessToken: async () => 'access' })
  })
  afterEach(() => { setServerAuth(null); vi.unstubAllGlobals() })

  it('removes the results an older app kept on this device, only for that account', () => {
    data.set('posegood.account.v3.a.pending-results', '{broken')
    data.set('posegood.account.v3.b.pending-results', '[]')
    dropOldPendingResults('a')
    expect([...data.keys()]).toEqual(['posegood.account.v3.b.pending-results'])
  })

  it('settles those in R1 or ended by S4, counts the lost (404), and keeps saving or unknown ones', async () => {
    fetch.mockImplementation(async (url) => {
      const path = String(url)
      if (path.endsWith(`/sessions/${STORED}`)) return reply(200, { ended: true })
      if (path.endsWith(`/sessions/${LOST}`)) return reply(404, { code: 'SESSION_LOST' })
      if (path.endsWith(`/sessions/${OFFLINE}`)) throw new TypeError('Failed to fetch')
      return reply(200, { ended: false })
    })
    const result = await settleUnconfirmed('a', [IN_R1, STORED, LOST, SAVING, OFFLINE], [record(IN_R1)])
    expect(result).toEqual({ remaining: [SAVING, OFFLINE], lost: 1 })
    // R1 already lists it as ended: S4 is not asked.
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith(`/sessions/${IN_R1}`))).toBe(false)
  })
})
