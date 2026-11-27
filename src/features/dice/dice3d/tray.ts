import {
  ACESFilmicToneMapping, CanvasTexture, Color, DirectionalLight, Group, HemisphereLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, PlaneGeometry, Quaternion, SRGBColorSpace, Scene, Timer, Vector3, WebGLRenderer
} from 'three'
import type { Die } from './plan.ts'
import { faceLabel } from './plan.ts'
import { landing, shapeOf } from './shapes.ts'

/**
 * The 3D dice tray (three.js r187, WebGLRenderer). One renderer for the whole
 * page, created the first time dice are shown; its canvas moves into whichever
 * reveal is playing. The loop runs only while dice tumble, then stops on the
 * last frame. Dice land on the faces the server rolled.
 */
export type Outcome = 'critical' | 'fumble' | 'normal'
export const rollMs = 1200

let renderer: WebGLRenderer | undefined
const scene = new Scene()
const camera = new PerspectiveCamera(30, 2, .1, 100)
const timer = new Timer()
let dice: { group: Group; from: Vector3; to: Vector3; start: Quaternion; end: Quaternion; axis: Vector3; delay: number }[] = []
let elapsed = 0
let done: (() => void) | undefined

function setup() {
  renderer = new WebGLRenderer({ antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
  renderer.toneMapping = ACESFilmicToneMapping
  renderer.domElement.className = 'dice-tray-3d'
  renderer.domElement.setAttribute('aria-hidden', 'true')
  scene.add(new HemisphereLight(0xfff2dc, 0x3a2418, 1.4))
  const key = new DirectionalLight(0xffffff, 2.6)
  key.position.set(-3, 4, 9)
  scene.add(key)
  camera.position.set(0, -1.2, 10)
  camera.lookAt(0, 0, 0)
  timer.connect(document)
  Object.assign(window, { beholderDice: { renderer, scene } })
  return renderer
}

const bodies = new Map<string, MeshStandardMaterial>()
function body(outcome: Outcome) {
  let material = bodies.get(outcome)
  if (!material) {
    const color = outcome === 'critical' ? '#e8c25a' : outcome === 'fumble' ? '#b8503e' : '#ece0c4'
    material = new MeshStandardMaterial({ color: new Color(color), roughness: .45, metalness: outcome === 'critical' ? .35 : .05,
      emissive: new Color(outcome === 'critical' ? '#6a4a10' : '#000000'), flatShading: true })
    bodies.set(outcome, material)
  }
  return material
}

const labels = new Map<string, MeshStandardMaterial>()
function label(text: string) {
  let material = labels.get(text)
  if (!material) {
    const canvas = document.createElement('canvas')
    canvas.width = canvas.height = 128
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#2a1a10'
    ctx.font = '700 ' + (text.length > 2 ? 52 : text.length > 1 ? 64 : 76) + 'px "Cormorant Garamond", Georgia, serif'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, 64, 70)
    // 6 and 9 get a bar under them so they can't be read upside down.
    if (text === '6' || text === '9') ctx.fillRect(44, 104, 40, 6)
    const texture = new CanvasTexture(canvas)
    texture.colorSpace = SRGBColorSpace
    material = new MeshStandardMaterial({ map: texture, transparent: true, roughness: .6, depthWrite: false })
    labels.set(text, material)
  }
  return material
}
const labelSize: Record<number, number> = { 4: .95, 6: 1.05, 8: .9, 10: .85, 12: .85, 20: .78 }
const planes = new Map<number, PlaneGeometry>()

function build(die: Die, outcome: Outcome) {
  const shape = shapeOf(die.sides)
  const group = new Group()
  group.add(new Mesh(shape.geometry, body(outcome)))
  let plane = planes.get(die.sides)
  if (!plane) planes.set(die.sides, plane = new PlaneGeometry(labelSize[die.sides], labelSize[die.sides]))
  shape.faces.forEach((face, index) => {
    const mesh = new Mesh(plane, label(faceLabel(die.sides, index + 1, die.percentile)))
    mesh.quaternion.copy(landing(face).invert())
    mesh.position.copy(face.center).addScaledVector(face.normal, .012)
    group.add(mesh)
  })
  return group
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const smooth = (t: number) => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t)

function frame() {
  timer.update()
  elapsed += Math.min(Math.max(timer.getDelta(), 0), .1) * 1000
  for (const die of dice) {
    const t = Math.max(0, Math.min(1, (elapsed - die.delay) / (rollMs - die.delay)))
    // Slide in from the left with a small hop, tumbling; settle onto the rolled face over the last half.
    die.group.position.lerpVectors(die.from, die.to, ease(t))
    die.group.position.z = Math.abs(Math.sin(t * Math.PI * 2.5)) * (1 - t) * 1.2
    const spin = new Quaternion().setFromAxisAngle(die.axis, 16 * ease(t)).multiply(die.start)
    die.group.quaternion.slerpQuaternions(spin, die.end, smooth((t - .45) / .55))
  }
  renderer!.render(scene, camera)
  if (elapsed >= rollMs) {
    renderer!.setAnimationLoop(null)
    done?.()
    done = undefined
  }
}

/** Show `list` tumbling in `host` (sized by CSS) and resolve when they have landed. */
export function playDice(host: HTMLElement, list: Die[], outcome: Outcome) {
  const view = renderer ?? setup()
  host.appendChild(view.domElement)
  const width = Math.max(1, host.clientWidth)
  const height = Math.max(1, host.clientHeight)
  view.setSize(width, height, false)
  camera.aspect = width / height
  // Pull the camera back far enough for every die to fit across the tray.
  const span = list.length * 2.5
  camera.position.z = Math.max(7, span / (2 * Math.tan(15 * Math.PI / 180) * camera.aspect) + 1.5)
  camera.updateProjectionMatrix()
  for (const old of dice) scene.remove(old.group)
  dice = list.map((die, index) => {
    const group = build(die, outcome)
    scene.add(group)
    const x = (index - (list.length - 1) / 2) * 2.5
    const face = shapeOf(die.sides).faces[die.value - 1]
    return {
      group, from: new Vector3(x - 7, -1.5, 0), to: new Vector3(x, 0, 0),
      start: new Quaternion().random(), end: landing(face, (Math.random() - .5) * .5),
      axis: new Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize(), delay: index * 60
    }
  })
  elapsed = 0
  timer.reset()
  done?.()
  return new Promise<void>(resolve => {
    done = resolve
    view.setAnimationLoop(frame)
  })
}

/** Stop tumbling (the reveal closed early) and take the canvas back out of the page. */
export function stopDice() {
  renderer?.setAnimationLoop(null)
  renderer?.domElement.remove()
  done?.()
  done = undefined
}
