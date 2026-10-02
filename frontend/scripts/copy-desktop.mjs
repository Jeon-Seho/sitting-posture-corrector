import { copyFile } from 'node:fs/promises'

const source = new URL('../release/PoseGood.exe', import.meta.url)
const destination = new URL('../PoseGood.exe', import.meta.url)
await copyFile(source, destination)
console.log('Portable app ready: frontend/PoseGood.exe')
