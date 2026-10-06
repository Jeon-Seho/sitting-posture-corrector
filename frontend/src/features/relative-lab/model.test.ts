import { describe, expect, it } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { average, features, type Landmark } from '../../../../model/prototype/pose'
import { inferLogits, relativeDelta, RelativeLabWindow, validateModel } from '../../../../model/prototype/relativeLab'

function points(): Landmark[] {
  const p = Array.from({ length: 33 }, () => ({ x: .5, y: .5, z: 0, visibility: .99 }))
  p[0] = { x: .5, y: .3, z: 0, visibility: .99 }
  p[11] = { x: .35, y: .55, z: 0, visibility: .99 }
  p[12] = { x: .65, y: .55, z: 0, visibility: .99 }
  return p
}
describe('relative lab synthetic integration', () => {
  it('keeps relative inputs identical after translation and uniform scaling', () => {
    const original = points(), baseline = average([features(original, 640, 480)!])
    const shifted = original.map(p => ({ ...p, x: (p.x - .5) * 1.2 + .6, y: (p.y - .5) * 1.2 + .6 }))
    relativeDelta(shifted, 640, 480, baseline)!.forEach(v => expect(v).toBeCloseTo(0, 12))
  })
  it('does not hide real head movement while removing body translation', () => {
    const p = points(), baseline = features(p, 640, 480)!
    p[0].x += .1
    expect(relativeDelta(p, 640, 480, baseline)![1]).toBeGreaterThan(.3)
  })
  it('requires contiguous observations and resets on missing, reversed and stale input', () => {
    const w = new RelativeLabWindow()
    for (let t = 0; t < 2900; t += 100) expect(w.push(t, [0, 0, 0])).toBeNull()
    expect(w.push(2900, [0, 0, 0])).toHaveLength(30)
    expect(w.push(4000, [0, 0, 0])).toBeNull()
    expect(w.push(3990, [0, 0, 0])).toBeNull()
    expect(w.push(4100, null)).toBeNull()
    expect(w.push(4200, [0, 0, 0])).toBeNull()
  })
  it('rejects damaged model and nonfinite sequence data', () => {
    expect(() => validateModel({})).toThrow()
  })
  const modelPath = new URL('../../../public/lab-model.json', import.meta.url)
  it.skipIf(!existsSync(modelPath))('matches exported PyTorch logits within 1e-5', () => {
    const model = validateModel(JSON.parse(readFileSync(modelPath, 'utf8')))
    const logits = inferLogits(model, model.probe!.sequence)
    logits.forEach((v, i) => expect(Math.abs(v - model.probe!.logits[i])).toBeLessThan(.00001))
    expect(() => inferLogits(model, [[NaN]])).toThrow()
  })
})
