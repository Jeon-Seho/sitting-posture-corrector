import { useEffect, useState } from 'react'
import { kstDay } from '../lib/kstDay'
export function useKstDay() {
  const [day, setDay] = useState(() => kstDay(Date.now()))
  useEffect(() => {
    const refresh = () => setDay(kstDay(Date.now()))
    const timer = setInterval(refresh, 1000)
    if (typeof window !== 'undefined') window.addEventListener('focus', refresh)
    return () => { clearInterval(timer); if (typeof window !== 'undefined') window.removeEventListener('focus', refresh) }
  }, [])
  return day
}
