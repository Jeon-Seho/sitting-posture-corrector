// GP-0125: identify the packaged app and the exact local model, without retraining.
import { readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
const root = new URL('../', import.meta.url)
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const bytes = await readFile(new URL('public/face-model.json', root))
const model = JSON.parse(bytes)
const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const workingTreeModified = !!execFileSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).trim()
const builtAt = new Date().toISOString()
const info = { appVersion: pkg.version, buildId: builtAt.replace(/[-:.]/g, ''), builtAt, sourceCommit, workingTreeModified, modelSha256: createHash('sha256').update(bytes).digest('hex'), modelSchema: model.version, synthetic: model.synthetic }
await writeFile(new URL('public/face-build.json', root), JSON.stringify(info, null, 2) + '\n')
console.log(`Face Lab ${info.appVersion} / ${info.buildId} / model ${info.modelSha256.slice(0,12)}`)
