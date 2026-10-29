/** Shared app identity; navigation and status icons keep their own meanings. */
export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 512 512" fill="none" aria-hidden="true" width={42} height={42} focusable="false">
      <rect x="16" y="16" width="480" height="480" rx="96" fill="var(--logo-bg, #25272d)" />
      <circle cx="197" cy="114" r="48" fill="var(--logo-ink, #f5f5f1)" />
      <path d="M197 220V290Q197 316 223 316H308Q334 316 334 342V402"
        stroke="var(--logo-ink, #f5f5f1)" strokeWidth="64" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
