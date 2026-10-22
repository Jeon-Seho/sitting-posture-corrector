/**
 * Every switch that decides how the app talks to the server, in one place
 * (docs/design/fe-server-integration-map.md). Build-time Vite variables.
 *
 * - VITE_SERVER_ACCOUNTS=true  sign-up, sign-in and sign-out use the account server `/v2/auth`
 *                              (D-66, FE proposal F12). Unset = this device only (the local profile).
 *                              infra/docker/frontend.Dockerfile builds with true.
 *
 * - VITE_REALTIME_URL=ws://…   live intervals over WebSocket (BE `ws`, /v1/realtime); unset = HTTP.
 * - VITE_REALTIME_FRAMES=true  send coordinate frames (posture.frames.v1) instead of feature deltas,
 *                              once BE `ws` accepts them. Prepared, not wired yet (F1).
 *
 * - VITE_API_BASE_URL=https://… API origin when the page is served elsewhere (Vercel
 *                              `app.posegood.site` → `https://api.posegood.site`, docs/design/fe-domain-idea.md).
 *                              Unset = same origin (`/api/...`).
 *
 * Development API calls go through the Vite proxy (`/api` → POSEGOOD_API_URL, default
 * http://127.0.0.1:8090); see vite.config.ts.
 */
export const SERVER = {
  accounts: import.meta.env.VITE_SERVER_ACCOUNTS === 'true',
  apiBase: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, ''),
  realtimeUrl: (import.meta.env.VITE_REALTIME_URL as string | undefined) || undefined,
  framesProtocol: import.meta.env.VITE_REALTIME_FRAMES === 'true',
} as const
