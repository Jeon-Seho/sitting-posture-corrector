import { createContext } from 'react'
export type ObservationPanel = 'metrics' | 'table' | 'replay'
type ObservationPreview = {
  replayHost: HTMLDivElement | null
  setReplayVisible: (visible: boolean) => void
}
export const ObservationPreviewContext = createContext<ObservationPreview | null>(null)
