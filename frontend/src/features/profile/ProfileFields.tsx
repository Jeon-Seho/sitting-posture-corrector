import type { ProfileForm } from './useProfileForm'
import { ValidatedInput } from '../../components/InlineForm'

export type ProfileFieldValues = Pick<
  ProfileForm,
  'name' | 'age' | 'occupation' | 'setName' | 'setAge' | 'setOccupation'
>
export function ProfileFields({
  form,
  canWrite,
  nameMax = 50,
}: {
  form: ProfileFieldValues
  canWrite: boolean
  nameMax?: number
}) {
  const { name, age, occupation, setName, setAge, setOccupation } = form
  return (
    <>
      <label className="field">
        이름
        <ValidatedInput name="name" validationLabel="이름"
          className="input"
          disabled={!canWrite}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={nameMax}
        />
      </label>
      <label className="field">
        나이
        <ValidatedInput name="age" validationLabel="나이"
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
        <ValidatedInput name="occupation" validationLabel="직업"
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
