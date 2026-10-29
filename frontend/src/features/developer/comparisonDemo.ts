import type { ComparisonFrame } from '../../../../model/prototype/observationComparison'
import type { Landmark } from '../../../../model/prototype/pose'

/** Three guided classes for the binary-score softmax: base, alert-worthy deviation, seated stretch. */
export const COMPARISON_ACTIONS = [
  { id: 'neutral', title: '기준 자세', instruction: '편안하게 정면을 보고 얼굴과 양쪽 어깨가 보이게 앉아 주세요.', holdInstruction: '편안한 기준 자세를 유지하세요.' },
  { id: 'deviation', title: '이탈 자세', instruction: '알림을 받아야 한다고 생각하는 자세를 자유롭게 잡아 보세요. 매번 종류와 크기를 바꿔 주세요.', holdInstruction: '잡은 이탈 자세를 그대로 유지하세요.' },
  { id: 'stretch', title: '앉은 채 스트레칭', instruction: '앉은 채로 기지개·팔 뻗기·목 돌리기 같은 스트레칭을 해 보세요. 일어서지 마세요.', holdInstruction: '앉은 채 스트레칭을 이어가세요. 일어서지 마세요.' },
] as const
export type ComparisonAction = typeof COMPARISON_ACTIONS[number]['id']

/** Tasks of protocol v3 and earlier. Kept only so older replay files still load and show a title. */
export const LEGACY_COMPARISON_ACTIONS = [
  { id: 'head', title: '머리 앞으로 내밀기' },
  { id: 'bow', title: '고개 숙이기' },
  { id: 'body', title: '몸통 전체 접근' },
  { id: 'shoulders', title: '양쪽 어깨 함께 올리기' },
] as const
export type ReplayTask = ComparisonAction | typeof LEGACY_COMPARISON_ACTIONS[number]['id']
export const REPLAY_TASKS: readonly { id: ReplayTask; title: string }[] = [...COMPARISON_ACTIONS, ...LEGACY_COMPARISON_ACTIONS]
export const taskTitle = (id: string | undefined) => REPLAY_TASKS.find(task => task.id === id)?.title

export type DemoFrame = ComparisonFrame & { armLandmarks: Landmark[]; armWorldLandmarks: Landmark[] }

/** Illustrative independent coordinate changes, NOT a simulation validated on people. */
export function comparisonDemo(timeMs: number, action: ComparisonAction): DemoFrame {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: .5 + (i === 11 ? -.2 : i === 12 ? .2 : i % 2 ? -.04 : .04), y: i >= 11 ? .7 : i >= 9 ? .39 : .3, z: 0, visibility: .99 }))
  landmarks[0] = { ...landmarks[0], x: .5, y: .35 }
  const worldLandmarks = landmarks.map(p => ({ ...p, x: p.x - .5, y: p.y * .75, z: -.05 }))
  // Arms rest below a shoulder-up frame: estimated but barely visible, as the SDK reports them.
  const armLandmarks = Array.from({ length: 10 }, (_, i) => ({ x: .5 + (i % 2 ? .25 : -.25), y: 1.1 + i * .01, z: 0, visibility: .05 }))
  if (action === 'deviation') { for (let i = 0; i < 11; i++) landmarks[i].y += i >= 9 ? -.015 : .045; worldLandmarks[0].z -= .025 }
  if (action === 'stretch') {
    for (const i of [11, 12]) landmarks[i].y -= .03
    armLandmarks.forEach((p, i) => { p.y = i < 2 ? .45 : .12; p.x = .5 + (i % 2 ? .12 : -.12); p.visibility = .9 })
  }
  const armWorldLandmarks = armLandmarks.map(p => ({ ...p, x: p.x - .5, y: p.y * .75, z: -.05 }))
  return { timeMs, width: 640, height: 480, poseModelId: 'explicit-synthetic-illustration', landmarks, worldLandmarks, armLandmarks, armWorldLandmarks }
}
