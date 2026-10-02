import { useEffect, useState, type ReactNode } from 'react'
import { ArrowClockwise, Database, LockSimple, X } from '@phosphor-icons/react'
import type { LocalWorkspace } from '../features/storage/useLocalWorkspace'

/**
 * Storage permission and integrity notices. They float as small popups in the
 * bottom-right corner so they never push the screen content around.
 */
export function StorageNotice({
  workspace,
  children,
}: {
  workspace: LocalWorkspace
  /** Extra short status lines (e.g. account settings being saved). */
  children?: ReactNode
}) {
  const { writer, storageIssues, reloadStorage } = workspace
  // Closing hides the popup for the current state only; a new state shows it again.
  const [closed, setClosed] = useState<string | null>(null)
  useEffect(() => {
    setClosed((old) => (old === writer.state ? old : null))
  }, [writer.state])
  const writerNotice = writer.state !== 'ready' && closed !== writer.state
  if (!writerNotice && storageIssues.length === 0 && !children) return null
  return (
    <div className="popup-stack">
      {writerNotice && (
        <section className="popup" role="status">
          <span className="popup-icon" aria-hidden="true">
            <LockSimple size={20} weight="bold" />
          </span>
          <div className="popup-body">
            <div className="popup-title">
              {writer.state === 'checking'
                ? '저장 권한을 확인하고 있어요'
                : writer.state === 'busy'
                  ? '다른 탭에서 사용 중이에요'
                  : '이 브라우저에서는 저장할 수 없어요'}
            </div>
            <p className="popup-desc">
              {writer.state === 'checking'
                ? '잠시만 기다려 주세요.'
                : writer.state === 'busy'
                  ? '다른 탭에서 이 앱을 사용 중입니다. 여기서는 기록을 볼 수 있어요. 바꾸려면 기존 탭을 닫고 다시 확인해 주세요.'
                  : '안전한 동시 저장을 지원하지 않습니다. 최신 Chrome의 localhost 또는 HTTPS에서 열어 주세요.'}
            </p>
            {writer.state === 'busy' && (
              <button
                className="btn btn-sm"
                onClick={() => {
                  reloadStorage()
                  writer.retry()
                }}
              >
                <ArrowClockwise size={15} weight="bold" className="icon" />
                저장 권한 다시 확인
              </button>
            )}
          </div>
          <button
            className="btn btn-quiet btn-icon btn-sm"
            aria-label="안내 닫기"
            onClick={() => setClosed(writer.state)}
          >
            <X size={16} weight="bold" />
          </button>
        </section>
      )}
      {storageIssues.length > 0 && (
        <section className="popup is-alert" role="alert">
          <span className="popup-icon" aria-hidden="true">
            <Database size={20} weight="bold" />
          </span>
          <div className="popup-body">
            <div className="popup-title">저장된 자료를 확인해 주세요</div>
            {storageIssues.map((issue) => (
              <p className="popup-desc" key={issue}>
                {issue}
              </p>
            ))}
            <p className="popup-desc">
              원본 자료를 지우거나 덮어쓰지 않았습니다. 저장소를 다시 읽거나 기존 자료를 확인해 주세요.
            </p>
            <button className="btn btn-sm" onClick={reloadStorage}>
              <ArrowClockwise size={15} weight="bold" className="icon" />
              저장소 다시 읽기
            </button>
          </div>
        </section>
      )}
      {children && (
        <section className="popup" role="status">
          <div className="popup-body">
            <p className="popup-desc">{children}</p>
          </div>
        </section>
      )}
    </div>
  )
}
