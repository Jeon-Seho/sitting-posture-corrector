// Focused KST daily-counter tests; no browser, account, API or database is started.
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const frontend = fileURLToPath(new URL('../../frontend/', import.meta.url))
const vitest = resolve(frontend, 'node_modules/vitest/vitest.mjs')

export function verifyMidnight() {
  if (!existsSync(vitest)) {
    console.error('Frontend dependencies are missing. Run: python tools/dev.py setup-frontend')
    return 1
  }
  const result = spawnSync(
    process.execPath,
    [vitest, 'run', 'src/features/storage/dailyMeasurement.test.ts'],
    { cwd: frontend, stdio: 'inherit', windowsHide: true },
  )
  if (result.error) console.error(result.error.message)
  return result.status ?? 1
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  if (process.argv.length !== 2) {
    console.error('Usage: node tools/browser/midnight.mjs')
    process.exitCode = 2
  } else {
    process.exitCode = verifyMidnight()
  }
}
