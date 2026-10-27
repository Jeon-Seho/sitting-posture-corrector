import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { ObservationPreviewContext, type ObservationPanel } from './ObservationPreviewContext'

type PaneState = { replayVisible: boolean; panel: ObservationPanel }
const paneState = (value: boolean | PaneState): PaneState => typeof value === 'boolean' ? { replayVisible: value, panel: value ? 'replay' : 'metrics' } : value
export function ObservationWorkspace({ active, measurement, analysis }: { active: boolean; measurement: ReactNode; analysis: ReactNode | ((setPanel: (panel: ObservationPanel) => void) => ReactNode) }) {
  const [replayHost, setReplayHost] = useState<HTMLDivElement | null>(null)
  const [pane, setPane] = useState<boolean | PaneState>(false)
  const setReplayVisible = useCallback((visible: boolean) => setPane(value => {
    const current = paneState(value)
    return current.replayVisible === visible ? value : { ...current, replayVisible: visible }
  }), [])
  const preview = useMemo(() => ({ replayHost, setReplayVisible, setPanel: (panel: ObservationPanel) => setPane(value => {
    const current = paneState(value)
    return current.panel === panel ? value : { ...current, panel }
  }) }), [replayHost, setReplayVisible])
  const state = paneState(pane), showingReplay = state.replayVisible && !active
  return <ObservationPreviewContext.Provider value={preview}>
    <div className="oc-coview" data-layout="compact" data-mode={state.panel}>
      <div className="oc-preview-pane" data-active={active || showingReplay} data-replaying={showingReplay} hidden={state.panel === 'table'}>
        <div className="oc-live-preview" hidden={showingReplay}>{measurement}</div>
        <div className="oc-replay-preview-host" ref={setReplayHost} hidden={!showingReplay} />
      </div>
      {typeof analysis === 'function' ? analysis(preview.setPanel) : analysis}
    </div>
  </ObservationPreviewContext.Provider>
}
