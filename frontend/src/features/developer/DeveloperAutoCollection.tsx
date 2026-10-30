import { useState } from 'react'
import type { AutoNormalCollectionController } from './useAutoNormalCollection'
import { AUTO_NORMAL_CLEAN_SELECTION, AUTO_NORMAL_THRESHOLDS, type AutoNormalExclusion } from './autoNormalCollection'
import './auto-collection.css'

const clock = (ms: number) => `${Math.floor(ms / 60_000).toString().padStart(2, '0')}:${((ms % 60_000) / 1000).toFixed(1).padStart(4, '0')}`
const excludedNames: Record<AutoNormalExclusion, string> = { outside: '선별 기준 밖', stability: '1초 유지 확인 중', quality: '낮은 품질·관측 끊김', registration: '기준 등록 전', timing: '중복·시각 불일치', provenance: '기준·모델 정보 불일치', rate: '초당 10행 제한', synthetic: '합성 입력', paused: '수집 꺼짐', full: '저장 한도' }
export default function DeveloperAutoCollection({ collection, compact = false }: { collection: AutoNormalCollectionController; compact?: boolean }) {
  const { snapshot, error } = collection
  const [participantCode, setParticipantCode] = useState(snapshot.participantCode)
  const [showRows, setShowRows] = useState(!compact)
  const rows = showRows ? snapshot.recentRows : snapshot.recentRows.slice(0, 3)
  return <section className={`lab-panel da-collection${compact ? ' da-compact' : ''}`} aria-label="정상 자세 자동 수집">
    <header className="da-header"><div><span className="da-eyebrow">초기 실험 자료</span><h3>정상 자세 자동 수집</h3>
      <p>상대 모양 거리 <strong>{snapshot.maximumDeviation * 100}% 이하</strong>와 종합 <strong>{AUTO_NORMAL_CLEAN_SELECTION.maximumPostureScore}배 이내</strong>를 함께 확인합니다.</p></div>
      <label className="da-toggle"><input type="checkbox" checked={snapshot.enabled} onChange={event => collection.setEnabled(event.target.checked)} />자동 수집 {snapshot.enabled ? '켜짐' : '꺼짐'}</label>
    </header>
    <div className="da-threshold"><label>자동 선별 기준 <select aria-label="자동 정상 선별 기준" value={snapshot.maximumDeviation} onChange={event => collection.setMaximumDeviation(Number(event.target.value))}>{AUTO_NORMAL_THRESHOLDS.map(value => <option key={value} value={value}>{value * 100}%{value === .06 ? ' · 기본' : ''}</option>)}</select></label><span>변경한 다음 행부터 새 구간 · 개발 실험값</span></div>
    <p className="da-caution">실측 룰이 범위 안이고 위 조건이 1초 이어진 뒤 새 행을 모읍니다. 이탈·복귀 확인 중과 큰 몸 변화는 제외합니다.</p>
    {!!snapshot.requiresReviewRows && <p className="da-error" role="status">이전 선별 자료 {snapshot.requiresReviewRows.toLocaleString()}행 · 재검토 필요 · 보존 중이며 이 파일의 학습 사용을 차단합니다.</p>}
    <div className="da-summary"><strong>{snapshot.total.toLocaleString()}<span>행</span></strong><div><span className={`da-state da-${snapshot.status}`} />{snapshot.reason}</div></div>
    <div className="da-quality-summary"><span>연속 학습 후보 <strong>{snapshot.diagnostics.candidateWindows.toLocaleString()}창</strong></span><span>최장 연속 구간 <strong>{(snapshot.diagnostics.longestSegmentMs / 1000).toFixed(1)}초</strong></span><span>기준 밖 <strong>{snapshot.diagnostics.excluded.outside.toLocaleString()}프레임</strong></span><span>품질·끊김 제외 <strong>{snapshot.diagnostics.excluded.quality.toLocaleString()}프레임</strong></span></div>
    <details className="da-diagnostics"><summary>수집 제외 이유 · 전달된 {snapshot.diagnostics.received.toLocaleString()}프레임</summary><dl>{Object.entries(excludedNames).map(([key, label]) => <div key={key}><dt>{label}</dt><dd>{snapshot.diagnostics.excluded[key as AutoNormalExclusion].toLocaleString()}</dd></div>)}<div><dt>연속 구간 중단</dt><dd>{snapshot.diagnostics.interruptions.toLocaleString()}</dd></div></dl><p>후보 창은 3.2초 이상 이어진 구간에서 100ms 간격으로 계산합니다. 학습·정확도 검증 완료 수가 아니며, 실제 학습 전에 모델 출처와 좌표를 다시 검사합니다.</p></details>
    <p className="da-caution">정상자세(자동) · 규칙으로 붙인 임시 라벨 · 평가 정답 아님</p>
    <div className="da-actions"><button type="button" className="lab-button" disabled={!snapshot.total} onClick={collection.downloadDataset}>자동 데이터 JSON 다운로드</button>
      <button type="button" className="lab-button" disabled={!snapshot.total || snapshot.enabled} onClick={collection.discard}>비우기</button>
      <button type="button" className="lab-button da-row-toggle" aria-expanded={showRows} onClick={() => setShowRows(value => !value)}>{showRows ? '수집 행 접기' : '수집 행 보기'}</button></div>
    {(showRows || compact) && <div className="da-details">{showRows && <div className="da-metadata"><label>익명 참여자 코드<input value={participantCode} disabled={snapshot.enabled} onChange={event => setParticipantCode(event.target.value)} /></label>
      <button type="button" className="lab-button" disabled={snapshot.enabled || participantCode.trim() === snapshot.participantCode} onClick={() => collection.setParticipantCode(participantCode)}>코드 적용</button>
      <span>일시정지 후 수정 · 이전 행의 코드는 유지</span></div>}
      <div className="da-table-wrap"><table><caption>최근 {rows.length}행 · 최신순</caption><thead><tr><th scope="col">행</th><th scope="col">측정 시각</th><th scope="col">거리 / 선별 기준</th><th scope="col">라벨</th></tr></thead>
        <tbody>{rows.length ? rows.map(row => <tr key={row.row}><td>{row.row.toLocaleString()}</td><td>{clock(row.observationTimeMs)}</td><td>{(row.deviation * 100).toFixed(3)}% / {row.maximumDeviation * 100}%</td><td><span className="da-label">{row.displayLabel}</span>{row.selectionPolicy !== AUTO_NORMAL_CLEAN_SELECTION.policy && <small> · 이전 기준 · 재검토 필요</small>}</td></tr>) : <tr><td colSpan={4} className="da-empty">조건에 맞는 행을 기다립니다. 기준 밖·품질 제외 수를 확인하거나 선별 기준을 조절해 보세요.</td></tr>}</tbody></table></div>
    </div>}
    <p className="da-footnote">최대 초당 10행 · {snapshot.maximumRows.toLocaleString()}행 한도. 원본 좌표는 이 탭 메모리에만 보관하며 새로고침하면 사라집니다. 다운로드 파일에는 좌표와 등록 기준이 포함됩니다. 합성 데모·가림·등록 중 프레임은 제외하며, 정상 모델에 자동 적용하지 않습니다.</p>
    {error && <p className="da-error" role="alert">{error}</p>}
  </section>
}
