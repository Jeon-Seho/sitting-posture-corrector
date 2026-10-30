import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { launchChrome } from './chrome.mjs'
import { until, delay } from './cdp.mjs'

// Explicit opt-in: creates then closes an example.invalid account on the supplied test server.
const [base, executable] = process.argv.slice(2)
if (!base || !executable) throw new Error('Usage: node tools/browser/jwt-integration.mjs <Vite test URL> <Chrome path>')
const folder = await mkdtemp(join(tmpdir(), 'posegood-jwt-'))
await mkdir(join(folder, 'artifacts'))
const browser = await launchChrome({ executable, port: 19449, profile: join(folder, 'profile'), artifactFolder: join(folder, 'artifacts') })
const { cdp } = browser
const fill = async (name, value) => cdp.evaluate(`(() => {
  const input = document.querySelector('input[name="${name}"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(value)});
  input.dispatchEvent(new Event('input', { bubbles: true }));
})()`)
const button = async label => cdp.evaluate(`(() => {
  const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(label)});
  if (!button) throw new Error('Button not found'); button.click();
})()`)
const body = () => cdp.evaluate('document.body.innerText')
let fixture = null
try {
  await cdp.call('Page.navigate', { url: base })
  await until(async () => (await body()).includes('비밀번호 재설정'), 'login screen')
  await delay(400)
  const before = browser.requests.length
  await fill('email', 'admin'); await fill('password', '1234'); await button('로그인')
  await until(async () => (await body()).includes('개발자 계정 · 서버 연결 없음'), 'developer login')
  await delay(500)
  assert.equal(browser.requests.slice(before).some(r => /\/api\//.test(r.url)), false, 'developer entry must not call API')
  await browser.screenshot('developer')
  await cdp.evaluate('document.querySelector(".me-profile").click()')
  await button('로그아웃')
  await until(async () => (await body()).includes('비밀번호 재설정'), 'developer logout')
  console.log('PASS developer login/logout: no API calls and native form validation bypass')
  const email = await cdp.evaluate(`(async () => {
    const { createAccountClient } = await import('/src/features/auth/accountClient.ts');
    const { allAgreed, consentPayload } = await import('/src/features/auth/consents.ts');
    window.testClient = createAccountClient({ channel: false });
    window.testEmail = 'test-it-ui-' + crypto.randomUUID() + '@example.invalid';
    await window.testClient.register({ email: window.testEmail, password: 'Synthetic-test-1234!', profile: { name: '합성 UI 검증' }, consents: consentPayload(allAgreed()) });
    await window.testClient.logout();
    return window.testEmail;
  })()`)
  fixture = email
  await fill('email', email); await fill('password', 'Synthetic-test-1234!'); await button('로그인')
  await until(async () => (await body()).includes('합성 UI 검증') && !(await body()).includes('비밀번호 재설정'), 'real JWT login')
  await until(async () => browser.requests.some(r => /\/api\/v2\/records$/.test(r.url) && r.headers.Authorization?.startsWith('Bearer ')), 'authenticated records')
  assert.equal((await body()).includes('개발자 계정 · 서버 연결 없음'), false)
  await cdp.call('Page.reload')
  await delay(700)
  await until(async () => (await body()).includes('합성 UI 검증') && !(await body()).includes('비밀번호 재설정'), 'JWT refresh restoration')
  await browser.screenshot('jwt-restored')
  assert.equal(browser.errors.length, 0, browser.errors.join('\n'))
  console.log('PASS real JWT UI login, authenticated records, cookie refresh after reload')
  await cdp.evaluate('document.querySelector(".me-profile").click()')
  await button('프로필 설정')
  await until(async () => await cdp.evaluate('document.querySelector("input[name=serverName]")?.value === "합성 UI 검증"'), 'server profile loaded')
  await fill('serverName', '합성 UI 변경')
  await button('프로필 서버 저장')
  await until(async () => (await body()).includes('서버에 저장했어요.'), 'profile saved on server')
  console.log('PASS profile editing through current JWT server')
} finally {
  try { if (fixture) {
    const login = await fetch(new URL('/api/v2/auth/login', base), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: fixture, password: 'Synthetic-test-1234!' }) })
    const auth = await login.json()
    const response = await fetch(new URL('/api/v2/auth/account', base), { method: 'DELETE', headers: { Authorization: `Bearer ${auth.access_token}`, 'X-PoseGood-User-Id': auth.user_id, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'Synthetic-test-1234!' }) })
    assert.equal(response.status, 204, 'synthetic account cleanup')
    console.log('PASS synthetic account closed (server retention policy applies)')
  } } finally {
  await browser.stop()
  if (!folder.startsWith(join(tmpdir(), 'posegood-jwt-'))) throw new Error('Unexpected temporary directory')
  await rm(folder, { recursive: true, force: true })
  }
}
