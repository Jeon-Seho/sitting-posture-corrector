import type { ComparisonFrame } from '../../../../model/prototype/observationComparison'

export const COMPARISON_ACTIONS = [
  { id: 'neutral', title: '기준 자세', instruction: '편안하게 정면을 보고 얼굴과 양쪽 어깨가 보이게 앉아 주세요.', holdInstruction: '편안한 기준 자세를 유지하세요.' },
  { id: 'head', title: '머리 앞으로 내밀기', instruction: '몸통은 가능한 그대로 두고 머리만 살짝 앞으로 내밀어 보세요.', holdInstruction: '머리만 앞으로 내민 상태를 유지하세요. 몸통은 가능한 그대로 두세요.' },
  { id: 'bow', title: '고개 숙이기', instruction: '몸통은 가능한 그대로 두고 고개를 아래로 숙여 보세요.', holdInstruction: '고개를 숙인 상태를 유지하세요. 몸통은 가능한 그대로 두세요.' },
  { id: 'body', title: '몸통 전체 접근', instruction: '머리와 어깨의 관계를 유지하며 상체 전체를 카메라 쪽으로 움직여 보세요.', holdInstruction: '머리와 어깨가 함께 다가간 상태를 유지하세요. 머리만 더 내밀지 마세요.' },
  { id: 'shoulders', title: '양쪽 어깨 함께 올리기', instruction: '양쪽 어깨를 동시에 귀 쪽으로 올려 보세요. 머리와 몸통은 가능한 그대로 두세요.', holdInstruction: '양쪽 어깨를 함께 올린 채 유지하세요. 한쪽씩 번갈아 올리는 동작이 아닙니다.' },
] as const
export type ComparisonAction = typeof COMPARISON_ACTIONS[number]['id']

/** Illustrative independent coordinate changes, NOT a simulation validated on people. */
export function comparisonDemo(timeMs: number, action: ComparisonAction): ComparisonFrame {
  const landmarks = Array.from({ length: 13 }, (_, i) => ({ x: .5 + (i === 11 ? -.2 : i === 12 ? .2 : i % 2 ? -.04 : .04), y: i >= 11 ? .7 : i >= 9 ? .39 : .3, z: 0, visibility: .99 }))
  landmarks[0] = { ...landmarks[0], x: .5, y: .35 }
  const worldLandmarks = landmarks.map(p => ({ ...p, x: p.x - .5, y: p.y * .75, z: -.05 }))
  if (action === 'head') { for (let i = 0; i < 11; i++) { landmarks[i].y -= .01; worldLandmarks[i].z -= .08 } }
  if (action === 'bow') { for (let i = 0; i < 11; i++) landmarks[i].y += i >= 9 ? -.015 : .045; worldLandmarks[0].z -= .025 }
  if (action === 'body') { for (const p of landmarks) { p.x = .5 + (p.x - .5) * 1.2; p.y = .5 + (p.y - .5) * 1.2 } for (const p of worldLandmarks) p.z -= .1 }
  if (action === 'shoulders') { for (const i of [11, 12]) { landmarks[i].y -= .06; worldLandmarks[i].y -= .045 } }
  return { timeMs, width: 640, height: 480, poseModelId: 'explicit-synthetic-illustration', landmarks, worldLandmarks }
}
