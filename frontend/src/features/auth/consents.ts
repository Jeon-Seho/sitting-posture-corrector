/** Sign-up consents from docs/design/consent-proposal.md. Bump the version when any notice changes. */
export const CONSENT_VERSION = '2026-10-13'

export type ConsentId = 'C1' | 'C2' | 'C3' | 'C4' | 'C5' | 'C6'
export type ConsentChoices = Partial<Record<ConsentId, boolean>>
export type ConsentNotice = { items: string; purpose: string; retention: string; refusal: string }
export type ConsentItem = {
  id: ConsentId
  title: string
  required: boolean
  /** One line shown under the title without opening the details. */
  note?: string
  notice?: ConsentNotice
}

const RETENTION = '탈퇴 후 30일'

export const CONSENTS: ConsentItem[] = [
  {
    id: 'C1',
    title: '서비스 이용약관',
    required: true,
    notice: {
      items: '없음',
      purpose: 'PoseGood 이용 규칙. 의료기기가 아니며 자세를 돌아보도록 돕는 보조 도구예요. 약관 전문은 준비 중이에요.',
      retention: '이용하는 동안',
      refusal: '동의하지 않으면 가입할 수 없어요.',
    },
  },
  {
    id: 'C2',
    title: '회원가입 정보 수집·이용',
    required: true,
    notice: {
      items: '이메일, 비밀번호(복원할 수 없는 형태로 저장), 이름',
      purpose: '로그인과 계정 관리',
      retention: RETENTION,
      refusal: '동의하지 않으면 가입할 수 없어요.',
    },
  },
  {
    id: 'C3',
    title: '선택 정보(나이·직업) 수집·이용',
    required: false,
    notice: {
      items: '나이, 직업',
      purpose: '사용자 환경별 통계',
      retention: RETENTION,
      refusal: '동의하지 않아도 불이익이 없어요. 나이·직업을 입력하지 않아요.',
    },
  },
  {
    id: 'C4',
    title: '카메라 관절 좌표 수집·이용',
    required: true,
    note: '영상·사진은 기기 밖으로 보내지 않아요.',
    notice: {
      items: '관절 9곳(코·눈·귀·입 양끝·어깨)의 화면 좌표와 시각',
      purpose: '자세 판정과 교정 알림',
      retention: RETENTION,
      refusal: '동의하지 않으면 측정을 할 수 없어 가입할 수 없어요.',
    },
  },
  {
    id: 'C5',
    title: '측정 기록 저장',
    required: true,
    notice: {
      items: '측정 세션, 자세 이탈 기록, 알림 기록, 일별 통계, 등록한 자세',
      purpose: '결과·기록·통계 화면',
      retention: RETENTION,
      refusal: '동의하지 않으면 결과를 보여 드릴 수 없어 가입할 수 없어요.',
    },
  },
  { id: 'C6', title: '만 14세 이상이에요', required: true },
]

/** Required items must be agreed; optional items need an explicit choice either way. */
export function consentsComplete(choices: ConsentChoices) {
  return CONSENTS.every((item) =>
    item.required ? choices[item.id] === true : typeof choices[item.id] === 'boolean',
  )
}

export function allAgreed(): ConsentChoices {
  return Object.fromEntries(CONSENTS.map((item) => [item.id, true]))
}
