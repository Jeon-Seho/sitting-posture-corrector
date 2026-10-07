import { desktopBridge } from './bridge'
import pkg from '../../../package.json'

/**
 * Invisible drag strip across the top of the desktop window. The OS draws only the
 * window buttons (Windows overlay / macOS traffic lights); the app colours run underneath.
 */
export function TitleBar() {
  if (!desktopBridge()) return null
  return <div className="titlebar-drag"><span style={{position:'absolute',left:18,top:10,fontSize:12,color:'#68786c'}}>POSEGOOD v{pkg.version}{import.meta.env.MODE==='posegood-face'?' · 얼굴 모델 적용':''}</span></div>
}
