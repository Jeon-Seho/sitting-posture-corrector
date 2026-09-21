export const POSTURES = {
  unlabeled: '확인 불가 / 여러 자세가 섞임', upright: '기준 자세', lean_left: '몸통 왼쪽 기울임',
  lean_right: '몸통 오른쪽 기울임', trunk_forward: '몸통 앞으로 숙임',
  head_forward: '머리만 앞으로 내밈', transition: '자세 전환 중',
} as const
export type Label = keyof typeof POSTURES
export const PRESENCE = { seated: '앉아 있음', away: '자리 비움', transition: '일어서기 / 복귀 중', unknown: '확인 불가' } as const
export type Presence = keyof typeof PRESENCE
export const VIEWS = { front: '정면', right: '우측', left: '좌측', oblique: '비스듬한 방향' } as const
export const LAYOUTS = { single: '모니터 1대', dual_left: '보조 모니터 왼쪽', dual_right: '보조 모니터 오른쪽', notebook: '모니터 + 공책', other: '기타 배치' } as const
export type Task = { id: string; title: string; instruction: string; posture: Label; presence: Presence; activity: string; head: string }
export const TASKS: readonly Task[] = [
  { id: 'neutral', title: '01 · 편안한 기준 자세', instruction: '기준 등록 때의 편안한 자세로 앉으세요. 숨을 쉬고 작은 움직임을 해도 됩니다.', posture: 'upright', presence: 'seated', activity: 'reference', head: 'front' },
  { id: 'lean_left', title: '02 · 몸통 왼쪽 기울임', instruction: '본인 기준 왼쪽으로 몸통을 편안하게 기울여 유지하세요. 고개만 돌리는 동작과 구분합니다.', posture: 'lean_left', presence: 'seated', activity: 'posed', head: 'unspecified' },
  { id: 'lean_right', title: '03 · 몸통 오른쪽 기울임', instruction: '본인 기준 오른쪽으로 몸통을 편안하게 기울여 유지하세요. 화면의 좌우와 반대일 수 있습니다.', posture: 'lean_right', presence: 'seated', activity: 'posed', head: 'unspecified' },
  { id: 'trunk_forward', title: '04 · 몸통 앞으로 숙임', instruction: '머리만 내밀지 말고 몸통을 앞으로 숙여 유지하세요. 무리한 자세는 취하지 마세요.', posture: 'trunk_forward', presence: 'seated', activity: 'posed', head: 'unspecified' },
  { id: 'head_forward', title: '05 · 머리만 앞으로 · 탐색용', instruction: '몸통 위치를 가능한 한 유지하고 머리를 앞으로 내미세요. 정면에서 구분 가능한지 살펴보는 탐색 과제입니다.', posture: 'head_forward', presence: 'seated', activity: 'posed', head: 'unspecified' },
  { id: 'monitor_left', title: '06 · 왼쪽 모니터 보기', instruction: '몸통은 편안하게 두고 왼쪽 모니터를 보세요. 모니터가 없다면 실제 사용 위치의 대상을 보세요.', posture: 'unlabeled', presence: 'seated', activity: 'monitor_left', head: 'left' },
  { id: 'monitor_right', title: '07 · 오른쪽 모니터 보기', instruction: '몸통은 편안하게 두고 오른쪽 모니터를 보세요. 작업 방향이 자세 정답으로 자동 지정되지는 않습니다.', posture: 'unlabeled', presence: 'seated', activity: 'monitor_right', head: 'right' },
  { id: 'notebook_read', title: '08 · 공책 읽기', instruction: '책상에 둔 공책을 자연스럽게 읽으세요. 고개를 숙였다는 이유로 정상 또는 이탈 라벨을 자동 지정하지 않습니다.', posture: 'unlabeled', presence: 'seated', activity: 'notebook_read', head: 'down' },
  { id: 'notebook_write', title: '09 · 공책 필기', instruction: '공책에 자연스럽게 필기하세요. 촬영 후 몸통 자세를 한 가지로 확인할 수 없으면 미지정으로 남기세요.', posture: 'unlabeled', presence: 'seated', activity: 'notebook_write', head: 'down' },
  { id: 'typing', title: '10 · 자연스럽게 타이핑', instruction: '평소처럼 타이핑하며 작은 움직임도 포함하세요. 고정된 기준 자세 촬영과 비교할 자료입니다.', posture: 'unlabeled', presence: 'seated', activity: 'typing', head: 'unspecified' },
  { id: 'look_around', title: '11 · 고개 돌리고 돌아오기', instruction: '몸통은 편안하게 두고 고개를 잠깐 좌우로 돌렸다 돌아오세요. 반복 횟수와 속도는 자연스럽게 유지하세요.', posture: 'unlabeled', presence: 'seated', activity: 'look_around', head: 'changing' },
  { id: 'leave_return', title: '12 · 일어서서 나갔다 돌아오기', instruction: '카운트다운 후 자리에서 일어나 화면 밖으로 나갔다 돌아오세요. 구간 전체를 자리 비움으로 라벨링하지 않습니다.', posture: 'transition', presence: 'transition', activity: 'leave_return', head: 'unspecified' },
  { id: 'away', title: '13 · 빈 자리 유지', instruction: '준비 완료를 누르고 5초 카운트다운 동안 화면 밖으로 나가세요. 촬영이 끝날 때까지 돌아오지 마세요.', posture: 'unlabeled', presence: 'away', activity: 'empty_seat', head: 'not_applicable' },
  { id: 'occlusion', title: '14 · 앉은 채 얼굴 가리기', instruction: '자리에 앉은 채 얼굴을 손이나 책으로 가리세요. 자리 비움과 추적 실패를 구분하기 위한 과제입니다.', posture: 'unlabeled', presence: 'seated', activity: 'occlusion', head: 'unspecified' },
]
export type CaptureOptions = { taskId: string; durationSeconds: number; repetition: number;
  cameraView: keyof typeof VIEWS; cameraHeight: 'eye' | 'above' | 'below'; distanceCm: number;
  layout: keyof typeof LAYOUTS }
export const DEFAULT_CAPTURE_OPTIONS: CaptureOptions = { taskId: 'neutral', durationSeconds: 20, repetition: 1,
  cameraView: 'front', cameraHeight: 'eye', distanceCm: 60, layout: 'single' }
export const PREPARE_MS = 5000
export const taskFor = (id: string) => TASKS.find(task => task.id === id)
export function validateOptions(options: CaptureOptions) {
  if (!taskFor(options.taskId) || ![10, 20, 30, 60].includes(options.durationSeconds)
    || !Number.isInteger(options.repetition) || options.repetition < 1 || options.repetition > 999
    || !Number.isFinite(options.distanceCm) || options.distanceCm < 20 || options.distanceCm > 300
    || !Object.hasOwn(VIEWS, options.cameraView) || !Object.hasOwn(LAYOUTS, options.layout)
    || !['eye', 'above', 'below'].includes(options.cameraHeight)) throw new Error('촬영 조건과 거리(20~300cm)를 확인하세요.')
}
export function captureWindow(startMs: number, seconds: number, now: number) {
  return now < startMs ? 'countdown' : now < startMs + seconds * 1000 ? 'recording' : 'review'
}
