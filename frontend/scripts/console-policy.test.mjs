import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createConsolePolicy } from '../../tools/browser/console-policy.mjs'
const log = [{ value: '[features/baseline/client.ts:fetchCurrentBaseline] Operation failed' }, {}, { value: 'expected:baseline-missing' }]
test('only matching 404 and diagnostic counts are accepted', () => {
  const policy = createConsolePolicy()
  policy.response({ status: 404, url: 'http://127.0.0.1/api/v2/baselines/current' })
  assert.throws(() => policy.verify())
  assert.equal(policy.expected(log), true)
  policy.verify()
  policy.expected(log)
  assert.throws(() => policy.verify())
})
test('unexpected errors and unbacked expected errors cannot pass', () => {
  const policy = createConsolePolicy()
  assert.equal(policy.expected([{ value: 'TypeError' }]), false)
  assert.equal(policy.expected([{ value: 'other' }, {}, log[2]]), false)
  policy.expected(log)
  assert.throws(() => policy.verify())
})

test('signed-out startup diagnostics need a matching refresh response and bounded duplication', () => {
  const policy = createConsolePolicy()
  const renew = [{value:'[features/auth/accountClient.ts:renew] Operation failed'}, {}, {value:'expected:auth-renew-401'}]
  const me = [{value:'[features/auth/accountClient.ts:me] Operation failed'}, {}, {value:'expected:auth-me-401'}]
  policy.expected(renew)
  assert.throws(() => policy.verify())
  policy.response({status:401,url:'http://127.0.0.1/api/v2/auth/refresh'})
  policy.expected(me); policy.expected(me)
  policy.verify()
  policy.expected(me)
  assert.throws(() => policy.verify())
})
