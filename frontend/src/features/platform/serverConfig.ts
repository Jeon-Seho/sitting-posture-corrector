/**
 * How the app finds the server. Build-time Vite variable; the app always talks to the server
 * (2026-10-21, no local mode).
 *
 * - VITE_API_BASE_URL=https://… API origin when the page is served elsewhere (Vercel
 *                              `app.posegood.site` → `https://api.posegood.site`, docs/design/fe-server-proposal.md 9장).
 *                              Unset = same origin (`/api/...`, and `ws(s)://<page host>/api/v2/realtime`).
 *
 * Development API calls go through the Vite proxy (`/api` → POSEGOOD_API_URL, default
 * http://127.0.0.1:8090, WebSocket included); see vite.config.ts.
 */
export const SERVER = {
  apiBase: ((import.meta.env.VITE_API_BASE_URL as string | undefined) ?? '').replace(/\/+$/, ''),
} as const
