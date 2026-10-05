import {
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  OrthographicCamera,
  PCFSoftShadowMap,
  Plane,
  PlaneGeometry,
  Raycaster,
  Scene,
  ShadowMaterial,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { geometryOf, shapeOf, type DieKind } from './shapes.ts'
import { simulateThrow, STEP, type Recording } from './simulate.ts'
import { d4FaceTexture, faceTexture } from './textures.ts'

/**
 * The dice table: one transparent WebGL canvas over the map. Each throw is
 * simulated in full, its faces numbered so the top one shows the real result,
 * then played back where its roller stands (following the map camera), held to
 * be read, and faded away.
 */

/** Screen pixels per die unit (a d6 is about 40px across, a d20 a little more). */
const SCALE = 34
/** The camera leans this far from straight down, toward the viewer, so dice read as solid. */
const TILT = 0.42
const HOLD_MS = 2600
const FADE_MS = 500
const GOLD = new Color('#e3bf6a')
const RED = new Color('#d9625e')
const WHITE = new Color('#ffffff')

export interface ThrowDie {
  kind: DieKind
  /** Every face's label, in order (d4: every corner's). */
  labels: string[]
  /** The label that must come out on top: the real result. */
  result: string
  discarded: boolean
  accent: 'crit' | 'fumble' | null
}

export interface ThrowRequest {
  dice: ThrowDie[]
  color: string
  /** Direction on the table, radians (π/2 is toward the viewer). */
  aim: number
  /** Where it's thrown from, in container pixels each frame; null hides it (its token is off this floor). */
  anchor: () => { x: number; y: number } | null
  onSettled: () => void
}

interface Throw {
  request: ThrowRequest
  recording: Recording
  meshes: Mesh[]
  materials: MeshStandardMaterial[][]
  started: number
  settledAt: number | null
}

/** Number the faces (or d4 corners) so the one that lands on top reads `result`. */
function numbering(die: ThrowDie, top: number): string[] {
  const n = die.labels.length
  const shift = Math.max(0, die.labels.indexOf(die.result))
  return die.labels.map((_, slot) => die.labels[(slot - top + shift + n * 2) % n])
}

export class DiceScene {
  private renderer: WebGLRenderer
  private scene = new Scene()
  private camera = new OrthographicCamera()
  private light = new DirectionalLight('#fff6e8', 2.4)
  private raycaster = new Raycaster()
  private table = new Plane(new Vector3(0, 1, 0), 0)
  private geometries = new Map<DieKind, BufferGeometry>()
  private throws: Throw[] = []
  private frame = 0
  private resize: ResizeObserver
  private width = 1
  private height = 1
  private container: HTMLElement

  constructor(container: HTMLElement) {
    this.container = container
    this.renderer = new WebGLRenderer({ alpha: true, antialias: true })
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    this.renderer.outputColorSpace = SRGBColorSpace
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = PCFSoftShadowMap
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.domElement.className = 'dice-canvas'
    container.append(this.renderer.domElement)

    this.camera.up.set(0, 0, -1)
    this.camera.position.set(0, Math.cos(TILT) * 2000, Math.sin(TILT) * 2000)
    this.camera.lookAt(0, 0, 0)
    this.camera.near = 1
    this.camera.far = 5000

    this.scene.add(new HemisphereLight('#ffffff', '#3a3b44', 1.5))
    this.light.position.set(-500, 1400, -350)
    this.light.castShadow = true
    this.light.shadow.mapSize.set(2048, 2048)
    this.light.shadow.bias = -0.0005
    this.light.shadow.radius = 4
    this.scene.add(this.light, this.light.target)

    // An invisible table that only catches shadows.
    const floor = new Mesh(new PlaneGeometry(20000, 20000), new ShadowMaterial({ opacity: 0.38 }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    this.scene.add(floor)

    this.resize = new ResizeObserver(() => this.fit())
    this.resize.observe(container)
    this.fit()
  }

  private fit(): void {
    this.width = Math.max(1, this.container.clientWidth)
    this.height = Math.max(1, this.container.clientHeight)
    this.renderer.setSize(this.width, this.height, false)
    Object.assign(this.camera, {
      left: -this.width / 2,
      right: this.width / 2,
      top: this.height / 2,
      bottom: -this.height / 2,
    })
    this.camera.updateProjectionMatrix()
    // Shadows over everything the camera can see of the table.
    const reach = Math.max(this.width, this.height / Math.cos(TILT))
    Object.assign(this.light.shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 5000 })
    this.light.shadow.camera.updateProjectionMatrix()
  }

  private geometry(kind: DieKind): BufferGeometry {
    let geometry = this.geometries.get(kind)
    if (!geometry) {
      geometry = geometryOf(shapeOf(kind))
      this.geometries.set(kind, geometry)
    }
    return geometry
  }

  /** Where a container pixel lands on the table. */
  private onTable(x: number, y: number): Vector3 | null {
    this.raycaster.setFromCamera(new Vector2((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1), this.camera)
    return this.raycaster.ray.intersectPlane(this.table, new Vector3())
  }

  throw(request: ThrowRequest): void {
    const recording = simulateThrow(
      request.dice.map((die) => die.kind),
      request.aim,
    )
    const meshes: Mesh[] = []
    const materials: MeshStandardMaterial[][] = []
    request.dice.forEach((die, i) => {
      const shape = shapeOf(die.kind)
      const labels = numbering(die, recording.up[i])
      const faceMaterials = shape.faces.map((face, f) => {
        const map =
          die.kind === 'd4'
            ? d4FaceTexture(request.color, f, face.map((corner) => labels[corner]))
            : faceTexture(request.color, labels[f], face.length)
        return new MeshStandardMaterial({ map, roughness: 0.38, metalness: 0.05 })
      })
      const mesh = new Mesh(this.geometry(die.kind), faceMaterials)
      mesh.scale.setScalar(SCALE)
      mesh.castShadow = true
      mesh.visible = false
      this.scene.add(mesh)
      meshes.push(mesh)
      materials.push(faceMaterials)
    })
    this.throws.push({ request, recording, meshes, materials, started: performance.now(), settledAt: null })
    if (!this.frame) this.frame = requestAnimationFrame(this.tick)
  }

  private tick = (now: number): void => {
    for (const item of this.throws) this.advance(item, now)
    const done = this.throws.filter((item) => item.settledAt !== null && now - item.settledAt > HOLD_MS + FADE_MS)
    for (const item of done) this.remove(item)
    this.throws = this.throws.filter((item) => !done.includes(item))
    this.renderer.render(this.scene, this.camera)
    this.frame = this.throws.length ? requestAnimationFrame(this.tick) : 0
  }

  private advance(item: Throw, now: number): void {
    const { recording, request } = item
    const frame = Math.min(recording.frames - 1, Math.floor((now - item.started) / (STEP * 1000)))
    const anchor = request.anchor()
    const origin = anchor ? this.onTable(anchor.x, anchor.y) : null
    item.meshes.forEach((mesh, i) => {
      mesh.visible = origin !== null
      if (!origin) return
      const p = recording.positions[i]
      const r = recording.rotations[i]
      mesh.position.set(origin.x + p[frame * 3] * SCALE, p[frame * 3 + 1] * SCALE, origin.z + p[frame * 3 + 2] * SCALE)
      mesh.quaternion.set(r[frame * 4], r[frame * 4 + 1], r[frame * 4 + 2], r[frame * 4 + 3])
    })

    if (item.settledAt === null && frame === recording.frames - 1) {
      item.settledAt = now
      // Landed: the face that counts lights up (gold for a natural 20, red for a 1,
      // a faint lift otherwise); a dropped die steps back.
      request.dice.forEach((die, i) => {
        if (die.kind !== 'd4' && !die.discarded) {
          const top = item.materials[i][recording.up[i]]
          top.emissive = die.accent === 'crit' ? GOLD : die.accent === 'fumble' ? RED : WHITE
          top.emissiveIntensity = die.accent ? 0.6 : 0.12
        }
        if (die.discarded) {
          for (const material of item.materials[i]) {
            material.transparent = true
            material.opacity = 0.45
          }
        }
      })
      request.onSettled()
    }

    if (item.settledAt !== null) {
      const fade = Math.min(1, Math.max(0, (now - item.settledAt - HOLD_MS) / FADE_MS))
      if (fade > 0) {
        item.request.dice.forEach((die, i) => {
          for (const material of item.materials[i]) {
            material.transparent = true
            material.opacity = (die.discarded ? 0.45 : 1) * (1 - fade)
          }
        })
      }
    }
  }

  private remove(item: Throw): void {
    for (const mesh of item.meshes) this.scene.remove(mesh)
    // Textures are shared and cached; the per-die materials go.
    for (const set of item.materials) for (const material of set) material.dispose()
  }

  dispose(): void {
    cancelAnimationFrame(this.frame)
    this.resize.disconnect()
    for (const item of this.throws) this.remove(item)
    for (const geometry of this.geometries.values()) geometry.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
  }
}
