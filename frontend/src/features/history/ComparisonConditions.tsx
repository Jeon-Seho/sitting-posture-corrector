import {
  comparisonConditions,
  comparisonWarnings,
  COMPARE_RULES,
  RECORD_SOURCE_LABEL,
  type ComparisonConditions as Conditions,
} from '../../lib/comparison'
import type { RecordItem } from '../../lib/serviceStore'
import { RuleDescription } from './RuleDescription'

/** Conditions explain the existing comparison; they do not filter or recalculate its metrics. */
export function ComparisonConditions({
  early,
  recent,
}: {
  early: RecordItem[]
  recent: RecordItem[]
}) {
  const first = comparisonConditions(early)
  const last = comparisonConditions(recent)
  const warnings = comparisonWarnings(comparisonConditions([...early, ...recent]))
  return (
    <section className="comparison-conditions" aria-label="기록 비교 조건">
      <h4>비교에 포함된 기록의 조건</h4>
      <p className="fine">
        아래 조건이 다르거나 확인되지 않으면 수치 변화가 자세 개선을 뜻하지 않을 수 있습니다. 기존
        합산 기준을 유지하며, 조건 차이 때문에 기록을 추가로 제외하지 않습니다.
      </p>
      {warnings.length > 0 && (
        <ul className="history-warnings" aria-label="비교 해석 주의">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      <div className="scroll-x">
        <table className="history-conditions-table">
          <thead>
            <tr>
              <th>조건</th>
              <th>처음 {COMPARE_RULES.days}일</th>
              <th>최근 {COMPARE_RULES.days}일</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">판정 출처</th>
              <td>
                <Sources conditions={first} />
              </td>
              <td>
                <Sources conditions={last} />
              </td>
            </tr>
            <tr>
              <th scope="row">적용 설정</th>
              <td>
                <Settings conditions={first} />
              </td>
              <td>
                <Settings conditions={last} />
              </td>
            </tr>
            <tr>
              <th scope="row">모델 버전</th>
              <td>
                <Models conditions={first} />
              </td>
              <td>
                <Models conditions={last} />
              </td>
            </tr>
            <tr>
              <th scope="row">개인 기준</th>
              <td>
                <Baselines conditions={first} />
              </td>
              <td>
                <Baselines conditions={last} />
              </td>
            </tr>
            <tr>
              <th scope="row">서버 종료 확인</th>
              <td>
                <Confirmation conditions={first} />
              </td>
              <td>
                <Confirmation conditions={last} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Sources({ conditions }: { conditions: Conditions }) {
  if (conditions.sources.length === 0) return <span>기록 없음</span>
  return (
    <ul>
      {conditions.sources.map(({ source, sessions }) => (
        <li key={source}>
          {RECORD_SOURCE_LABEL[source]} · {sessions}회
        </li>
      ))}
    </ul>
  )
}

function Settings({ conditions }: { conditions: Conditions }) {
  return (
    <>
      {conditions.settings.map(({ rules, sessions }, index) => (
        <div className="history-setting" key={index}>
          <RuleDescription rules={rules} />
          <span className="fine">이 설정으로 {sessions}회 측정</span>
        </div>
      ))}
      {conditions.missingSettings > 0 && <p>기록에 없음 · {conditions.missingSettings}회</p>}
      {conditions.settings.length === 0 && conditions.missingSettings === 0 && '기록 없음'}
    </>
  )
}

function Models({ conditions }: { conditions: Conditions }) {
  return (
    <>
      {conditions.modelVersions.map((version) => (
        <p key={version}>
          <code>{version}</code>
        </p>
      ))}
      {conditions.missingModelVersions > 0 && (
        <p>확인할 수 없음 · {conditions.missingModelVersions}회</p>
      )}
      {conditions.unmeasuredModels > 0 && <p>추론 결과 없음 · {conditions.unmeasuredModels}회</p>}
      {conditions.sources.length === 0 && '기록 없음'}
    </>
  )
}

function Baselines({ conditions }: { conditions: Conditions }) {
  const hasDemo = conditions.sources.some(({ source }) => source === 'demo')
  return (
    <>
      {conditions.baselineIds.length > 0 && (
        <details>
          <summary>저장된 기준 ID {conditions.baselineIds.length}개</summary>
          <ul>
            {conditions.baselineIds.map((id) => (
              <li key={id}>
                <code>{id}</code>
              </li>
            ))}
          </ul>
        </details>
      )}
      {conditions.missingBaselineIds > 0 && (
        <p>기준 ID가 기록에 없음 · {conditions.missingBaselineIds}회</p>
      )}
      {hasDemo && <p>합성 시연에는 실제 개인 기준을 적용하지 않습니다.</p>}
      {conditions.sources.length === 0 && '기록 없음'}
    </>
  )
}

function Confirmation({ conditions }: { conditions: Conditions }) {
  const servers = conditions.sources.find(({ source }) => source === 'camera-server')?.sessions ?? 0
  if (servers === 0) return <span>서버 기록 없음</span>
  return (
    <>
      <p>종료 확인 {servers - conditions.unconfirmedServerSessions}회</p>
      {conditions.unconfirmedServerSessions > 0 && (
        <p className="warn">종료 미확인 {conditions.unconfirmedServerSessions}회</p>
      )}
    </>
  )
}
