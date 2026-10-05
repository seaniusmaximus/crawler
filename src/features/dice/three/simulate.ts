import { Body, ContactMaterial, ConvexPolyhedron, Material, Plane, Vec3, World } from 'cannon-es'
import { Quaternion, Vector3 } from 'three'
import { shapeOf, type DieKind } from './shapes.ts'

/**
 * A throw, simulated to the end before it's shown. Knowing which face lands on
 * top lets the renderer number the faces so the top one is the real result: the
 * motion is real physics, the number is the table's roll. Die units throughout
 * (a die is about 2 across); y is up, and +z is toward the viewer.
 */

export const STEP = 1 / 60
const MAX_SECONDS = 3
/** Invisible walls this far out keep a throw near whoever threw it. */
const WALL = 5.5

export interface Recording {
  frames: number
  /** Per die, per frame: x, y, z. */
  positions: Float32Array[]
  /** Per die, per frame: x, y, z, w. */
  rotations: Float32Array[]
  /** Per die: the face on top at rest (for a d4, the corner on top). */
  up: number[]
}

const polyhedra = new Map<DieKind, ConvexPolyhedron>()

function polyhedron(kind: DieKind): ConvexPolyhedron {
  let shape = polyhedra.get(kind)
  if (!shape) {
    const die = shapeOf(kind)
    shape = new ConvexPolyhedron({
      vertices: die.vertices.map((v) => new Vec3(v.x, v.y, v.z)),
      faces: die.faces,
    })
    polyhedra.set(kind, shape)
  }
  return shape
}

/** Which face (or d4 corner) points most nearly straight up after rotation `q`. */
export function upOf(kind: DieKind, q: Quaternion): number {
  const die = shapeOf(kind)
  const up = new Vector3(0, 1, 0)
  let best = 0
  let bestDot = -Infinity
  const candidates = kind === 'd4' ? die.vertices.map((v) => v.clone().normalize()) : die.normals
  candidates.forEach((direction, i) => {
    const d = direction.clone().applyQuaternion(q).dot(up)
    if (d > bestDot) {
      bestDot = d
      best = i
    }
  })
  return best
}

/** Throw these dice toward `aim` (radians on the table: π/2 is toward the viewer). */
export function simulateThrow(kinds: DieKind[], aim: number, random: () => number = Math.random): Recording {
  const world = new World({ gravity: new Vec3(0, -60, 0), allowSleep: true })
  const table = new Material('table')
  const dieMaterial = new Material('die')
  world.addContactMaterial(new ContactMaterial(table, dieMaterial, { friction: 0.32, restitution: 0.32 }))
  world.addContactMaterial(new ContactMaterial(dieMaterial, dieMaterial, { friction: 0.15, restitution: 0.45 }))

  const floor = new Body({ mass: 0, material: table, shape: new Plane() })
  floor.quaternion.setFromEuler(-Math.PI / 2, 0, 0)
  world.addBody(floor)
  // Walls facing inward on four sides.
  for (const [x, z, turn] of [
    [WALL, 0, -Math.PI / 2],
    [-WALL, 0, Math.PI / 2],
    [0, WALL, Math.PI],
    [0, -WALL, 0],
  ] as const) {
    const wall = new Body({ mass: 0, material: table, shape: new Plane() })
    wall.position.set(x, 0, z)
    wall.quaternion.setFromEuler(0, turn, 0)
    world.addBody(wall)
  }

  const heading = aim + (random() - 0.5) * 1.2
  const bodies = kinds.map((kind, i) => {
    const body = new Body({
      mass: 1,
      material: dieMaterial,
      shape: polyhedron(kind),
      linearDamping: 0.2,
      angularDamping: 0.22,
      allowSleep: true,
      sleepSpeedLimit: 0.35,
      sleepTimeLimit: 0.15,
    })
    // Out of one hand: spread a little across the throw, starting just behind the token.
    const across = (i - (kinds.length - 1) / 2) * 1.6
    body.position.set(
      -Math.cos(heading) * 1.5 + -Math.sin(heading) * across,
      2.6 + random() * 1.4,
      -Math.sin(heading) * 1.5 + Math.cos(heading) * across,
    )
    body.quaternion.setFromEuler(random() * 6.28, random() * 6.28, random() * 6.28)
    const speed = 8 + random() * 4
    body.velocity.set(Math.cos(heading) * speed, 1 + random() * 3, Math.sin(heading) * speed)
    body.angularVelocity.set((random() - 0.5) * 30, (random() - 0.5) * 30, (random() - 0.5) * 30)
    world.addBody(body)
    return body
  })

  const maxFrames = Math.ceil(MAX_SECONDS / STEP)
  const positions = kinds.map(() => new Float32Array(maxFrames * 3))
  const rotations = kinds.map(() => new Float32Array(maxFrames * 4))
  let frames = 0
  while (frames < maxFrames) {
    world.step(STEP)
    bodies.forEach((body, i) => {
      positions[i].set([body.position.x, body.position.y, body.position.z], frames * 3)
      rotations[i].set([body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w], frames * 4)
    })
    frames += 1
    if (frames > 20 && bodies.every((body) => body.sleepState === Body.SLEEPING)) break
  }

  return finish(kinds, frames, positions, rotations)
}

