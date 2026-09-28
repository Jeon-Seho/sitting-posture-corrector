import type { Profile } from '../lib/serviceStore'

export const EMPTY_PROFILE: Profile = { name: '', age: 23, occupation: '' }

export function ProfileFields({ value, onChange }: { value: Profile; onChange: (next: Profile) => void }) {
  return (
    <>
      <label className="field">
        이름
        <input className="input" value={value.name} onChange={e => onChange({ ...value, name: e.target.value })} required maxLength={50} />
      </label>
      <label className="field">
        나이
        <input className="input" type="number" min={1} max={120} value={value.age}
          onChange={e => onChange({ ...value, age: Number(e.target.value) })} required />
      </label>
      <label className="field">
        직업
        <input className="input" value={value.occupation} onChange={e => onChange({ ...value, occupation: e.target.value })} required maxLength={80} />
      </label>
    </>
  )
}
