import { useSyncExternalStore } from 'react'
import type { Page } from '../../app/navigation'
import { ApiError } from '../platform/api'

/**
 * Error pages are only for a screen that could not load its own data (fe-design-request 1장).
 * Mistakes the user can fix — wrong password, taken email, missing posture — keep their own
 * messages next to the input, and saving or deleting keeps its notice. `records` (R1) feeds
 * 오늘·기록 and `rules` (W1) feeds 측정하기·설정, so a background record check never covers the
 * settings screen.
 */
export type PageErrorSource = 'records' | 'rules'
export type PageErrorKind = 'request' | 'server' | 'offline'
export type PageError = {
  kind: PageErrorKind
  /** HTTP status; null when no answer came back. */
  status: number | null
  at: number
  retry: () => void
}

export const PAGE_ERROR_SCREENS: Record<PageErrorSource, Page[]> = {
  records: ['dashboard', 'calendar'],
  rules: ['setup', 'settings'],
}

/** 400번대 and 500번대 are each one page; 401 is the login flow and anything else stays inline. */
export function pageErrorKind(error: unknown): PageErrorKind | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === null) {
    if (error.kind !== 'network') return null
    return isOnline() ? 'server' : 'offline'
  }
  if (error.status === 401) return null
  if (error.status >= 500) return 'server'
  return error.status >= 400 ? 'request' : null
}

let errors: Partial<Record<PageErrorSource, PageError>> = {}
const listeners = new Set<() => void>()
const notify = () => { for (const listener of listeners) listener() }

export function reportPageError(source: PageErrorSource, error: unknown, retry: () => void) {
  const kind = pageErrorKind(error)
  if (!kind) return
  errors = { ...errors, [source]: { kind, status: error instanceof ApiError ? error.status : null, at: Date.now(), retry } }
  notify()
}

/** A later successful load of the same data takes the page away. */
export function clearPageError(source?: PageErrorSource) {
  if (source ? !errors[source] : !Object.keys(errors).length) return
  if (source) { errors = { ...errors }; delete errors[source] } else errors = {}
  notify()
}

/** Reloads what failed; used by the page's button and when the device comes back online. */
export function retryPageErrors() {
  for (const error of Object.values(errors)) error?.retry()
}

const pageErrors = () => errors
export function usePageErrors() {
  return useSyncExternalStore(subscribe, pageErrors, pageErrors)
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** `navigator.onLine === false` is reliable; `true` only means a network exists, so a failed request still decides. */
function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function subscribeOnline(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function') return () => {}
  window.addEventListener('online', listener)
  window.addEventListener('offline', listener)
  return () => { window.removeEventListener('online', listener); window.removeEventListener('offline', listener) }
}

export function useOnline() {
  return useSyncExternalStore(subscribeOnline, isOnline, () => true)
}