/** Frames spent tipping a die that came to rest leaning (on a wall or another die) flat. */
const SETTLE_FRAMES = 12

/**
 * End every die exactly flat with its top face (or d4 corner) straight up, since
 * that face carries the result: a die left leaning tips onto it over a few
 * frames, and sits at its true resting height.
 */
function finish(kinds: DieKind[], frames: number, positions: Float32Array[], rotations: Float32Array[]): Recording {
  const total = frames + SETTLE_FRAMES
  const up = new Vector3(0, 1, 0)
  const outPositions: Float32Array[] = []
  const outRotations: Float32Array[] = []
  const result = kinds.map((kind, i) => {
    const die = shapeOf(kind)
    const last = frames - 1
    const r = rotations[i]
    const p = positions[i]
    const q = new Quaternion(r[last * 4], r[last * 4 + 1], r[last * 4 + 2], r[last * 4 + 3])
    const top = upOf(kind, q)
    // The face that should lie on the table: opposite the top one (for a d4, the face without its top corner).
    const downFace = kind === 'd4' ? die.faces.findIndex((face) => !face.includes(top)) : -1
    const facing = kind === 'd4' ? die.normals[downFace].clone().applyQuaternion(q) : die.normals[top].clone().applyQuaternion(q)
    const target = kind === 'd4' ? new Vector3(0, -1, 0) : up
    const flat = new Quaternion().setFromUnitVectors(facing.normalize(), target).multiply(q)
    // Resting height: the lowest corner touches the table.
    const lowest = Math.min(...die.vertices.map((v) => v.clone().applyQuaternion(flat).y))

    const positionsOut = new Float32Array(total * 3)
    const rotationsOut = new Float32Array(total * 4)
    positionsOut.set(p.subarray(0, frames * 3))
    rotationsOut.set(r.subarray(0, frames * 4))
    const startY = p[last * 3 + 1]
    for (let k = 1; k <= SETTLE_FRAMES; k++) {
      const t = k / SETTLE_FRAMES
      const eased = 1 - (1 - t) ** 3
      const step = q.clone().slerp(flat, eased)
      const f = frames - 1 + k
      positionsOut.set([p[last * 3], startY + (-lowest - startY) * eased, p[last * 3 + 2]], f * 3)
      rotationsOut.set([step.x, step.y, step.z, step.w], f * 4)
    }
    outPositions.push(positionsOut)
    outRotations.push(rotationsOut)
    return top
  })
  return { frames: total, positions: outPositions, rotations: outRotations, up: result }
}
