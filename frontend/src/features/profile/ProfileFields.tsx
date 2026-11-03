import { useEffect, useState } from 'react'
import type { ProfileForm } from './useProfileForm'
import { ValidatedInput } from '../../components/InlineForm'

export type ProfileFieldValues = Pick<
  ProfileForm,
  'name' | 'age' | 'occupation' | 'setName' | 'setAge' | 'setOccupation'
>
export function ProfileFields({
  form,
  canWrite,
  nameMax = 30,
  optionalInfo = true,
}: {
  form: ProfileFieldValues
  canWrite: boolean
  nameMax?: number
  /** Hide age and occupation when sign-up consent C3 was declined. */
  optionalInfo?: boolean
}) {
  const { name, age, occupation, setName, setAge, setOccupation } = form
  // The box keeps what was typed: Number('') is 0, so clearing it used to leave a 0 that typing
  // then prefixed (「024」). An empty box is NaN, which the profile check rejects like any bad age.
  const [ageText, setAgeText] = useState(() => (Number.isFinite(age) ? String(age) : ''))
  useEffect(() => {
    setAgeText((text) => (Number(text) === age || (text === '' && !Number.isFinite(age)) ? text : String(age)))
  }, [age])
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
      {optionalInfo && (
        <>
          <label className="field">
            나이
            <ValidatedInput name="age" validationLabel="나이"
              className="input"
              disabled={!canWrite}
              type="number"
              min={14}
              max={120}
              value={ageText}
              onChange={(e) => {
                setAgeText(e.target.value)
                setAge(e.target.value === '' ? Number.NaN : Number(e.target.value))
              }}
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
      )}
    </>
  )
}
