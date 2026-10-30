import { expect, it } from 'vitest'
import { armLandmarks, shoulderUpLandmarks } from './landmarks'

it('selects original indices 0–12 independently of SDK buffers and keeps raw invalid values', () => {
  const points = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, z: -i, visibility: 0.1 }))
  points[3].x = Number.NaN
  const world = points.map(point => ({ ...point, z: point.z * 2 }))
  const frame = shoulderUpLandmarks({ landmarks: [points], worldLandmarks: [world] })
  expect(frame.landmarks).toEqual(points.slice(0, 13))
  expect(frame.worldLandmarks).toEqual(world.slice(0, 13))
  points[0].x = 0.9
  world[12].z = 100
  expect(frame.landmarks[0].x).toBe(0)
  expect(frame.worldLandmarks[12].z).toBe(-24)
  expect(frame.landmarks[3].x).toBeNaN()
})

it('preserves missing outputs without padding points or fabricating world coordinates', () => {
  expect(shoulderUpLandmarks({ landmarks: [], worldLandmarks: [] })).toEqual({ landmarks: [], worldLandmarks: [] })
  const point = { x: 0.5, y: 0.5, z: 0 }
  expect(shoulderUpLandmarks({ landmarks: [[point]], worldLandmarks: [] }).landmarks).toEqual([point])
})

it('keeps arm indices 13–22 apart from the shoulder-up observation for /dev replay', () => {
  const points = Array.from({ length: 33 }, (_, i) => ({ x: i / 33, y: 0.5, z: -i, visibility: 0.1 }))
  const world = points.map(point => ({ ...point, z: point.z * 2 }))
  const result = { landmarks: [points], worldLandmarks: [world] }
  expect(shoulderUpLandmarks(result).landmarks).toHaveLength(13)
  const arms = armLandmarks(result)
  expect(arms.armLandmarks).toEqual(points.slice(13, 23))
  expect(arms.armWorldLandmarks).toEqual(world.slice(13, 23))
  points[15].x = 0.9
  expect(arms.armLandmarks[2].x).toBe(15 / 33)
  expect(armLandmarks({ landmarks: [], worldLandmarks: [] })).toEqual({ armLandmarks: [], armWorldLandmarks: [], extraLandmarks: [], extraWorldLandmarks: [] })
})
