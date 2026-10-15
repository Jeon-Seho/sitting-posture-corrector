/**
 * A value like "35분 50초" or "3번" with the digits large and heavy and the units small and
 * light (Pretendard Variable weights, 2026-10-13), so the number reads first.
 */
export function Amount({ value }: { value: string }) {
  const parts = value.split(/(\d[\d.,]*)/).filter(Boolean)
  return (
    <span className="amount">
      {parts.map((part, i) =>
        /^\d/.test(part) ? (
          <span key={i} className="amount-n">
            {part}
          </span>
        ) : (
          <span key={i} className="amount-u">
            {part}
          </span>
        ),
      )}
    </span>
  )
}
