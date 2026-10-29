import { useEffect, useState } from 'react'
import { Card } from '../../components/ui'
import { Segmented } from '../../components/Segmented'
import { DEFAULT_APPEARANCE, THEME_PRESETS, illustrationPalette, saveAppearance, useAppearance, validColor, type Appearance } from './theme'

export function AppearanceSettings() {
  const appearance = useAppearance()
  const [hex, setHex] = useState(appearance.accent)
  const [message, setMessage] = useState('')
  useEffect(() => setHex(appearance.accent), [appearance.accent])
  const update = (next: Appearance) => setMessage(saveAppearance(next) ? '이 기기에 저장했어요.' : '화면에는 적용했지만 저장하지 못했어요. 다시 실행하면 유지되지 않을 수 있어요.')
  return <Card title="화면 꾸미기">
    <div className="theme-presets" role="group" aria-label="테마 선택">
      {THEME_PRESETS.map(preset => <button key={preset.id} type="button" className={`theme-preset theme-preset-${preset.id}`}
        aria-pressed={appearance.accent === preset.accent} onClick={() => update({ mode: preset.mode, accent: preset.accent })}>
        <span className="theme-preset-art"><img src={`/illustrations/themes/${illustrationPalette(preset.accent)}-login.webp`} alt="" /><span className="theme-preset-swatch" style={{ background: preset.accent }} /></span>
        <strong>{preset.name}</strong><span>{preset.description}</span>
      </button>)}
    </div>
    <div className="setting-row appearance-row">
      <div><div className="setting-name">화면 모드</div><p className="setting-desc">시스템 설정을 선택하면 컴퓨터의 밝기 모드를 따라가요.</p></div>
      <Segmented label="화면 모드">{(['system', 'light', 'gray', 'dark'] as const).map((mode, i) =>
        <button key={mode} aria-pressed={appearance.mode === mode} onClick={() => update({ ...appearance, mode })}>{['시스템 설정', '라이트', '그레이', '다크'][i]}</button>
      )}</Segmented>
    </div>
    <details className="more appearance-custom"><summary>색상 직접 지정</summary>
    <div className="setting-row appearance-row">
      <div><div className="setting-name">나만의 색상</div><p className="setting-desc">버튼과 사이드바에 적용돼요. 글자는 읽기 편한 색으로 자동 조정해요.</p></div>
      <div className="appearance-colors">
        <label>색상 선택<input type="color" aria-label="테마 색상 선택" value={appearance.accent} onChange={e => update({ ...appearance, accent: e.target.value })} /></label>
        <form onSubmit={e => { e.preventDefault(); if (validColor(hex)) update({ ...appearance, accent: hex }) }}>
          <label>색상 코드<input className="input" name="themeHex" aria-describedby="theme-hex-help" value={hex} maxLength={7} spellCheck={false} onChange={e => setHex(e.target.value)} /></label>
          <button className="btn" disabled={!validColor(hex)}>색상 적용</button>
        </form>
      </div>
    </div>
    <p id="theme-hex-help" className="fine"># 뒤에 여섯 자리 코드를 입력하세요. 예: #6750a4</p>
    </details>
    <div className="appearance-preview"><span>미리보기</span><button type="button" className="btn btn-primary" onClick={() => setMessage('선택한 색상의 버튼이에요.')}>선택한 색상의 버튼</button><span className="pill good">바른 자세</span><span className="pill collapse">자세 알림</span></div>
    <p className="fine">이 기기에만 저장돼요. 자세 상태와 경고 색상은 그대로 유지돼요.</p>
    <p className="fine">데스크톱 앱의 창 아이콘과 알림 팝업도 함께 바뀌어요. 바탕화면 바로가기는 Windows 새로고침이나 다음 실행 후 보일 수 있어요.</p>
    <button type="button" className="btn" onClick={() => update(DEFAULT_APPEARANCE)}>화면 기본값으로 되돌리기</button>
    <p role="status" className="fine">{message}</p>
  </Card>
}
export function AppearanceDiagnostics() {
  const value = useAppearance()
  return <p className="fine">화면 설정: {value.mode} · {value.accent} · 설정 위쪽의 ‘화면 꾸미기’에서 실제 화면을 바꿔 확인할 수 있어요.</p>
}
