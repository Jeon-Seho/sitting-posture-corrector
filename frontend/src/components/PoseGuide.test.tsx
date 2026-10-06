import { describe, expect, it } from 'vitest'
import { act, create } from 'react-test-renderer'
import type { Landmark } from '../../../model/prototype/pose'
import type { CameraController } from '../hooks/useCamera'
import type { Observation } from '../features/camera/types'
import { PoseGuide } from './PoseGuide'

// Explicitly synthetic camera: only subscribe() is used by the guide.
function syntheticCamera() {
  const listeners = new Set<(o: Observation) => void>()
  const camera = {
    subscribe(listener: (o: Observation) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  } as unknown as CameraController
  const emit = (landmarks: Landmark[], timeMs: number) =>
    listeners.forEach((listener) =>
      listener({
        timeMs,
        videoTimeMs: timeMs,
        features: null,
        landmarks,
        worldLandmarks: [],
        inferenceMs: 0,
        delegate: 'CPU',
        width: 640,
        height: 480,
      }),
    )
  return { camera, emit, listeners }
}

function person(span: number): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }))
  points[0] = { x: 0.5, y: 0.35, z: 0, visibility: 0.99 }
  points[11] = { x: 0.5 + span / 2, y: 0.6, z: 0, visibility: 0.99 }
  points[12] = { x: 0.5 - span / 2, y: 0.6, z: 0, visibility: 0.99 }
  return points
}

describe('PoseGuide', () => {
  it('starts at the default outline, then fits the detected person in video pixels', () => {
    const { camera, emit, listeners } = syntheticCamera()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(<PoseGuide camera={camera} />)
    })
    const svg = () => renderer.root.findByType('svg')
    expect(svg().props.className).toBe('stage-guide')
    expect(svg().props.viewBox).toBe('0 0 800 600')

    act(() => emit(person(0.25), 1000))
    expect(svg().props.className).toBe('stage-guide fitted')
    expect(svg().props.viewBox).toBe('0 0 640 480')
    const far = renderer.root.findByType('ellipse').props.rx

    act(() => emit(person(0.6), 3000))
    // Sitting nearer (wider shoulders) grows the outline toward the new size.
    expect(renderer.root.findByType('ellipse').props.rx).toBeGreaterThan(far)

    act(() => emit([], 5000))
    expect(svg().props.className).toBe('stage-guide')

    act(() => renderer.unmount())
    expect(listeners.size).toBe(0)
  })
})
