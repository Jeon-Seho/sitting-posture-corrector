import { afterEach, describe, expect, it, vi } from 'vitest'
import { startFaceClient, type FaceWorkerPort } from './client'
import { syntheticFace, syntheticObservation } from './syntheticFixture.test-helper'

afterEach(() => vi.useRealTimers())
function setup(bitmap?: () => Promise<ImageBitmap>) {
  vi.useFakeTimers()
  let now = 1000
  const worker: FaceWorkerPort = { onmessage: null, onerror: null, postMessage: vi.fn(), terminate: vi.fn() }
  const send = (data: unknown) => worker.onmessage?.({ data } as MessageEvent)
  const video = { readyState: 2, currentTime: 1 } as HTMLVideoElement
  const closed = vi.fn()
  const onSample = vi.fn(), onStatus = vi.fn(), onExpired = vi.fn()
  const client = startFaceClient({ video, worker: () => worker, bitmap: bitmap ?? (() => Promise.resolve({ close: closed } as unknown as ImageBitmap)), now: () => now,
    origin: 'http://localhost', onSample, onStatus, onExpired })
  return { client, worker, send, video, closed, onSample, onStatus, onExpired, setNow: (value: number) => { now = value } }
}

describe('bounded face worker lifecycle with synthetic media', () => {
  it('uses local assets, one frame in flight and preserves the original observation', async () => {
    const s = setup(), observation = syntheticObservation(), original = structuredClone(observation)
    s.send({ type: 'ready', delegate: 'GPU' })
    s.client.offer(observation); s.client.offer(syntheticObservation(1100)); await Promise.resolve()
    expect(s.worker.postMessage).toHaveBeenCalledTimes(2)
    expect(s.worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'init', modelPath: 'http://localhost/mediapipe/face_landmarker.task' }))
    s.setNow(1020); s.send({ type: 'result', id: 1, frame: syntheticFace(), inferenceMs: 5, delegate: 'GPU' })
    expect(s.onSample).toHaveBeenCalledWith(expect.objectContaining({ roundTripMs: 20, difference: { meanPixels: expect.closeTo(0, 6), verticalPixels: expect.closeTo(0, 6) } }))
    expect(observation).toEqual(original); s.client.stop()
  })
  it('closes a late bitmap and ignores late results after cancellation', async () => {
    let resolve!: (value: ImageBitmap) => void
    const s = setup(() => new Promise(r => { resolve = r }))
    s.send({ type: 'ready', delegate: 'CPU' }); s.client.offer(syntheticObservation()); s.client.stop()
    resolve({ close: s.closed } as unknown as ImageBitmap); await Promise.resolve()
    s.send({ type: 'result', id: 1, frame: syntheticFace(), inferenceMs: 1, delegate: 'CPU' })
    expect(s.closed).toHaveBeenCalledOnce(); expect(s.onSample).not.toHaveBeenCalled(); expect(s.worker.postMessage).toHaveBeenCalledOnce()
  })
  it('rejects a changed video frame before copying, without fabricating paired data', () => {
    const s = setup(); s.send({ type: 'ready', delegate: 'GPU' }); s.video.currentTime = 1.2
    s.client.offer(syntheticObservation()); expect(s.worker.postMessage).toHaveBeenCalledOnce(); s.client.stop()
  })
  it('drops stale results and expires a once valid face instead of holding old points', async () => {
    const s = setup(); s.send({ type: 'ready', delegate: 'GPU' }); s.client.offer(syntheticObservation()); await Promise.resolve()
    s.setNow(1601); s.send({ type: 'result', id: 1, frame: syntheticFace(), inferenceMs: 5, delegate: 'GPU' })
    expect(s.onSample.mock.calls[0][0].frame).toBeNull()
    s.video.currentTime = 1.7; s.client.offer(syntheticObservation(1700)); await Promise.resolve()
    s.setNow(1710); s.send({ type: 'result', id: 2, frame: syntheticFace(1700), inferenceMs: 5, delegate: 'GPU' })
    s.setNow(2211); vi.advanceTimersByTime(100)
    expect(s.onExpired).toHaveBeenCalled(); s.client.stop()
  })
  it('refuses a background face that is far from the Pose subject', async () => {
    const s = setup(); s.send({ type: 'ready', delegate: 'GPU' }); s.client.offer(syntheticObservation()); await Promise.resolve()
    const face = syntheticFace(); face.points = face.points.map(p => ({ ...p, x: p.x + .4 }))
    s.send({ type: 'result', id: 1, frame: face, inferenceMs: 5, delegate: 'GPU' })
    expect(s.onSample.mock.calls[0][0].frame).toBeNull(); s.client.stop()
  })
  it('terminates a stalled initialization and a stalled result', async () => {
    const initial = setup(); initial.setNow(21001); vi.advanceTimersByTime(100)
    expect(initial.worker.terminate).toHaveBeenCalledOnce(); expect(initial.onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('준비 시간이'))
    const result = setup(); result.send({ type: 'ready', delegate: 'GPU' }); result.client.offer(syntheticObservation()); await Promise.resolve()
    result.setNow(4001); vi.advanceTimersByTime(100)
    expect(result.worker.terminate).toHaveBeenCalledOnce(); expect(result.onStatus).toHaveBeenLastCalledWith('error', expect.stringContaining('응답이'))
  })
})
