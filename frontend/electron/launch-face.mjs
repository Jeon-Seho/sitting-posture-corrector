import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import electron from 'electron'
const root = fileURLToPath(new URL('../', import.meta.url))
const server = await createServer({ root, mode: 'face-lab', server: { port: 5186, strictPort: true } })
await server.listen()
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE
const child = spawn(electron, [fileURLToPath(new URL('./face-main.cjs', import.meta.url))], { env, stdio: 'inherit' })
child.once('exit', async code => { await server.close(); process.exitCode = code ?? 1 })
child.once('error', async error => { console.error(error); await server.close(); process.exitCode = 1 })
