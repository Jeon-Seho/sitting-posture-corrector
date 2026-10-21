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

  function Probe() {
    screen = useLiveSession({
      session: { id: SESSION, startedAt: '2026-10-21T00:00:00Z', rules: DEFAULT_RULES, baselineId: 'b' },
      camera,
      service: { active: true, onEnded },
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
    setServerAuth({ userId: '7', csrfToken: async () => 'csrf' })
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
})
