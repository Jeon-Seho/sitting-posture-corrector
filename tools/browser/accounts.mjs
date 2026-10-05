import assert from 'node:assert/strict'
import { until } from './cdp.mjs'

const BRIDGE = 'window.__POSEGOOD_SYNTHETIC_BROWSER_ONLY__'
const visible = `(element) => !!element.getClientRects().length && !element.closest('[hidden]')`

class AccountDriver {
  constructor(browser, base) {
    this.browser = browser
    this.cdp = browser.cdp
    this.base = base
    this.checks = 0
    this.userId = null
  }

  evaluate(expression) { return this.cdp.evaluate(expression) }

  check(description, condition) {
    assert.ok(condition, description)
    this.checks++
    console.log(`PASS: account browser ${description}`)
  }

  async click(label) {
    await until(() => this.evaluate(`(() => {
      const button = [...document.querySelectorAll('button')].filter(${visible})
        .find((item) => item.textContent.trim() === ${JSON.stringify(label)} && !item.disabled);
      if (!button) return false;
      button.click(); return true;
    })()`), `account button ${label}`)
  }

  async fill(label, value) {
    await until(() => this.evaluate(`(() => {
      const item = [...document.querySelectorAll('label')].filter(${visible})
        .find((item) => item.childNodes[0]?.textContent.trim() === ${JSON.stringify(label)});
      const input = item?.querySelector('input');
      if (!input || input.disabled) return false;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(String(value))});
      input.dispatchEvent(new Event('input', { bubbles: true }));
      return true;
    })()`), `account input ${label}`)
  }

  text(text) {
    return until(() => this.evaluate(`document.body.innerText.includes(${JSON.stringify(text)})`), text)
  }

  async api(path) {
    return this.evaluate(`(async () => {
      const response = await fetch('/api/v1/' + ${JSON.stringify(path)}, {
        credentials: 'same-origin', headers: {'X-PoseGood-User-Id': ${JSON.stringify(this.userId ?? '')}}
      });
      return {status: response.status, value: await response.json()};
    })()`)
  }

  draft() {
    return this.evaluate(`JSON.parse(sessionStorage.getItem('posegood.account.v1.' + ${JSON.stringify(this.userId)} + '.draft') ?? 'null')`)
  }

  async authenticate(email, password, name) {
    if (name) {
      await this.click('새 계정 만들기')
      this.check('signup requires explicit storage consent', await this.evaluate(`!document.querySelector('input[type=checkbox]').checked`))
      await this.fill('이름', name)
      await this.fill('직업', '명시적 합성 회귀')
      await this.evaluate(`document.querySelector('input[type=checkbox]').click()`)
    }
    await this.fill('이메일', email)
    await this.fill('비밀번호', password)
    await this.click(name ? '계정 만들고 시작' : '로그인')
    await this.text('님의 오늘')
    const me = await this.api('auth/me')
    assert.equal(me.status, 200)
    this.userId = me.value.user_id
    this.check('rendered account is authenticated by the real server', me.value.email === email)
  }

  async logout() {
    await this.click('로그아웃')
    await this.text('새 계정 만들기')
    this.check('logout invalidates the cookie session', (await this.api('auth/me')).status === 401)
    this.userId = null
  }

  async frame(milliseconds, kind) {
    const previous = await this.draft()
    await this.evaluate(`${BRIDGE}.frame(${milliseconds}, ${JSON.stringify(kind)})`)
    if (milliseconds === 0) return
    await until(async () => {
      const draft = await this.draft()
      return draft?.server?.view?.last_sequence > previous.server.view.last_sequence && !draft.server.pending
    }, 'account feature acknowledgement')
  }

  async remove(password) {
    await this.click('설정')
    await this.click('프로필 설정')
    await this.click('계정 삭제')
    await this.fill('비밀번호 확인', password)
    await this.click('계정과 기록 삭제')
    await this.text('새 계정 만들기')
    this.check('account deletion logs out and removes its retry material',
      (await this.api('auth/me')).status === 401 && !await this.draft())
    this.userId = null
  }
}

