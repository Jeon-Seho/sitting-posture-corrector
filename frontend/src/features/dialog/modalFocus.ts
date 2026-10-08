import type { KeyboardEvent } from 'react'

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

function focusableWithin(container: HTMLElement) {
  return [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) =>
      element.tabIndex >= 0 &&
      !element.matches(':disabled') &&
      !element.closest('[hidden], [inert]') &&
      element.getClientRects().length > 0,
  )
}

/** Native modality blocks background interaction; the explicit cycle keeps Tab inside the panel. */
export function trapTab(event: KeyboardEvent<HTMLDialogElement>) {
  if (event.key !== 'Tab') return
  const dialog = event.currentTarget
  const elements = focusableWithin(dialog)
  const activeIndex = elements.indexOf(dialog.ownerDocument.activeElement as HTMLElement)
  event.preventDefault()
  if (elements.length === 0) {
    dialog.focus()
    return
  }
  const nextIndex = event.shiftKey
    ? activeIndex <= 0
      ? elements.length - 1
      : activeIndex - 1
    : activeIndex < 0 || activeIndex === elements.length - 1
      ? 0
      : activeIndex + 1
  elements[nextIndex].focus()
}

export function activateModal(dialog: HTMLDialogElement, initialFocus: HTMLButtonElement | null) {
  const document = dialog.ownerDocument
  const trigger = document.activeElement as HTMLElement | null
  dialog.showModal()
  initialFocus?.focus()

  return {
    close() {
      if (dialog.open) dialog.close()
    },
    restoreFocus() {
      if (document.querySelector('dialog[open]')) return // StrictMode replay or a newer modal.
      if (
        trigger?.isConnected &&
        trigger !== document.body &&
        !trigger.matches(':disabled') &&
        !trigger.closest('[hidden], [inert]') &&
        trigger.getClientRects().length > 0
      ) {
        trigger.focus({ preventScroll: true })
        if (document.activeElement === trigger) return
      }
      const nextPage =
        document.querySelector<HTMLElement>('main') ??
        document.querySelector<HTMLElement>('#root') ??
        document.body
      // The page landmark survives its controls being replaced by the confirmed result.
      if (!nextPage.hasAttribute('tabindex')) nextPage.tabIndex = -1
      nextPage.focus({ preventScroll: true })
    },
  }
}
