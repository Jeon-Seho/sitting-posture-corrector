import { readFile } from 'node:fs/promises'
const model = JSON.parse(await readFile(new URL('../public/lab-model.json', import.meta.url), 'utf8'))
if (model.version !== 1 || typeof model.synthetic !== 'boolean' || !model.weights) throw new Error('Train the lab model before packaging.')
