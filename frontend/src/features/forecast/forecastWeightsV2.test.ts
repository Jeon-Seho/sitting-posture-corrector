import { describe, expect, it } from 'vitest'
import variants from '../../../model-variants.json'
import { LiveForecastExperiment, forecastModelMatchesPoseModel, predictLstm, readForecastWeights, type ForecastWeightsV1, type ForecastWeightsV2 } from '../../../../model/prototype/forecast'

// All weights/inputs in this file are explicitly synthetic, never trained participant data.
const REMOVE = Symbol('remove')
/** Sets or removes one dotted field of a synthetic file, including fields the type would not allow. */
function editField(target: object, path: string, value: unknown) {
  const keys = path.split('.'), last = keys.pop()!
  const parent = keys.reduce((node, key) => node[key] as Record<string, unknown>, target as Record<string, unknown>)
  if (value === REMOVE) delete parent[last]; else parent[last] = value
}
function syntheticV1(): ForecastWeightsV1 {
  return { schema_version: 'forecast-weights-v1', model_id: 'synthetic-v1', source_sha256: 'a'.repeat(64), domain_validated: false,
    config: { steps: 30, dimensions: 39, hidden: 48, horizon: 3, point_definition: 'Panoptic-face9-body4-not-MediaPipe' },
    mean: Array(39).fill(0), scale: Array(39).fill(1), weights: {
      'lstm.weight_ih_l0': Array(192 * 39).fill(0), 'lstm.weight_hh_l0': Array(192 * 48).fill(0),
      'lstm.bias_ih_l0': Array(192).fill(0), 'lstm.bias_hh_l0': Array(192).fill(0),
      'output.weight': Array(39 * 48).fill(0), 'output.bias': Array(39).fill(0),
    } }
}
function syntheticV2(mode: 'pilot' | 'participant_holdout' = 'pilot'): ForecastWeightsV2 {
  const base = syntheticV1(), heldOut = mode === 'participant_holdout'
  return { ...base, schema_version: 'forecast-weights-v2', model_id: 'synthetic-mediapipe-v2', data_domain: 'mediapipe',
    pose_model_id: variants.full.modelId, feature_definition: 'mediapipe-world13-shoulder-normalized-xyz-v1',
    config: { ...base.config, point_definition: 'MediaPipe-13-world-shoulder-normalized-v1' },
    training: { mode, evaluation_scope: heldOut ? 'participant_holdout_forecast_only' : 'training_fit_only',
      participant_generalization_evaluated: heldOut, labels_used: { manual_confirmed_windows: 2, automatic_weak_windows: 3 },
      split_window_counts: { train: 5, validation: heldOut ? 2 : 0, test: heldOut ? 2 : 0 },
      split_participant_counts: { train: 1, validation: heldOut ? 1 : 0, test: heldOut ? 1 : 0 } } }
}

