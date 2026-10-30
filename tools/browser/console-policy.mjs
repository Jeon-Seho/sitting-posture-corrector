/** Expected baseline absence must be backed by an actual 404 and exactly one diagnostic. */
export function createConsolePolicy() {
  let missingBaselines = 0
  let baselineLogs = 0
  let refresh401 = 0
  let renewLogs = 0
  let meLogs = 0
  return {
    response(response) {
      if (response.status === 401 && new URL(response.url).pathname.endsWith('/v2/auth/refresh')) refresh401++
      if (response.status === 404 && new URL(response.url).pathname.endsWith('/v2/baselines/current')) missingBaselines++
    },
    expected(args) {
      if (args[0]?.value === '[features/auth/accountClient.ts:renew] Operation failed' && args[2]?.value === 'expected:auth-renew-401') { renewLogs++; return true }
      if (args[0]?.value === '[features/auth/accountClient.ts:me] Operation failed' && args[2]?.value === 'expected:auth-me-401') { meLogs++; return true }
      if (args[0]?.value === '[features/baseline/client.ts:fetchCurrentBaseline] Operation failed' &&
          args[2]?.value === 'expected:baseline-missing') { baselineLogs++; return true }
      return false
    },
    verify() {
      // React StrictMode can share one refresh between two startup me() calls.
      if (renewLogs !== refresh401 || meLogs > 2 * refresh401) throw new Error(`Signed-out diagnostics do not match refresh responses: ${refresh401}/${renewLogs}/${meLogs}`)
      if (baselineLogs !== missingBaselines) throw new Error(`Baseline absence diagnostics: expected ${missingBaselines}, received ${baselineLogs}`)
    },
  }
}
