import type { LocalWorkspace } from '../features/storage/useLocalWorkspace'

export function StorageNotice({ workspace }: { workspace: LocalWorkspace }) {
  const { writer, storageIssues, reloadStorage } = workspace
  return (
    <>
      {writer.state !== 'ready' && (
        <p role="status">
          {writer.state === 'checking'
            ? '저장소 사용 상태를 확인하고 있습니다.'
            : writer.state === 'busy'
              ? '다른 탭에서 이 앱을 사용 중입니다. 여기서는 기록을 볼 수 있습니다. 변경하려면 기존 탭을 닫고 다시 확인해 주세요.'
              : '이 브라우저에서는 안전한 동시 저장을 지원하지 않습니다. 최신 Chrome의 localhost 또는 HTTPS에서 열어 주세요.'}
          {writer.state === 'busy' && (
            <button
              className="btn btn-sm"
              onClick={() => {
                reloadStorage()
                writer.retry()
              }}
            >
              저장 권한 다시 확인
            </button>
          )}
        </p>
      )}
      {storageIssues.length > 0 && (
        <div role="alert">
          {storageIssues.map((issue) => (
            <p key={issue}>{issue}</p>
          ))}
          <p>
            원본 자료를 지우거나 덮어쓰지 않았습니다. 저장소를 다시 읽거나 기존 자료를 확인해
            주세요.
          </p>
          <button className="btn btn-sm" onClick={reloadStorage}>
            저장소 다시 읽기
          </button>
        </div>
      )}
    </>
  )
}
