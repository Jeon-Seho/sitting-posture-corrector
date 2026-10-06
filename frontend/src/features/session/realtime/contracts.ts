import type {
  DecisionEvent,
  DeviationType,
  FrameRequest,
  ServerObservation,
  ServerSummary,
} from '../server/contracts'

/** WebSocket frames of contracts/realtime/realtime-ws.v1.schema.json (draft). Bodies reuse the HTTP contracts. */
export type ClientMessage =
  | { type: 'hello'; schema_version: '1.0'; session_id: string; last_event_id: number }
  | { type: 'features'; session_id: string; items: FrameRequest[] }

export type ServerMessage =
  | { type: 'ack'; session_id: string; last_sequence: number }
  | { type: 'observation'; session_id: string; observation: ServerObservation }
  | { type: 'progress'; session_id: string; last_sequence: number; summary: ServerSummary }
  | { type: 'decision'; session_id: string; event: DecisionEvent; summary: ServerSummary }
  | {
      type: 'alert'
      session_id: string
      event_id: number
      kind: 'collapse_confirmed' | 'reminder'
      deviation_type: DeviationType
    }
  | { type: 'stalled'; session_id: string; since_last_sequence: number }
  | { type: 'closed'; session_id: string; reason: ClosedReason }

export type ClosedReason = 'ended' | 'unauthorized' | 'not_owner' | 'session_lost' | 'server_shutdown'

/** The contract limits one features frame to 30 intervals. */
export const MAX_BATCH_ITEMS = 30
