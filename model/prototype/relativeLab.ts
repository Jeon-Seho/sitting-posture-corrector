/** Independent synthetic LSTM experiment; never selected by the service app. */
import { features, type Features, type Landmark } from './pose'

export type LabState = 'normal' | 'movement' | 'deviation' | 'waiting' | 'unmeasurable'
export interface LabModel {
  version: number; synthetic: boolean; labels: string[]; frames: number; intervalMs: number
  inputSize: number; hiddenSize: number; mean: number[]; scale: number[]
  numLayers?: number
  weights: Record<string, number[][] | number[]>
  probe?: { sequence: number[][]; logits: number[] }
}
export function validateModel(value: unknown): LabModel {
  const m = value as LabModel
  if (!m || m.version !== 1 || typeof m.synthetic !== 'boolean' || m.inputSize !== 6 || m.hiddenSize !== 16 ||
    m.frames !== 30 || m.intervalMs !== 100 || JSON.stringify(m.labels) !== '["normal","movement","deviation"]')
    throw new Error('실험 모델 형식이 맞지 않습니다.')
  const vector = (v: unknown, n: number): v is number[] => Array.isArray(v) && v.length === n && v.every(Number.isFinite)
  const matrix = (v: unknown, rows: number, columns: number) => Array.isArray(v) && v.length === rows && v.every(r => vector(r, columns))
  if (!vector(m.mean, 6) || !vector(m.scale, 6) || m.scale.some(s => s <= 0) || !m.weights ||
    !matrix(m.weights['lstm.weight_ih_l0'], 64, 6) || !matrix(m.weights['lstm.weight_hh_l0'], 64, 16) ||
    !vector(m.weights['lstm.bias_ih_l0'], 64) || !vector(m.weights['lstm.bias_hh_l0'], 64) ||
    !matrix(m.weights['head.weight'], 3, 16) || !vector(m.weights['head.bias'], 3)) throw new Error('실험 모델 가중치가 손상됐습니다.')
  if ((m.numLayers ?? 1) !== 1 && m.numLayers !== 2) throw new Error('Unsupported LSTM layers')
  if (m.numLayers === 2 && (!matrix(m.weights['lstm.weight_ih_l1'], 64, 16) || !matrix(m.weights['lstm.weight_hh_l1'], 64, 16) || !vector(m.weights['lstm.bias_ih_l1'], 64) || !vector(m.weights['lstm.bias_hh_l1'], 64))) throw new Error('Invalid second layer')
  return m
}
export function inferLogits(model: LabModel, rows: number[][]): number[] {
  if (rows.length !== model.frames || rows.some(r => r.length !== 6 || !r.every(Number.isFinite))) throw new Error('Invalid sequence')
  const w = model.weights
  const layers = model.numLayers ?? 1
  const h = Array.from({ length: layers }, () => Array<number>(16).fill(0))
  const c = Array.from({ length: layers }, () => Array<number>(16).fill(0))
  const dot = (a: number[], b: number[]) => a.reduce((sum, v, i) => sum + v * b[i], 0)
  const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))
  for (const row of rows) {
    let x = row.map((v, i) => (v - model.mean[i]) / model.scale[i])
    for (let layer = 0; layer < layers; layer++) {
      const ih = w[`lstm.weight_ih_l${layer}`] as number[][], hh = w[`lstm.weight_hh_l${layer}`] as number[][]
      const bi = w[`lstm.bias_ih_l${layer}`] as number[], bh = w[`lstm.bias_hh_l${layer}`] as number[]
      const gates = ih.map((r, i) => dot(r, x) + dot(hh[i], h[layer]) + bi[i] + bh[i])
      c[layer] = c[layer].map((v, i) => sigmoid(gates[16 + i]) * v + sigmoid(gates[i]) * Math.tanh(gates[32 + i]))
      h[layer] = c[layer].map((v, i) => sigmoid(gates[48 + i]) * Math.tanh(v))
      x = h[layer]
    }
  }
  return (w['head.weight'] as number[][]).map((r, i) => dot(r, h[layers - 1]) + (w['head.bias'] as number[])[i])
}
export function relativeDelta(points: Landmark[], width: number, height: number, baseline: Features): number[] | null {
  const f = features(points, width, height)
  return f ? [f.headGap - baseline.headGap, f.offset - baseline.offset, f.tilt - baseline.tilt] : null
}
export class RelativeLabWindow {
  private rows: number[][] = []
  private previous: number[] | null = null
  private lastTime: number | null = null
  private times: number[] = []
  getTimes() { return [...this.times] }
  reset() { this.rows = []; this.times = []; this.previous = null; this.lastTime = null }
  push(time: number, delta: number[] | null): number[][] | null {
    if (!Number.isFinite(time) || !delta || delta.length !== 3 || !delta.every(Number.isFinite)) { this.reset(); return null }
    if (this.lastTime !== null && (time <= this.lastTime || time - this.lastTime > 350)) this.reset()
    if (this.lastTime !== null && time - this.lastTime < 100) return null
    // Zero velocities at every window's first row, matching training.
    this.rows.push([...delta, ...delta.map((v, i) => this.previous ? (v - this.previous[i]) * 100 / (time - this.lastTime!) : 0)])
    this.lastTime = time; this.previous = delta
    this.times.push(time); this.times = this.times.slice(-30)
    this.rows = this.rows.slice(-30)
    if (this.rows.length < 30) return null
    return this.rows.map((row, i) => i ? [...row] : [...row.slice(0, 3), 0, 0, 0])
  }
}
