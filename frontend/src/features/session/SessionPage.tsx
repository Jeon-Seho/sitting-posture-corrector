import type { CameraController } from '../../hooks/useCamera'
import type { CollectionController } from '../../hooks/useCollection'
import type { Rules } from '../../lib/engine'
import { SessionLive } from './SessionLive'
import { SessionResult } from './SessionResult'
import { useSessionScreen } from './useSessionScreen'
import type { SessionService } from './types'

type Props = {
  service?: SessionService
  collection: CollectionController
  rules: Rules
  alertsOn: boolean
  onFinish: () => void
  onDashboard: () => void
  onPrepare: () => void
  camera: CameraController
  mode: 'camera' | 'demo'
}

export function SessionPage(props: Props) {
  const screen = useSessionScreen(props)
  const { service, collection, onPrepare, onDashboard } = props
  if (screen.phase === 'ended') {
    return (
      <SessionResult
        service={service}
        isCamera={screen.isCamera}
        collection={collection}
        live={screen.live}
        keepRate={screen.keepRate}
        perHour={screen.perHour}
        intervals={screen.intervals}
        recoveries={screen.recoveries}
        mutedCount={screen.mutedCount}
        muted={screen.muted}
        onPrepare={onPrepare}
        onDashboard={onDashboard}
        onReset={screen.restartDemo}
        onExport={screen.canExport ? screen.exportFeatures : undefined}
        exportCount={screen.exportCount}
      />
    )
  }
  return <SessionLive screen={screen} {...props} />
}
