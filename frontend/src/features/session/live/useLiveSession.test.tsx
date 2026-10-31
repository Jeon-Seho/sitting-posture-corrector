import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import type { CameraController } from '../../../hooks/useCamera'
import { DEFAULT_RULES } from '../../../data/posture'
import { setServerAuth } from '../../platform/serverAuth'
import { endRunningMeasurement, WINDOW_END_REASON } from '../sessionControl'
import type { LiveState, SocketLike } from './LiveSession'
import { EMPTY_SUMMARY } from './messages'
import { useLiveSession, type LiveSessionScreen } from './useLiveSession'

vi.mock('../../desktop/alertPopup', () => ({ popupAlert: vi.fn() }))

/** Synthetic camera and server only. */
const SESSION = '3f2a9c1e-5b7d-4e8a-9c21-7d4e5f6a8b90'
const reply = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response

describe('measurement screen rules around the camera (synthetic only)', () => {
  let renderer: ReactTestRenderer | undefined
  let screen: LiveSessionScreen
  let camera: CameraController
  let socket: SocketLike & { sent: Record<string, unknown>[] }
  let onEnded: ReturnType<typeof vi.fn<(state: LiveState, note: string) => void>>
  let onRolledOver: ReturnType<typeof vi.fn<(previous: LiveState) => void>>

  function Probe() {
    screen = useLiveSession({
      session: { id: SESSION, startedAt: '2026-10-21T00:00:00Z', rules: DEFAULT_RULES, baselineId: 'b' },
      camera,
      service: { active: true, onEnded, onRolledOver },
      openSocket: () => {
        socket = {
          readyState: 1,
          sent: [],
          send(data: string) {
            socket.sent.push(JSON.parse(data))
          },
          close() {},
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
        }
        return socket
      },
    })
    return null
  }
  const mount = async () => {
    await act(async () => {
      renderer = create(<Probe />)
    })
    await act(async () => {
      socket.onopen?.({})
      socket.onmessage?.({ data: JSON.stringify({ type: 'ready', purpose: 'measure', session_id: SESSION }) })
    })
  }
  const advance = (ms: number) =>
    act(() => {
      vi.advanceTimersByTime(ms)
    })

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(0)
    vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
    onEnded = vi.fn<(state: LiveState, note: string) => void>()
    onRolledOver = vi.fn<(previous: LiveState) => void>()
    camera = {
      state: 'on',
      quality: true,
      lastFrame: { current: 0 },
      videoRef: { current: { videoWidth: 640, videoHeight: 480 } },
      subscribe: () => () => {},
      stop: vi.fn(),
    } as unknown as CameraController
    vi.stubGlobal('location', { protocol: 'http:', host: 'localhost' })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        reply(200, {
          session_id: SESSION,
          ended: false,
          last_sequence: -1,
          summary: EMPTY_SUMMARY,
          events: [],
        }),
      ),
    )
    setServerAuth({ userId: '7', accessToken: async () => 'access' })
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    renderer = undefined
    setServerAuth(null)
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const keepFrames = () => {
    camera.lastFrame.current = performance.now()
  }

  it('pauses as away when frames stop for over 1 s and resumes only with the camera back', async () => {
    await mount()
    keepFrames()
    advance(500)
    expect(screen.phase).toBe('running')
    advance(1500)
    expect(screen.phase).toBe('paused')
    expect(screen.state?.sending).toBe('away')
    expect(screen.canResume).toBe(false)
    keepFrames()
    act(() => screen.resume())
    expect(screen.phase).toBe('running')
  })

  it('ends and saves when the camera in use is unplugged (2026-10-16, 10/21)', async () => {
    await mount()
    keepFrames()
    camera.state = 'error'
    advance(250)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'end' })
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({ type: 'closed', reason: 'ended' }) })
    })
    expect(onEnded).toHaveBeenCalledOnce()
    expect(onEnded.mock.calls[0][1]).toBe('쓰던 카메라가 빠져 측정을 마쳤어요. 그때까지의 기록은 저장했어요.')
    expect(camera.stop).toHaveBeenCalled()
  })

  it('ends when the frame size changes, and from the small window X', async () => {
    await mount()
    keepFrames()
    ;(camera.videoRef as { current: { videoWidth: number; videoHeight: number } }).current = {
      videoWidth: 1280,
      videoHeight: 720,
    }
    advance(250)
    expect(socket.sent.at(-1)).toMatchObject({ type: 'end' })

    act(() => renderer?.unmount())
    ;(camera.videoRef as { current: { videoWidth: number; videoHeight: number } }).current = {
      videoWidth: 640,
      videoHeight: 480,
    }
    await mount()
    keepFrames()
    act(() => {
      expect(endRunningMeasurement(WINDOW_END_REASON)).toBe(true)
    })
    expect(socket.sent.at(-1)).toMatchObject({ type: 'end' })
    expect(screen.note).toBe(WINDOW_END_REASON)
  })

  it('goes on over KST midnight: hands the stored day over and says so, the camera stays on', async () => {
    await mount()
    const summary = { total_ms: 0, valid_ms: 0, normal_ms: 0, deviation_ms: 0, rest_ms: 0, away_ms: 0, unknown_ms: 0,
      missing_ms: 0, collapse_count: 0, alert_count: 0, interval_count: 0, keep_rate: null, events_per_hour: null,
      mean_interval_ms: null, mean_recovery_ms: null }
    expect(screen.rolledOver).toBe(false)
    await act(async () => {
      socket.onmessage?.({ data: JSON.stringify({
        type: 'session_rollover', ended: { session_id: SESSION, ended_at: '2026-10-26T14:59:59.000Z', summary },
        session_id: '5d0b8f3a-1c2e-4a6b-9d7f-0e1a2b3c4d5e', started_at: '2026-10-26T15:00:00Z', at_ms: 0,
      }) })
    })
    expect(onRolledOver).toHaveBeenCalledOnce()
    expect(onRolledOver.mock.calls[0][0].sessionId).toBe(SESSION)
    expect(screen.rolledOver).toBe(true)
    expect(screen.phase).toBe('running')
    expect(onEnded).not.toHaveBeenCalled()
    expect(camera.stop).not.toHaveBeenCalled()
  })
})
