import assert from 'node:assert/strict'
import { until } from './cdp.mjs'

const USER_KEYS = [
  'posegood.v2.profile',
  'posegood.v2.records',
  'posegood.v2.draft',
  'posegood.v2.settings',
  'posegood.v2.demo',
]

/** Send real browser keyboard events; DOM dispatchEvent cannot exercise native Tab or Escape. */
async function press(app, key, shift = false) {
  const virtualKeys = { Tab: 9, Enter: 13, Escape: 27 }
  const params = {
    key,
    code: key,
    windowsVirtualKeyCode: virtualKeys[key],
    nativeVirtualKeyCode: virtualKeys[key],
    modifiers: shift ? 8 : 0,
  }
  await app.cdp.call('Input.dispatchKeyEvent', {
    type: 'keyDown',
    ...params,
    // Native button activation needs the Enter character event as well as keyDown/keyUp.
    ...(key === 'Enter' ? { text: '\r', unmodifiedText: '\r' } : {}),
  })
  await app.cdp.call('Input.dispatchKeyEvent', { type: 'keyUp', ...params })
}

async function storedUserData(app) {
  return app.evaluate(
    `JSON.stringify(${JSON.stringify(USER_KEYS)}.map((key) => [key, localStorage.getItem(key)]))`,
  )
}

async function focused(app, label, inside = true) {
  return app.evaluate(`(() => {
    const active = document.activeElement;
    const modal = document.querySelector('dialog[open]');
    return active?.textContent.trim() === ${JSON.stringify(label)} &&
      ${inside ? '!!modal?.contains(active)' : '!modal && !!active?.isConnected'};
  })()`)
}

async function open(app, trigger, title) {
  assert.ok(
    await app.evaluate(`(() => {
    const button = [...document.querySelectorAll('button')].find((item) =>
      item.getClientRects().length && !item.disabled && item.textContent.trim() === ${JSON.stringify(trigger)});
    if (!button) return false;
    button.focus(); return document.activeElement === button;
  })()`),
    `Focus dialog trigger: ${trigger}`,
  )
  await app.click(trigger)
  await until(
    async () =>
      (await focused(app, '취소')) &&
      (await app.evaluate(`(() => {
    const modal = document.querySelector('dialog[open]');
    const title = modal && document.getElementById(modal.getAttribute('aria-labelledby'));
    return modal?.matches(':modal') && title?.textContent === ${JSON.stringify(title)};
  })()`)),
    `native modal and cancellation focus: ${title}`,
  )
}

async function closedWithFocus(app, trigger) {
  await until(() => focused(app, trigger, false), `restored focus: ${trigger}`)
}

async function backdropClick(app) {
  // The native dialog is centered; the top-left viewport corner lies in its actual backdrop.
  assert.ok(
    await app.evaluate(`(() => {
    const bounds = document.querySelector('dialog[open]').getBoundingClientRect();
    return bounds.left > 1 || bounds.top > 1;
  })()`),
    'Native dialog backdrop must be outside the panel at (0,0).',
  )
  await app.cdp.call('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: 0,
    y: 0,
    button: 'left',
    clickCount: 1,
  })
  await app.cdp.call('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: 0,
    y: 0,
    button: 'left',
    clickCount: 1,
  })
}

/** Exercise both real dialogs under the application's existing StrictMode entry. */
async function cancellations(app, { name, trigger, title, confirm, screenshot }) {
  const before = await storedUserData(app)
  await open(app, trigger, title)
  if (screenshot) await app.browser.screenshot(screenshot)
  app.check(`${name} starts with cancellation focus in a native modal`, await focused(app, '취소'))
  const backgroundBlocked = await app.evaluate(`(() => {
    const trigger = [...document.querySelectorAll('button')].find((item) => item.textContent.trim() === ${JSON.stringify(trigger)});
    trigger.focus();
    return document.querySelector('dialog[open]').contains(document.activeElement);
  })()`)
  app.check(`${name} blocks background programmatic focus`, backgroundBlocked)
  await press(app, 'Tab')
  app.check(`${name} Tab reaches confirmation within the modal`, await focused(app, confirm))
  await press(app, 'Tab', true)
  app.check(`${name} Shift+Tab returns to cancellation`, await focused(app, '취소'))
  await press(app, 'Tab', true)
  app.check(`${name} Shift+Tab wraps from first to last action`, await focused(app, confirm))
  await press(app, 'Tab')
  app.check(`${name} Tab wraps from last to first action`, await focused(app, '취소'))
  await press(app, 'Escape')
  await closedWithFocus(app, trigger)
  app.check(
    `${name} Escape cancels, preserves data and restores trigger focus`,
    before === (await storedUserData(app)),
  )

  await open(app, trigger, title)
  await backdropClick(app)
  await closedWithFocus(app, trigger)
  app.check(
    `${name} backdrop cancels, preserves data and restores trigger focus`,
    before === (await storedUserData(app)),
  )

  await open(app, trigger, title)
  await press(app, 'Enter') // Initial focus is cancellation, never the destructive action.
  await closedWithFocus(app, trigger)
  app.check(
    `${name} Enter on initial cancellation preserves data`,
    before === (await storedUserData(app)),
  )
}

