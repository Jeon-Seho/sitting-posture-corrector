// 바로가기용: 개발 서버 준비 → 앱 실행 → 앱 종료 시 서버도 종료.
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({ root, server: { host: '127.0.0.1', port: 5174, strictPort: true } })
await server.listen()
const port = server.httpServer.address().port
const env = { ...process.env, POSEGOOD_DEV_URL: `http://127.0.0.1:${port}/` }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [fileURLToPath(new URL('./main.cjs', import.meta.url))], { env, stdio: 'inherit' })
child.once('error', async error => { console.error(error); await server.close(); process.exitCode = 1 })
child.once('exit', async code => { await server.close(); process.exitCode = code ?? 1 })