export async function runAccountScenarios(browser, base, tag) {
  const app = new AccountDriver(browser, base)
  const email = `synthetic-browser-${tag}@example.invalid`
  const password = `Synthetic-${tag}`
  await app.cdp.call('Page.navigate', { url: `${base}/?synthetic=1` })
  await app.text('새 계정 만들기')
  await until(() => app.evaluate(`!!${BRIDGE}`), 'explicit synthetic input adapter')
  await app.authenticate(email, password, '합성 계정 A')
  const owner = app.userId
  const initial = await app.api('workspace')
  app.check('new account starts with server records and 3/2/60 settings',
    initial.value.records.length === 0 && initial.value.rules.holdSeconds === 3 &&
    initial.value.rules.recoverSeconds === 2 && initial.value.rules.realertSeconds === 60)

  await app.click('설정')
  await until(() => app.evaluate(`(() => {
    const toggle = document.querySelector('button[aria-label="교정 알림 사용"]');
    if (!toggle || toggle.disabled) return false;
    toggle.click(); return true;
  })()`), 'account alert preference switch')
  await until(async () => (await app.api('workspace')).value.preferences.alerts_on === false, 'saved alert preference')
  await app.cdp.call('Page.reload', { ignoreCache: true })
  await app.text('님의 오늘')
  app.check('settings remain server-owned across reload', (await app.api('workspace')).value.preferences.alerts_on === false)
  await app.click('설정')
  await until(() => app.evaluate(`(() => {
    const toggle = document.querySelector('button[aria-label="교정 알림 사용"]');
    if (!toggle || toggle.disabled) return false;
    toggle.click(); return true;
  })()`), 'restore alert preference')
  await until(async () => (await app.api('workspace')).value.preferences.alerts_on === true, 'restored alert preference')
  await app.click('프로필 설정')
  await app.fill('직업', '변경된 합성 직업')
  await app.click('변경 저장')
  await app.text('프로필을 저장했습니다.')
  app.check('profile changes persist through the server', (await app.api('workspace')).value.profile.occupation === '변경된 합성 직업')
  await app.click('홈')
  await app.click('측정 시작')
  await app.click('카메라 켜기')
  await app.click('기준 등록 시작')
  await app.click('측정 시작')
  const created = await until(async () => {
    const draft = await app.draft()
    return draft?.server?.view && !draft.server.pending ? draft : null
  }, 'real account measurement session', 20000)
  await app.frame(0, 'deviation')
  await app.frame(1000, 'deviation')
  await app.frame(1000, 'deviation')
  await app.frame(1000, 'deviation')
  const measured = await app.draft()
  app.check('account input confirms one event at 3 seconds', measured.server.view.summary.collapse_count === 1)

  await app.cdp.call('Page.reload', { ignoreCache: true })
  await app.text('중단된 측정이 있습니다')
  await app.click('이어하기')
  await app.text('휴식 중')
  app.check('reload restores acknowledged facts without requesting a camera',
    (await app.draft()).id === created.id && (await app.evaluate(`${BRIDGE}.snapshot()`)).permissionCalls === 0)
  await app.click('측정 종료')
  const saved = await until(async () => {
    const result = await app.api('records')
    return result.value?.length === 1 && !await app.draft() ? result.value[0] : null
  }, 'server record save and draft cleanup', 20000)
  app.check('final record retains the exact event and summary',
    saved.server.confirmed && saved.server.view.ended && saved.valid === 3 && saved.events.length === 1)
  await app.click('홈')
  await app.text('이탈 사건')
  await browser.screenshot('account-history')
  app.check('account results are absent from local record storage',
    await app.evaluate(`!localStorage.getItem('posegood.v2.records')`))
  await app.logout()

  const otherEmail = `synthetic-browser-other-${tag}@example.invalid`
  await app.authenticate(otherEmail, password, '합성 계정 B')
  app.check('another account cannot see previous records or session',
    (await app.api('records')).value.length === 0 &&
    (await app.api(`sessions/${created.id}`)).status === 404)
  await app.remove(password)

  await app.authenticate(email, password)
  app.check('logging in again retrieves the original account and record',
    app.userId === owner && (await app.api('records')).value[0].id === saved.id)
  await app.click('설정')
  await app.click('프로필 설정')
  const newPassword = `Changed-${tag}`
  await app.fill('현재 비밀번호', password)
  await app.fill('새 비밀번호', newPassword)
  await app.click('비밀번호 변경')
  await app.text('새 계정 만들기')
  app.check('password change revokes the current cookie session', (await app.api('auth/me')).status === 401)
  await app.authenticate(email, newPassword)
  app.check('new password retains existing account records', (await app.api('records')).value[0].id === saved.id)
  await app.remove(newPassword)
  app.check('synthetic flow never called real camera permissions',
    (await app.evaluate(`${BRIDGE}.snapshot()`)).permissionCalls === 0)
  return app.checks
}
