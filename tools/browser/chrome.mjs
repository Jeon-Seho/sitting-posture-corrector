import { spawn } from 'node:child_process'
import { writeFile } from 'node:fs/promises'
import { Cdp, until } from './cdp.mjs'

export async function launchChrome({ executable, port, profile, artifactFolder }) {
  const chrome = spawn(executable, [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--remote-debugging-address=127.0.0.1',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] })
  let stderr = ''
  let spawnError = null
  chrome.stderr.on('data', (data) => {
    stderr = (stderr + data).slice(-4000)
  })
  chrome.on('error', (error) => {
    spawnError = error
    stderr += String(error)
  })
  const exited = () => chrome.exitCode !== null || chrome.signalCode !== null
  const killAndWait = async () => {
    if (!exited()) chrome.kill('SIGKILL')
    if (!spawnError) await until(exited, 'Chrome process exit after forced shutdown', 5000)
  }
  try {
    const target = await until(async () => {
      if (spawnError || exited()) throw new Error(`Chrome failed to start: ${stderr}`)
      try {
        const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
        return targets.find((candidate) => candidate.type === 'page')
      } catch {
        return null
      }
    }, 'isolated Chrome readiness')
    const cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    const errors = []
    const requests = []
    cdp.on(
      'Network.requestWillBeSent',
      ({ request }) => {
        if (new URL(request.url).pathname.startsWith('/api/')) requests.push(request)
      }
    )
    cdp.on(
      'Runtime.exceptionThrown',
      ({ exceptionDetails }) => errors.push(exceptionDetails.exception?.description ?? exceptionDetails.text)
    )
    cdp.on(
      'Runtime.consoleAPICalled',
      ({ type, args }) => {
        if (type === 'error') errors.push(args.map((arg) => arg.value ?? arg.description).join(' '))
      }
    )
    cdp.on(
      'Log.entryAdded',
      ({ entry }) => {
        // Network failures are inspected via their expected status in the scenarios.
        // JavaScript/compiler errors must always fail verification.
        if (entry.level === 'error' && entry.source !== 'network') errors.push(entry.text)
      }
    )
    cdp.on(
      'Page.javascriptDialogOpening',
      () => {
        void cdp.call('Page.handleJavaScriptDialog', { accept: true })
      }
    )
    await Promise.all(['Page.enable', 'Runtime.enable', 'Log.enable', 'Network.enable'].map((method) => cdp.call(method)))
    await cdp.call(
      'Emulation.setDeviceMetricsOverride',
      {
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        mobile: false
      }
    )
    return {
      cdp,
      errors,
      requests,
      async screenshot(name) {
        const { data } = await cdp.call(
          'Page.captureScreenshot',
          {
            format: 'png',
            captureBeyondViewport: false
          }
        )
        await writeFile(`${artifactFolder}/${name}.png`, Buffer.from(data, 'base64'))
      },
      async stop() {
        try {
          await cdp.call('Browser.close')
        } catch { /* Chrome may close the socket before returning. */ }
        cdp.close()
        try {
          await until(exited, 'Chrome shutdown', 5000)
        } catch {
          await killAndWait()
        }
      },
    }
  } catch (error) {
    await killAndWait()
    throw error
  }
}
