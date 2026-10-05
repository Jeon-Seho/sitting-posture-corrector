/** Every entry checks the mode, including direct imports from an ordinary dev URL. */

export function requireSyntheticMode() {
  if (
    !import.meta.env.DEV ||
    import.meta.env.MODE !== 'browser-smoke' ||
    new URLSearchParams(location.search).get('synthetic') !== '1'
  ) {
    throw new Error('Synthetic browser input requires the explicit browser-smoke serve mode and synthetic=1.')
  }
}
