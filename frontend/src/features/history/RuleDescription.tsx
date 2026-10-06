import type { Rules } from '../../lib/engine'

/** Display every saved rule, including recovery time and the unrounded decision threshold. */
export function RuleDescription({ rules }: { rules: Rules }) {
  const postureThreshold = Number((100 * (1 - rules.threshold)).toFixed(6))
  return (
    <ul className="history-rule-list">
      <li>이탈 확정 {rules.holdSeconds}초</li>
      <li>복귀 확인 {rules.recoverSeconds}초</li>
      <li>같은 사건 재알림 {rules.realertSeconds}초</li>
      <li>
        자세 점수 {postureThreshold}점 이하
        <span className="fine">변화 점수 기준 ≥ {rules.threshold}</span>
      </li>
    </ul>
  )
}
