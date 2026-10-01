import type { ProfileForm } from './useProfileForm'

export function ProfileFields({ form, canWrite }: { form: ProfileForm; canWrite: boolean }) {
  const { name, age, occupation, setName, setAge, setOccupation } = form
  return (
    <>
      <label className="field">
        이름
        <input
          className="input"
          disabled={!canWrite}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={50}
        />
      </label>
      <label className="field">
        나이
        <input
          className="input"
          disabled={!canWrite}
          type="number"
          min={1}
          max={120}
          value={age}
          onChange={(e) => setAge(Number(e.target.value))}
          required
        />
      </label>
      <label className="field">
        직업
        <input
          className="input"
          disabled={!canWrite}
          value={occupation}
          onChange={(e) => setOccupation(e.target.value)}
          required
          maxLength={80}
        />
      </label>
    </>
  )
}
