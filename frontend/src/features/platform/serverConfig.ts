/**
 * How the app finds the server. Build-time Vite variable; the app always talks to the server
 * (2026-10-21, no local mode).
 *
 * - VITE_API_BASE_URL=https://… API origin when the page is served elsewhere (Vercel
 *                              `app.posegood.site` → `https://api.posegood.site`, docs/design/fe/fe-server-proposal.md 2.1).
 *                              Unset = same origin (`API_ROOT/...`, and `ws(s)://<page host>API_ROOT/realtime`).
 *
 * Development API calls go through the Vite proxy (`/api` → POSEGOOD_API_URL, default
 * http://127.0.0.1:8090, WebSocket included); see vite.config.ts.
 */
/**
 * Where every REST and WebSocket path starts: `/api`, cut by the gateway. Paths have no version
 * (`/api/v2/…` → `/api/…`, 2026-11-09, FE proposal 요구 3).
 */
export const API_ROOT = '/api'

export const SERVER = {
  apiBase: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, ''),
} as const
