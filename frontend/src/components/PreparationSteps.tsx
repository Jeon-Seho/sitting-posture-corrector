import { Check } from './icons'
import { useSlidingThumb } from './Segmented'

/** Shared real setup indicator and developer motion preview. */
export function PreparationSteps({ step, labels }: { step: number; labels: string[] }) {
  const { ref, thumb } = useSlidingThumb<HTMLOListElement>('.step-mark.active')
  return <ol ref={ref} className={`steps ${thumb ? 'has-drop' : ''}`} style={{ margin: 0, padding: 0, listStyle: 'none' }}>
    {thumb && <li className="step-drop" aria-hidden="true" style={{ width: thumb.w, height: thumb.h, transform: `translate(${thumb.x}px, ${thumb.y}px)` }}>
      <span key={step} className="step-drop-fluid" />
    </li>}
    {labels.map((label, i) => <li className="step" key={i} aria-current={step === i ? 'step' : undefined}>
      <span className={`step-mark ${step > i ? 'done' : step === i ? 'active' : ''}`}>
        {step > i ? <Check size={16} weight="bold" /> : i + 1}
      </span>
      <div className="step-title">{label}</div>
    </li>)}
  </ol>
}
