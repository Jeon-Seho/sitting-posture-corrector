import type { CameraController } from '../hooks/useCamera'
import type { CollectionController } from '../hooks/useCollection'
import { CollectionPage } from '../pages/CollectionPage'
import { CameraWindow } from '../features/camera/CameraWindow'

/** Local CSV capture does not require a profile or read/write the account API. */
export function CollectionEntry({ camera, collection, onBack }: {
  camera: CameraController
  collection: CollectionController
  onBack: () => void
}) {
  const unsaved = collection.active || (collection.count > 0 && !collection.downloaded)
  return (
    <main className="collection-entry">
      <video ref={camera.videoRef} className="capture-source" muted playsInline aria-hidden="true" />
      <div className="collection-entry-nav">
        <strong>PoseGood · 자세 데이터 수집</strong>
        <button className="btn" disabled={unsaved} onClick={onBack}>시작 화면으로</button>
      </div>
      {unsaved && <p className="fine">돌아가기 전에 촬영을 마치고 CSV를 내려받아 주세요.</p>}
      <CollectionPage camera={camera} collection={collection} />
      <CameraWindow camera={camera} />
    </main>
  )
}
