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
  optional = false,
  optionalEnabled = true,
}: {
  form: ProfileFieldValues
  canWrite: boolean
  nameMax?: number
  optional?: boolean
  optionalEnabled?: boolean
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
        나이{optional && ' (선택)'}
        <ValidatedInput name="age" validationLabel="나이"
          className="input"
          disabled={!canWrite || !optionalEnabled}
          type="number"
          min={optional ? 14 : 1}
          max={120}
          value={age ?? ''}
          onChange={(e) => setAge(e.target.value === '' ? null : Number(e.target.value))}
          required={!optional}
        />
      </label>
      <label className="field">
        직업{optional && ' (선택)'}
        <ValidatedInput name="occupation" validationLabel="직업"
          className="input"
          disabled={!canWrite || !optionalEnabled}
          value={occupation}
          onChange={(e) => setOccupation(e.target.value)}
          required={!optional}
          maxLength={80}
        />
      </label>
    </>
  )
}
