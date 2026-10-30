import { useEffect, useRef, useState } from 'react'
import { detectorFallback } from '../camera/detectorFallback'

const scenarios = { fallback: 'GPU 실패 → CPU 성공', failed: 'GPU·CPU 모두 실패', timeout: '준비 시간 초과', cancel: '전환 중 취소' } as const
export function CameraFaultTests() {
  const [running, setRunning] = useState(false)
  const [output, setOutput] = useState('')
  const generation = useRef(0)
  useEffect(() => () => { generation.current++ }, [])
  async function run(scenario: keyof typeof scenarios) {
    const token = ++generation.current
    let current = true
    let closed = 0
    const attempts: string[] = []
    setRunning(true)
    setOutput('실행 중…')
    try {
      const result = await detectorFallback(async (delegate) => {
        attempts.push(delegate)
        await new Promise(resolve => setTimeout(resolve, scenario === 'timeout' ? 120 : 20))
        if (scenario !== 'timeout' && delegate === 'GPU') throw new Error('Synthetic GPU failure')
        if (scenario === 'failed') throw new Error('Synthetic CPU failure')
        if (scenario === 'cancel') current = false
        return { close: () => { closed++ } }
      }, () => current && token === generation.current, 'GPU', scenario === 'timeout' ? 40 : 1000)
      result?.detector.close()
      if (token === generation.current) setOutput(`${result ? result.delegate + ' 성공' : '취소 완료'} · 시도 ${attempts.join(' → ')} · 자원 해제 ${closed}`)
    } catch (error) {
      console.error('[developer] Synthetic detector scenario', error)
      // Wait for the deliberately late model to verify its cleanup as well.
      await new Promise(resolve => setTimeout(resolve, 150))
      if (token === generation.current) setOutput(`${scenario === 'timeout' ? '시간 초과 확인' : '실패 확인'} · 시도 ${attempts.join(' → ')} · 자원 해제 ${closed}`)
    } finally { if (token === generation.current) setRunning(false) }
  }
  return <div>
    <p className="fine">실제 초기화와 같은 GPU→CPU 복구 함수를 합성 오류로 실행합니다. 카메라·서버·측정 기록은 사용하지 않습니다.</p>
    <div className="row" style={{ flexWrap: 'wrap' }}>{Object.entries(scenarios).map(([key, label]) => <button className="chip" key={key} disabled={running} onClick={() => void run(key as keyof typeof scenarios)}>{label}</button>)}</div>
    <p role="status">{output}</p>
  </div>
}
