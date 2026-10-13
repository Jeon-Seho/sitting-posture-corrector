// Explicit synthetic input + local ignored actual weights. Run with Node transform-types.
import fs from 'node:fs'
import { readForecastWeights, predictLstm } from '../../model/prototype/forecast.ts'
const model = readForecastWeights(JSON.parse(fs.readFileSync(new URL('../public/research-model/forecast.json', import.meta.url))))
const fixture = JSON.parse(fs.readFileSync(new URL('../../runs/panoptic/browser-parity/explicit-synthetic-parity.json', import.meta.url)))
const actual = predictLstm(model, fixture.input)
const error = Math.max(...actual.map((v, i) => Math.abs(v - fixture.expected[i])))
if (!(error < 0.00001)) throw new Error(`Python/browser LSTM mismatch: ${error}`)
console.log(JSON.stringify({ source_sha256: model.source_sha256, max_absolute_error: error, status: 'PASS' }))
