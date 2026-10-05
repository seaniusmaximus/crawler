import {
  BoxGeometry,
  BufferGeometry,
  DodecahedronGeometry,
  Float32BufferAttribute,
  IcosahedronGeometry,
  OctahedronGeometry,
  TetrahedronGeometry,
  Vector3,
} from 'three'

/**
 * The polyhedral dice, as faces: each face is a convex polygon of vertex indices,
 * wound counter-clockwise seen from outside. Built from three.js's solids (and a
 * constructed d10) by grouping their triangles into planes, so every die's faces
 * are worked out rather than typed in.
 */

export type DieKind = 'd4' | 'd6' | 'd8' | 'd10' | 'd12' | 'd20'

export interface DieShape {
  kind: DieKind
  vertices: Vector3[]
  faces: number[][]
  /** Outward unit normal of each face. */
  normals: Vector3[]
}

/** Every die's circumradius, in die units; the renderer scales units to pixels. */
const RADIUS: Record<DieKind, number> = { d4: 1.25, d6: 1, d8: 1.05, d10: 1, d12: 1, d20: 1.05 }

function trianglesOf(geometry: BufferGeometry): Vector3[][] {
  const source = geometry.index ? geometry.toNonIndexed() : geometry
  const position = source.getAttribute('position')
  const triangles: Vector3[][] = []
  for (let i = 0; i < position.count; i += 3) {
    triangles.push([0, 1, 2].map((k) => new Vector3().fromBufferAttribute(position, i + k)))
  }
  return triangles
}

/** A d10 (pentagonal trapezohedron): two apexes and a zig-zag ring, its kites made planar. */
function d10Triangles(): Vector3[][] {
  const apex = 1
  // The ring's zig-zag height that makes each kite flat (see the planarity of T, U, L, U').
  const c = Math.cos(Math.PI / 5)
  const zig = (apex * (1 - c)) / (1 + c)
  const ring = Array.from({ length: 10 }, (_, i) => {
    const a = (i * Math.PI) / 5
    return new Vector3(Math.cos(a), i % 2 === 0 ? zig : -zig, Math.sin(a))
  })
  const top = new Vector3(0, apex, 0)
  const bottom = new Vector3(0, -apex, 0)
  const at = (i: number) => ring[(i + 10) % 10]
  const triangles: Vector3[][] = []
  for (let k = 0; k < 5; k++) {
    const i = 2 * k
    triangles.push([top, at(i), at(i + 1)], [top, at(i + 1), at(i + 2)])
    triangles.push([bottom, at(i + 1), at(i + 2)], [bottom, at(i + 2), at(i + 3)])
  }
  return triangles
}

function rawTriangles(kind: DieKind): Vector3[][] {
  switch (kind) {
    case 'd4':
      return trianglesOf(new TetrahedronGeometry(1))
    case 'd6':
      return trianglesOf(new BoxGeometry(1, 1, 1))
    case 'd8':
      return trianglesOf(new OctahedronGeometry(1))
    case 'd10':
      return d10Triangles()
    case 'd12':
      return trianglesOf(new DodecahedronGeometry(1))
    case 'd20':
      return trianglesOf(new IcosahedronGeometry(1))
  }
}

/** Merge coplanar triangles into polygon faces with shared, de-duplicated vertices. */
function buildShape(kind: DieKind): DieShape {
  const triangles = rawTriangles(kind)
  // Scale so the circumradius is RADIUS[kind].
  let far = 0
  for (const triangle of triangles) for (const v of triangle) far = Math.max(far, v.length())
  const scale = RADIUS[kind] / far

  const vertices: Vector3[] = []
  const indexOf = (v: Vector3): number => {
    const scaled = v.clone().multiplyScalar(scale)
    const found = vertices.findIndex((existing) => existing.distanceTo(scaled) < 1e-4)
    if (found >= 0) return found
    vertices.push(scaled)
    return vertices.length - 1
  }

  const planes: { normal: Vector3; members: Set<number> }[] = []
  for (const triangle of triangles) {
    const [a, b, c] = triangle
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize()
    // Point outward whatever the source's winding.
    if (normal.dot(new Vector3().add(a).add(b).add(c)) < 0) normal.negate()
    let plane = planes.find((existing) => existing.normal.dot(normal) > 0.9999)
    if (!plane) {
      plane = { normal, members: new Set() }
      planes.push(plane)
    }
    for (const v of triangle) plane.members.add(indexOf(v))
  }

  const faces = planes.map(({ normal, members }) => {
    const ids = [...members]
    const center = ids.reduce((sum, id) => sum.add(vertices[id]), new Vector3()).divideScalar(ids.length)
    // Order around the centre, counter-clockwise seen from outside.
    const u = new Vector3().subVectors(vertices[ids[0]], center).normalize()
    const w = new Vector3().crossVectors(normal, u)
    return ids
      .map((id) => {
        const d = new Vector3().subVectors(vertices[id], center)
        return { id, angle: Math.atan2(d.dot(w), d.dot(u)) }
      })
      .sort((p, q) => p.angle - q.angle)
      .map((p) => p.id)
  })

  return { kind, vertices, faces, normals: planes.map((plane) => plane.normal) }
}

const cache = new Map<DieKind, DieShape>()

export function shapeOf(kind: DieKind): DieShape {
  let shape = cache.get(kind)
  if (!shape) {
    shape = buildShape(kind)
    cache.set(kind, shape)
  }
  return shape
}

/** Where a face's corners sit on its square texture, so labels can be drawn to match. */
export function faceLayout(shape: DieShape, face: number): { u: number; v: number }[] {
  const ids = shape.faces[face]
  const normal = shape.normals[face]
  const points = ids.map((id) => shape.vertices[id])
  const center = points.reduce((sum, p) => sum.clone().add(p), new Vector3()).divideScalar(points.length)
  // Face-local axes: "up" toward the first corner, so the number reads from the middle out.
  const up = new Vector3().subVectors(points[0], center).normalize()
  const right = new Vector3().crossVectors(up, normal)
  const local = points.map((p) => {
    const d = new Vector3().subVectors(p, center)
    return { x: d.dot(right), y: d.dot(up) }
  })
  const reach = Math.max(...local.map((p) => Math.max(Math.abs(p.x), Math.abs(p.y))))
  return local.map((p) => ({ u: 0.5 + (p.x / reach) * 0.46, v: 0.5 + (p.y / reach) * 0.46 }))
}

/**
 * Render geometry: one group per face (so each face takes its own numbered
 * material), fanned into triangles, with UVs placing the face on its texture.
 */
export function geometryOf(shape: DieShape): BufferGeometry {
  const positions: number[] = []
  const normals: number[] = []
  const uvs: number[] = []
  const geometry = new BufferGeometry()
  let start = 0
  shape.faces.forEach((ids, face) => {
    const layout = faceLayout(shape, face)
    const n = shape.normals[face]
    for (let k = 1; k < ids.length - 1; k++) {
      for (const corner of [0, k, k + 1]) {
        const v = shape.vertices[ids[corner]]
        positions.push(v.x, v.y, v.z)
        normals.push(n.x, n.y, n.z)
        uvs.push(layout[corner].u, layout[corner].v)
      }
    }
    const count = (ids.length - 2) * 3
    geometry.addGroup(start, count, face)
    start += count
  })
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3))
  geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2))
  return geometry
}