describe('MediaPipe forecast weights v2 provenance and numerical contract', () => {
  it('blocks legacy execution and mismatched live extractors before producing a forecast', () => {
    const model = syntheticV2()
    expect(() => new LiveForecastExperiment(model, 'lstm')).toThrow('/dev')
    const core = new LiveForecastExperiment(model, 'lstm', { mode: 'observed' })
    core.register()
    for (let t = 0; t <= 8000; t += 100) {
      expect(core.step(t, Array(39).fill(0), variants.heavy.modelId)?.state).toBe('unmeasurable')
    }
    expect(core.ready).toBe(false)
    expect(core.predictionDisplay).toBeNull()
    for (let t = 8100; t <= 16100; t += 100) core.step(t, Array(39).fill(0), variants.full.modelId)
    expect(core.ready).toBe(true)
    expect(core.predictionDisplay?.predictor).toBe('lstm')
  })
  it('keeps legacy Panoptic v1 readable and explicit approximate extractor matching', () => {
    const model = readForecastWeights(syntheticV1())
    expect(model.schema_version).toBe('forecast-weights-v1')
    expect(forecastModelMatchesPoseModel(model, undefined)).toBe(true)
    expect(forecastModelMatchesPoseModel(model, 'unknown-extractor')).toBe(true)
  })
  it('loads consistent pilot and holdout metadata without changing 39D prediction math', () => {
    for (const mode of ['pilot', 'participant_holdout'] as const) {
      const model = readForecastWeights(syntheticV2(mode))
      expect(model.schema_version).toBe('forecast-weights-v2')
      expect(predictLstm(model, Array.from({ length: 30 }, () => Array(39).fill(.1)))).toEqual(Array(39).fill(.1))
    }
  })
  it('requires an exact known extractor and tracks the actual bundled variant IDs', () => {
    for (const variant of Object.values(variants)) {
      const input = syntheticV2(); input.pose_model_id = variant.modelId
      const model = readForecastWeights(input)
      expect(forecastModelMatchesPoseModel(model, variant.modelId)).toBe(true)
      expect(forecastModelMatchesPoseModel(model, undefined)).toBe(false)
      expect(forecastModelMatchesPoseModel(model, 'unknown-extractor')).toBe(false)
    }
    expect(forecastModelMatchesPoseModel(readForecastWeights(syntheticV2()), variants.heavy.modelId)).toBe(false)
  })
  it.each<[string, [string, unknown][]]>([
    ['missing training metadata', [['training', REMOVE]]],
    ['wrong domain', [['data_domain', 'panoptic']]],
    ['unknown extractor', [['pose_model_id', 'mediapipe-pose-future']]],
    ['missing extractor', [['pose_model_id', REMOVE]]],
    ['wrong feature coordinates', [['feature_definition', 'image-normalized']]],
    ['wrong point correspondence', [['config.point_definition', 'Panoptic-face9-body4-not-MediaPipe']]],
    ['empty model ID', [['model_id', '']]],
    ['clinical validation claim', [['domain_validated', true]]],
    ['negative count', [['training.labels_used.manual_confirmed_windows', -1]]],
    ['fractional count', [['training.split_window_counts.train', 5.5]]],
    ['unsafe count', [['training.split_window_counts.train', Number.MAX_SAFE_INTEGER + 1]]],
    ['label count mismatch', [['training.labels_used.automatic_weak_windows', 2]]],
    ['empty train', [['training.split_window_counts.train', 0], ['training.labels_used', { manual_confirmed_windows: 0, automatic_weak_windows: 0 }]]],
    ['missing train participant', [['training.split_participant_counts.train', 0]]],
    ['participants exceed windows', [['training.split_participant_counts.train', 6]]],
    ['unknown training mode', [['training.mode', 'frame_random_split']]],
    ['pilot with held-out windows', [['training.split_window_counts.validation', 1]]],
    ['pilot claims generalization', [['training.participant_generalization_evaluated', true]]],
    ['pilot claims held-out evaluation', [['training.evaluation_scope', 'participant_holdout_forecast_only']]],
  ])('rejects %s', (_name, edits) => {
    const input = syntheticV2(); for (const [path, value] of edits) editField(input, path, value)
    expect(() => readForecastWeights(input)).toThrow()
  })
  it('rejects holdout claims without all evaluation counts and matching scope', () => {
    for (const mutate of [
      (v: ForecastWeightsV2) => { v.training.split_window_counts.test = 0 },
      (v: ForecastWeightsV2) => { v.training.split_participant_counts.validation = 0 },
      (v: ForecastWeightsV2) => { v.training.evaluation_scope = 'training_fit_only' },
      (v: ForecastWeightsV2) => { v.training.participant_generalization_evaluated = false },
    ]) { const input = syntheticV2('participant_holdout'); mutate(input); expect(() => readForecastWeights(input)).toThrow() }
  })
  it('rejects non-finite, sparse, wrongly shaped or non-positive numerical inputs', () => {
    for (const mutate of [
      (v: ForecastWeightsV2) => { v.mean[0] = NaN },
      (v: ForecastWeightsV2) => { v.scale[1] = 0 },
      (v: ForecastWeightsV2) => { delete v.mean[2] },
      (v: ForecastWeightsV2) => { v.weights['output.bias'].pop() },
      (v: ForecastWeightsV2) => { v.weights['lstm.weight_ih_l0'][3] = Infinity },
      (v: ForecastWeightsV2) => { v.config.steps = 29 },
    ]) { const input = syntheticV2(); mutate(input); expect(() => readForecastWeights(input)).toThrow() }
  })
})
