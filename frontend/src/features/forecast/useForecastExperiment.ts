import { useEffect, useRef, useState } from 'react'
import { LiveForecastExperiment, liveForecastPoints, readForecastWeights,
  type ForecastReading, type ForecastWeights } from '../../../../model/prototype/forecast'
import type { CameraController } from '../../hooks/useCamera'

export function useForecastExperiment(camera: CameraController) {
  const [model, setModel] = useState<ForecastWeights | null>(null)
  const [error, setError] = useState('')
  const [predictor, setPredictor] = useState<'lstm' | 'hold_last' | 'constant_velocity'>('lstm')
  const [reading, setReading] = useState<ForecastReading | null>(null)
  const core = useRef<LiveForecastExperiment | null>(null)
  const log = useRef<ForecastReading[]>([])
  const latest = useRef(0)
  useEffect(() => {
    const controller = new AbortController()
    void fetch(`${import.meta.env.BASE_URL}research-model/forecast.json`, { signal: controller.signal }).then(async r => {
      if (!r.ok) throw new Error('학습 모델 파일을 찾지 못했습니다. 개발 환경에서 모델을 준비해 주세요.')
      const text = await r.text()
      if (text.length > 1_000_000) throw new Error('예측 모델 파일이 너무 큽니다.')
      setModel(readForecastWeights(JSON.parse(text)))
    }).catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '예측 모델을 준비하지 못했습니다.') })
    return () => controller.abort()
  }, [])
  useEffect(() => {
    core.current = model ? new LiveForecastExperiment(model, predictor) : null
    log.current = []; latest.current = 0; setReading(null)
  }, [model, predictor, camera.state])
  useEffect(() => {
    if (camera.state !== 'on') return
    const publish = (r: ForecastReading) => { setReading(r); log.current.push(r); log.current = log.current.slice(-3000) }
    const unsubscribe = camera.subscribe(frame => {
      const engine = core.current
      if (!engine) return
      latest.current = performance.now()
      try {
        const r = engine.step(frame.timeMs, liveForecastPoints(frame.landmarks, frame.worldLandmarks))
        if (r) publish(r)
      } catch { core.current = new LiveForecastExperiment(engine.model, predictor); setReading(null); setError('시각이나 예측 입력이 바뀌었습니다. 실험 기준을 다시 등록해 주세요.') }
    })
    const timer = setInterval(() => {
      if (latest.current && performance.now() - latest.current > 500 && core.current) {
        publish(core.current.unavailable(performance.now())); latest.current = 0
      }
    }, 250)
    return () => { unsubscribe(); clearInterval(timer) }
  }, [camera.state, camera.subscribe, predictor])
  const register = () => {
    core.current?.register(); log.current = []; setReading(null); setError('')
  }
  const download = () => {
    if (!model || !log.current.length) return
    const payload = { schema_version: 'forecast-experiment-export-v1', model_id: model.model_id,
      model_sha256: model.source_sha256, predictor, domain_validated: false,
      baseline_normality: 'registration_assumption', approximate_point_mapping: true,
      settings: { baseline_ms: 8000, horizon_ms: 300, deviation: .12, recovery: .08,
        sustained_ms: 3000, fallback_ms: 5000, recovery_ms: 3000 }, readings: log.current }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `forecast-experiment-${Date.now()}.json`; a.click()
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
  return { model, error, predictor, setPredictor, reading, register, download }
}
