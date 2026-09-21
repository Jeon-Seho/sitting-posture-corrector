/** Presentation only: keep the existing change score and CSV contract unchanged. */
export function postureScore(changeScore: number | null): number | null {
  if (changeScore === null || !Number.isFinite(changeScore)) return null
  return Math.round((1 - Math.max(0, Math.min(1, changeScore))) * 1000) / 10
}
