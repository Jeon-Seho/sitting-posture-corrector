import { BONES, type Keypoints, type PostureState } from '../data/posture'

const STATE_COLOR: Record<PostureState, string> = {
  good: '#6fc2af',
  collapse: '#ee6a86',
  unknown: '#a39d90',
}

type Props = {
  keypoints: Keypoints
  state: PostureState
  confidence: number
  /** 키포인트 오버레이 표시 여부 */
  showSkeleton?: boolean
}

/**
 * 가짜 웹캠 화면. 실제 영상 대신 관절 좌표에서 사람 실루엣을 그리고
 * 그 위에 MediaPipe 스타일 키포인트 오버레이를 얹는다.
 */
export function PoseStage({ keypoints: k, state, confidence, showSkeleton = true }: Props) {
  const color = STATE_COLOR[state]
  const faded = confidence < 0.5

  const earDx = k.rightEar[0] - k.leftEar[0]
  const earDy = k.rightEar[1] - k.leftEar[1]
  const headR = Math.max(4, Math.hypot(earDx, earDy) / 2 + 1.4)
  const headAngle = (Math.atan2(earDy, earDx) * 180) / Math.PI
  const headCx = (k.leftEar[0] + k.rightEar[0]) / 2
  const headCy = (k.leftEar[1] + k.rightEar[1]) / 2 - 1.5

  const torso = `M ${k.leftShoulder[0]} ${k.leftShoulder[1]}
    L ${k.rightShoulder[0]} ${k.rightShoulder[1]}
    L ${k.rightHip[0]} ${k.rightHip[1]}
    L ${k.leftHip[0]} ${k.leftHip[1]} Z`

  // 관절 좌표는 100x100 공간이지만 화면은 4:3이라 좌우에 여백을 두고 전신을 담는다
  return (
    <svg viewBox="-17 0 134 100" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="자세 추정 미리보기">
      <defs>
        <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#221f1b" />
          <stop offset="55%" stopColor="#171512" />
          <stop offset="100%" stopColor="#0e0d0b" />
        </linearGradient>
        <radialGradient id="vignette" cx="50%" cy="45%" r="72%">
          <stop offset="55%" stopColor="rgba(0,0,0,0)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0.62)" />
        </radialGradient>
        <linearGradient id="body" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#58524a" />
          <stop offset="100%" stopColor="#36322d" />
        </linearGradient>
      </defs>

      <rect x="-17" y="0" width="134" height="100" fill="url(#room)" />
      {/* 뒤쪽 벽과 책상 라인 */}
      <line x1="-17" y1="62" x2="117" y2="62" stroke="#2e2a25" strokeWidth="0.6" />
      <rect x="-17" y="88" width="134" height="12" fill="#1a1815" />
      {/* 의자 등받이 */}
      <rect x="28" y="52" width="44" height="42" rx="8" fill="#1f1c19" />

      <g opacity={faded ? 0.45 : 1}>
        {/* 목 */}
        <line
          x1={k.neck[0]}
          y1={k.neck[1]}
          x2={headCx}
          y2={headCy + headR * 0.9}
          stroke="url(#body)"
          strokeWidth="6.5"
          strokeLinecap="round"
        />
        <path d={torso} fill="url(#body)" stroke="url(#body)" strokeWidth="6"
          strokeLinejoin="round" />
        {(['left', 'right'] as const).map((side) => {
          const s = side === 'left' ? k.leftShoulder : k.rightShoulder
          const e = side === 'left' ? k.leftElbow : k.rightElbow
          const w = side === 'left' ? k.leftWrist : k.rightWrist
          return (
            <polyline
              key={side}
              points={`${s[0]},${s[1]} ${e[0]},${e[1]} ${w[0]},${w[1]}`}
              fill="none"
              stroke="url(#body)"
              strokeWidth="6.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )
        })}
        <ellipse
          cx={headCx}
          cy={headCy}
          rx={headR}
          ry={headR * 1.22}
          fill="url(#body)"
          transform={`rotate(${headAngle} ${headCx} ${headCy})`}
        />
      </g>

      {showSkeleton && (
        <g opacity={faded ? 0.5 : 0.95}>
          {BONES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={k[a][0]}
              y1={k[a][1]}
              x2={k[b][0]}
              y2={k[b][1]}
              stroke={color}
              strokeWidth="0.9"
              strokeLinecap="round"
              strokeDasharray={faded ? '2 1.6' : undefined}
            />
          ))}
          {Object.values(k).map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="1.25" fill={color} stroke="#0e0d0b"
              strokeWidth="0.35" />
          ))}
        </g>
      )}

      <rect x="-17" y="0" width="134" height="100" fill="url(#vignette)" />
    </svg>
  )
}
