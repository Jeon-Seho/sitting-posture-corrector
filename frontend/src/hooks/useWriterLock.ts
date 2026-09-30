import { useEffect, useRef, useState } from 'react'
import { claimWriter, type WriterState } from '../lib/writerLock'

export function useWriterLock() {
  const [state, setState] = useState<WriterState>('checking')
  const [attempt, setAttempt] = useState(0)
  const sequence = useRef<Promise<unknown>>(Promise.resolve())
  useEffect(() => {
    setState('checking')
    let disposed = false, release: ReturnType<typeof claimWriter> | undefined
    // StrictMode may dispose an effect before the browser grants its lock.
    // Wait for that canceled request to settle before requesting ownership again.
    sequence.current = sequence.current.then(() => {
      if (disposed) return
      release = claimWriter(navigator.locks, setState)
      return release.finished
    })
    return () => { disposed = true; release?.() }
  }, [attempt])
  return { state, retry: () => setAttempt(n => n + 1) }
}
