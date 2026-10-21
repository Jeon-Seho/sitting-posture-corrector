export function boldNumbers(value: string | number) {
  const text = String(value)
  if (!/\d/.test(text)) return text
  return text.split(/(\d+(?:[.,]\d+)*)/).map((part, index) =>
    index % 2 ? <b className="oc-number" key={index}>{part}</b> : part,
  )
}
