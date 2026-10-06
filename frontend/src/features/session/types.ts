import type { LiveState, Machine, Rules } from '../../lib/engine'
import type { Features } from '../../../../model/prototype/pose'
import type { ServerCheckpoint, ServerSetup } from './server/contracts'

export type ServerSessionDescriptor = {
  baselineId: string
  baseline: Features
  deviceId: string
  frameWidth: number
  frameHeight: number
  setup?: ServerSetup
  checkpoint?: ServerCheckpoint
  finishOnly?: boolean
}

export type ServiceSession = {
  id: string
  startedAt: string
  mode: 'camera' | 'demo'
  rules: Rules
  initial?: Machine
  server?: ServerSessionDescriptor
}

export type SessionService = {
  active: boolean
  initial?: Machine
  onCheckpoint: (machine: Machine) => void
  onEnded: (live: LiveState) => void
  saveMessage: string
  onRetry: () => void
}
