/** Detach accepted data from transports/callers, then prevent accidental ledger rewrites. */
export function immutableCopy<T>(value: T): T {
  const copy = structuredClone(value)
  function freeze(item: unknown) {
    if (item !== null && typeof item === 'object') {
      Object.values(item).forEach(freeze)
      Object.freeze(item)
    }
  }
  freeze(copy)
  return copy
}