export async function verifyArchiveDialog(app) {
  const options = {
    name: 'unconfirmed archive dialog',
    trigger: '서버 종료 미확인 · 확인된 요약만 보관',
    title: '확인된 요약만 보관',
    confirm: '확인된 요약 보관',
  }
  await cancellations(app, options)
  await open(app, options.trigger, options.title)
  await press(app, 'Tab')
  assert.ok(await focused(app, options.confirm))
  await press(app, 'Enter')
  await until(
    () =>
      app.evaluate(
        `!document.querySelector('dialog[open]') && document.body.innerText.includes('서버 종료를 확인하지 못했습니다')`,
      ),
    'keyboard archive completion',
  )
  await until(
    () =>
      app.evaluate(
        `document.activeElement !== document.body && document.activeElement.isConnected && !!document.activeElement.getClientRects().length`,
      ),
    'archive fallback focus after React removes the triggering control',
  ).catch(async (error) => {
    const diagnostic = await app.evaluate(`({
      active: document.activeElement.outerHTML.slice(0, 400),
      modal: !!document.querySelector('dialog[open]'),
      main: document.querySelector('main')?.className,
      controls: [...document.querySelectorAll('main button')].map((element) => ({
        text: element.textContent.trim(), disabled: element.disabled, tabindex: element.tabIndex,
        visible: !!element.getClientRects().length, hidden: !!element.closest('[hidden], [inert]')
      })),
    })`)
    throw new Error(`${error.message}; focus diagnostic: ${JSON.stringify(diagnostic)}`)
  })
  app.check(
    'keyboard archive closes the modal with connected visible fallback focus',
    await app.evaluate(
      `document.activeElement !== document.body && document.activeElement.isConnected && !!document.activeElement.getClientRects().length`,
    ),
  )
}

export async function verifyWithdrawalDialog(app) {
  await app.click('설정')
  await app.click('프로필 설정')
  const before = await storedUserData(app)
  await app.click('탈퇴하기')
  app.check(
    'withdrawal introduction alone leaves synthetic user data untouched',
    before === (await storedUserData(app)),
  )
  const options = {
    name: 'withdrawal dialog',
    trigger: '삭제하기',
    title: '탈퇴하고 자료를 삭제할까요?',
    confirm: '확인',
    screenshot: 'withdrawal-dialog',
  }
  await cancellations(app, options)
  // The final destructive path uses only this isolated browser's synthetic fixtures.
  await open(app, options.trigger, options.title)
  await press(app, 'Tab')
  assert.ok(await focused(app, options.confirm))
  await press(app, 'Enter')
  await until(
    () =>
      app.evaluate(
        `!document.querySelector('dialog[open]') && ${JSON.stringify(USER_KEYS)}.every((key) => localStorage.getItem(key) === null)`,
      ),
    'explicit synthetic-only withdrawal completion',
  )
  await until(
    () =>
      app.evaluate(
        `document.activeElement !== document.body && document.activeElement.isConnected && !!document.activeElement.getClientRects().length`,
      ),
    'withdrawal fallback focus after trigger removal',
  )
  app.check(
    'explicit synthetic-only withdrawal deletes user keys and moves focus after trigger removal',
    await app.evaluate(
      `!document.querySelector('dialog[open]') && document.activeElement !== document.body && ${JSON.stringify(USER_KEYS)}.every((key) => localStorage.getItem(key) === null)`,
    ),
  )
}
