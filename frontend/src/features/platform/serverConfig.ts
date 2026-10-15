/**
 * Every switch that decides how the app talks to the server, in one place
 * (docs/design/fe-server-integration-map.md). Build-time Vite variables. The old account mode
 * (VITE_SERVER_ACCOUNTS) was removed 2026-10-13; sign-in is local until BE `auth` exists.
 *
 * - VITE_REALTIME_URL=ws://…   live intervals over WebSocket (BE `ws`, /v1/realtime); unset = HTTP.
 * - VITE_REALTIME_FRAMES=true  send coordinate frames (posture.frames.v1) instead of feature deltas,
 *                              once BE `ws` accepts them. Prepared, not wired yet (F1).
 *
 * Development API calls go through the Vite proxy (`/api` → POSEGOOD_API_URL, default
 * http://127.0.0.1:8090); see vite.config.ts.
 */
export const SERVER = {
  realtimeUrl: (import.meta.env.VITE_REALTIME_URL as string | undefined) || undefined,
  framesProtocol: import.meta.env.VITE_REALTIME_FRAMES === 'true',
} as const
