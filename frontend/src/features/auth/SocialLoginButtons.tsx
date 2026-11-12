/**
 * 화면 순서. 백엔드 SocialProviders.KNOWN·DB CHECK 목록과 같게 둔다.
 * 로고는 각 회사 공식 배포 파일(public/branding/social/README.md)이며 모양·색을 바꾸지 않는다.
 */
export const SOCIAL_PROVIDERS = [
  { id: 'discord', name: 'Discord' },
  { id: 'kakao', name: '카카오' },
  { id: 'google', name: 'Google' },
  { id: 'github', name: 'GitHub' },
] as const
export type SocialProviderId = typeof SOCIAL_PROVIDERS[number]['id']

const logo = (id: SocialProviderId) => `${import.meta.env.BASE_URL}branding/social/${id}.svg`

/**
 * 「또는 다른 계정으로 로그인」 둥근 아이콘 줄. 아직 안 되는 제공자도 보이게 두고 흐리게 표시한다.
 * 누르면 {@link onPick}이 불린다 — 준비 중 안내는 부모가 폼 아래 자리에 띄운다(로그인 칸이 밀리지 않게).
 */
export function SocialLoginButtons({ ready, disabled, onPick }: {
  ready: (id: SocialProviderId) => boolean
  disabled?: boolean
  onPick: (id: SocialProviderId, name: string) => void
}) {
  return (
    <div className="social-login" role="group" aria-label="다른 계정으로 로그인">
      <p className="social-divider"><span>또는 다른 계정으로 로그인</span></p>
      <ul className="social-icons">
        {SOCIAL_PROVIDERS.map(({ id, name }) => {
          const on = ready(id)
          return (
            <li key={id}>
              <button type="button" className={`social-icon social-${id}`} data-ready={on}
                aria-label={on ? `${name}로 로그인` : `${name} 로그인 (준비 중)`} title={on ? `${name}로 로그인` : `${name} · 준비 중`}
                disabled={disabled} onClick={() => onPick(id, name)}>
                <img src={logo(id)} alt="" draggable={false} />
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
