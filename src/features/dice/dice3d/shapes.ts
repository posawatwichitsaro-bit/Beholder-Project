import { BoxGeometry, BufferGeometry, DodecahedronGeometry, Float32BufferAttribute, IcosahedronGeometry, Matrix4, OctahedronGeometry, Quaternion, TetrahedronGeometry, Vector3 } from 'three'

/**
 * Die shapes built in code (no model files) with their numbered faces. Each
 * face knows its centre, outward normal and an "up" direction for its number,
 * so a die can be turned to land showing any face upright to the camera (+z).
 */
export type Face = { center: Vector3; normal: Vector3; up: Vector3 }
export type Shape = { geometry: BufferGeometry; faces: Face[]; size: number }

/** Group a polyhedron's triangles into flat faces (same normal), in the order they first appear. */
function facesOf(geometry: BufferGeometry): Face[] {
  const flat = geometry.index ? geometry.toNonIndexed() : geometry
  const position = flat.getAttribute('position')
  const groups: { normal: Vector3; points: Vector3[] }[] = []
  for (let i = 0; i < position.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map(k => new Vector3().fromBufferAttribute(position, i + k))
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize()
    const group = groups.find(item => item.normal.dot(normal) > .999)
    if (group) group.points.push(a, b, c)
    else groups.push({ normal, points: [a, b, c] })
  }
  return groups.map(({ normal, points }) => {
    const unique = points.filter((p, i) => points.findIndex(q => q.distanceTo(p) < 1e-6) === i)
    const center = unique.reduce((sum, p) => sum.add(p), new Vector3()).divideScalar(unique.length)
    // Numbers read upright towards the face's first corner (for a d4, the corner opposite its base).
    const up = new Vector3().subVectors(unique[0], center).projectOnPlane(normal).normalize()
    return { center, normal, up }
  })
}

/** Pentagonal trapezohedron (d10) with flat kites: ring radius 1, ring heights ±e, apex height h = e(1+cos36°)/(1−cos36°). */
function d10Geometry() {
  const e = .105
  const c = Math.cos(Math.PI / 5)
  const h = e * (1 + c) / (1 - c)
  const at = (degrees: number, z: number) => new Vector3(Math.cos(degrees * Math.PI / 180), Math.sin(degrees * Math.PI / 180), z)
  const top = new Vector3(0, 0, h)
  const bottom = new Vector3(0, 0, -h)
  const low = (k: number) => at(72 * k, -e)
  const high = (k: number) => at(36 + 72 * k, e)
  const kites: Vector3[][] = []
  for (let k = 0; k < 5; k++) kites.push([top, high(k - 1), low(k), high(k)])
  for (let k = 0; k < 5; k++) kites.push([bottom, low(k + 1), high(k), low(k)])
  const positions: number[] = []
  for (const kite of kites) {
    // Two triangles per kite, wound to face outwards.
    let [a, b, cc, d] = kite
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(cc, a))
    const middle = kite.reduce((sum, p) => sum.clone().add(p), new Vector3()).divideScalar(4)
    if (normal.dot(middle) < 0) [b, d] = [d, b]
    for (const p of [a, b, cc, a, cc, d]) positions.push(p.x, p.y, p.z)
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3))
  geometry.computeVertexNormals()
  // Kites: up points from the face centre to its apex corner.
  const faces = kites.map(kite => {
    const center = kite.reduce((sum, p) => sum.clone().add(p), new Vector3()).divideScalar(4)
    const normal = new Vector3().subVectors(kite[2], kite[0]).cross(new Vector3().subVectors(kite[3], kite[1])).normalize()
    if (normal.dot(center) < 0) normal.negate()
    const up = new Vector3().subVectors(kite[0], center).projectOnPlane(normal).normalize()
    return { center, normal, up }
  })
  return { geometry, faces }
}

const cache = new Map<number, Shape>()
/** The shape of a d4, d6, d8, d10, d12 or d20 (radius about 1), built once. */
export function shapeOf(sides: number): Shape {
  let shape = cache.get(sides)
  if (shape) return shape
  if (sides === 10) {
    const { geometry, faces } = d10Geometry()
    shape = { geometry, faces, size: 1 }
  } else {
    const geometry = sides === 4 ? new TetrahedronGeometry(1.15) : sides === 6 ? new BoxGeometry(1.25, 1.25, 1.25)
      : sides === 8 ? new OctahedronGeometry(1.1) : sides === 12 ? new DodecahedronGeometry(1.05) : new IcosahedronGeometry(1.05)
    const flat = geometry.toNonIndexed()
    flat.computeVertexNormals()
    shape = { geometry: flat, faces: facesOf(geometry), size: 1 }
  }
  if (shape.faces.length !== sides) throw new Error('d' + sides + ' has ' + shape.faces.length + ' faces')
  cache.set(sides, shape)
  return shape
}

/** The rotation that shows face `index` (0-based) towards the camera (+z) with its number upright, turned `spin` radians. */
export function landing(face: Face, spin = 0) {
  const right = new Vector3().crossVectors(face.up, face.normal).normalize()
  const basis = new Matrix4().makeBasis(right, face.up, face.normal)
  const toFace = new Quaternion().setFromRotationMatrix(basis)
  return new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), spin).multiply(toFace.invert())
}
