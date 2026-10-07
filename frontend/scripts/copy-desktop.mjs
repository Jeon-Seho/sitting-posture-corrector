import { access, readFile, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'

if (process.platform !== 'win32') throw new Error('Windows packaging requires Windows')
const frontend = fileURLToPath(new URL('..', import.meta.url))
await access(join(frontend, 'release', 'win-unpacked', 'PoseGood.exe'))
const compiler = join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
await access(compiler)
const version=JSON.parse(await readFile(join(frontend,'package.json'),'utf8')).version
if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Numeric release version required')
const metadata=join(frontend,'release','LauncherVersion.cs')
await writeFile(metadata,`[assembly: System.Reflection.AssemblyFileVersion("${version}.0")]\n[assembly: System.Reflection.AssemblyInformationalVersion("${version}")]\n`)
execFileSync(compiler, [
  '/nologo', '/target:winexe', '/optimize+', '/reference:System.Windows.Forms.dll',
  `/win32icon:${join(frontend, 'public', 'branding', 'posegood-icon.ico')}`,
  `/out:${join(frontend, 'PoseGood.exe')}`, join(frontend, 'electron', 'Launcher.cs'), metadata,
], { stdio: 'inherit', windowsHide: true })
console.log('Fast launcher ready: frontend/PoseGood.exe (keep release/win-unpacked alongside it)')
