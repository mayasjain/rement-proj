import { writeFile } from 'node:fs/promises'
import * as T from 'three'
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

// GLTFExporter uses FileReader for browser Blobs. This adapter keeps authoring offline in Node.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result
      this.onloadend?.()
    })
  }
}

const palette = {
  frame: ['#3d4850', .45, .66], zinc: ['#8e9ba3', .58, .57],
  steel: ['#56646b', .55, .62], edge: ['#242d33', .24, .78],
  ochre: ['#bd8533', .18, .62], yellow: ['#e2ae44', .12, .6],
  blue: ['#416773', .23, .64], green: ['#55746a', .22, .64],
  rubber: ['#303331', .04, .93],
  sand: ['#b29a68', 0, .97], stone: ['#84817a', 0, .94],
}
const materials = Object.fromEntries(Object.entries(palette).map(([name, [color, metalness, roughness]]) => [
  name, new T.MeshStandardMaterial({ name, color, metalness, roughness }),
]))
const scene = new T.Scene()

// Machine units are normalized around the center of the floor footprint.
// Subassemblies are centered about their own engineering pivot.
function assembly(name, build, centered = false) {
  const batches = new Map()
  const axis = new T.Vector3(0, 1, 0)
  function piece(geometry, material, point, orientation = new T.Quaternion()) {
    const matrix = new T.Matrix4().compose(new T.Vector3(...point), orientation, new T.Vector3(1, 1, 1))
    const vertices = geometry.index ? geometry.toNonIndexed() : geometry
    vertices.deleteAttribute('uv')
    vertices.applyMatrix4(matrix)
    if (!batches.has(material)) batches.set(material, [])
    batches.get(material).push(vertices)
  }
  function box(material, point, size, bevel = 0, tilt = 0) {
    const geometry = bevel ? new RoundedBoxGeometry(...size, 1, bevel) : new T.BoxGeometry(...size)
    piece(geometry, material, point, new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 0, 1), tilt))
  }
  function bar(material, a, b, width) {
    const start = new T.Vector3(...a)
    const direction = new T.Vector3(...b).sub(start)
    const middle = start.addScaledVector(direction, .5)
    const rotation = new T.Quaternion().setFromUnitVectors(axis, direction.clone().normalize())
    piece(new T.BoxGeometry(width, direction.length(), width), material, middle.toArray(), rotation)
  }
  function cylinder(material, point, radius, length, direction = [0, 0, 1], sides = 16) {
    const end = new T.Vector3(...direction).normalize()
    piece(new T.CylinderGeometry(radius, radius, length, sides), material, point,
      new T.Quaternion().setFromUnitVectors(axis, end))
  }
  function openShell(material, near, far) {
    const positions = []
    for (let index = 0; index < near.length; index++) {
      const next = (index + 1) % near.length
      positions.push(...near[index], ...near[next], ...far[next], ...near[index], ...far[next], ...far[index])
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(positions, 3))
    geometry.computeVertexNormals()
    piece(geometry, material, [0, 0, 0])
  }
  build({ box, bar, cylinder, openShell, piece })
  const group = new T.Group()
  group.name = name
  const bounds = new T.Box3()
  for (const [material, geometries] of batches) {
    const merged = mergeVertices(mergeGeometries(geometries))
    merged.computeBoundingBox()
    bounds.union(merged.boundingBox)
    group.add(new T.Mesh(merged, materials[material]))
  }
  const center = bounds.getCenter(new T.Vector3())
  if (!centered) center.y = bounds.min.y
  const scale = new T.Vector3(1, 1, 1).divide(bounds.getSize(new T.Vector3()))
  for (const mesh of group.children) mesh.geometry.translate(-center.x, -center.y, -center.z).scale(scale.x, scale.y, scale.z)
  scene.add(group)
}

function skid({ box, bar }, top = .37) {
  for (const z of [-.38, .38]) {
    box('frame', [0, .045, z], [.96, .09, .12], .012)
    box('zinc', [0, top, z], [.92, .055, .10])
    for (const x of [-.40, .40]) {
      box('frame', [x, top / 2, z], [.08, top, .08])
      box('zinc', [x, .014, z], [.16, .028, .17])
      bar('steel', [x, .09, z], [x * .39, top, z], .037)
    }
  }
  for (const x of [-.40, .40]) box('frame', [x, .14, 0], [.08, .054, .87])
}

assembly('jaw_crusher', ({ box, bar, cylinder, openShell }) => {
  const rectangle = (x, y, z) => [[-x, y, -z], [-x, y, z], [x, y, z], [x, y, -z]]
  openShell('ochre', rectangle(.19, .58, .20), rectangle(.45, .94, .39))
  openShell('edge', rectangle(.165, .58, .176).reverse(), rectangle(.425, .94, .366).reverse())
  for (const z of [-.39, .39]) box('yellow', [0, .947, z], [.93, .045, .059], .008)
  for (const x of [-.45, .45]) box('yellow', [x, .947, 0], [.055, .045, .83], .008)
  for (const z of [-.34, .34]) {
    box('ochre', [-.04, .434, z], [.83, .31, .092], .024)
    box('steel', [-.04, .42, z * 1.16], [.48, .24, .027], .009)
    cylinder('frame', [.17, .50, z * 1.27], .13, .063)
    cylinder('zinc', [.17, .50, z * 1.39], .067, .028)
    for (const x of [-.42, -.24, .32]) {
      bar('steel', [x, .291, z * 1.1], [x + .07, .6, z * 1.1], .042)
      for (const y of [.32, .55]) cylinder('zinc', [x, y, z * 1.27], .022, .022, [0, 0, 1], 6)
    }
  }
  box('frame', [-.29, .25, 0], [.15, .20, .72], .02)
  box('rubber', [.29, .22, 0], [.40, .07, .48], .015)
  for (const z of [-.25, .25]) bar('zinc', [.11, .28, z], [.49, .23, z], .047)
})

assembly('motor', ({ box, cylinder }) => {
  cylinder('blue', [0, 0, 0], .34, .67, [1, 0, 0], 24)
  for (const x of [-.34, -.21, -.12, -.03, .06, .15, .24, .33]) {
    cylinder('steel', [x, 0, 0], .38, .036, [1, 0, 0], 20)
  }
  cylinder('edge', [-.39, 0, 0], .34, .11, [1, 0, 0], 24)
  cylinder('zinc', [.43, 0, 0], .105, .15, [1, 0, 0], 16)
  box('blue', [.05, .36, 0], [.31, .20, .40], .035)
  box('frame', [0, -.37, 0], [.72, .12, .83], .018)
  for (const x of [-.25, .25]) for (const z of [-.31, .31]) {
    cylinder('zinc', [x, -.28, z], .05, .10, [0, 1, 0], 6)
  }
}, true)

assembly('jaw', ({ box, bar }) => {
  const angle = -.27
  box('steel', [0, 0, 0], [.24, .87, .90], .027, angle)
  box('frame', [-.18, -.13, 0], [.21, .57, .86], .018, angle)
  for (const z of [-.40, -.30, -.20, -.10, 0, .10, .20, .30, .40]) {
    bar('zinc', [.02, .44, z], [.25, -.39, z], .054)
  }
  for (const y of [-.34, .36]) box('edge', [-.06, y, 0], [.32, .09, 1], .01)
}, true)

assembly('frame', ({ box, bar, cylinder }) => {
  for (const z of [-.40, .40]) {
    box('frame', [0, -.04, z], [1, .16, .13], .015)
    box('steel', [0, .13, z], [1, .15, .10])
    for (const x of [-.40, .40]) {
      box('frame', [x, -.21, z], [.10, .43, .12], .014)
      box('zinc', [x, -.43, z], [.17, .10, .19])
      cylinder('steel', [x, -.32, z], .043, .14, [0, 1, 0], 6)
      bar('zinc', [x, -.32, z], [x * .40, .05, z], .05)
    }
  }
  for (const x of [-.40, .40]) box('frame', [x, 0, 0], [.11, .16, .84])
}, true)

assembly('screen', parts => {
  const { box, bar, cylinder } = parts
  skid(parts, .39)
  for (const x of [-.34, .35]) for (const z of [-.35, .35]) {
    cylinder('edge', [x, .53, z], .073, .24, [0, 1, 0], 14)
    for (const y of [.44, .48, .52, .56, .60]) cylinder('zinc', [x, y, z], .085, .019, [0, 1, 0], 14)
  }
  for (const z of [-.39, .39]) {
    box('blue', [-.005, .74, z], [.94, .34, .083], .018, -.16)
    box('zinc', [0, .901, z], [.95, .045, .095], .01, -.16)
    box('steel', [0, .626, z * 1.13], [.79, .042, .039], .008, -.16)
    for (const x of [-.36, -.18, 0, .18, .36]) cylinder('zinc', [x, .78 - x * .16, z * 1.14], .025, .015, [0, 0, 1], 6)
  }
  box('rubber', [0, .703, 0], [.88, .08, .74], .009, -.16)
  for (let x = -.41; x <= .42; x += .045) box('steel', [x, .754 - x * .16, 0], [.017, .025, .73], 0, -.16)
  for (const z of [-.26, -.13, 0, .13, .26]) bar('steel', [-.41, .829, z], [.42, .692, z], .018)
  for (const z of [-.12, .15]) {
    box('edge', [-.445, .773, z], [.085, .19, .31], .012)
    box('blue', [.46, .59, z], [.08, .12, .29], .013, -.5)
  }
  cylinder('ochre', [.12, .77, -.49], .107, .12)
  cylinder('zinc', [.12, .77, -.55], .072, .025)
})

assembly('washer', parts => {
  const { box, bar, cylinder } = parts
  skid(parts, .30)
  box('blue', [0, .38, 0], [.88, .29, .82], .035, .08)
  for (const z of [-.40, .40]) {
    box('zinc', [.03, .51, z], [.88, .059, .085], .007, .08)
    for (const x of [-.31, -.12, .07, .26]) bar('steel', [x, .255, z], [x+.04, .51, z], .038)
  }
  // Two opposed collars, a drum shell, structural bands and a geared drive.
  cylinder('green', [0, .66, 0], .252, .65, [1, .12, 0], 28)
  for (const x of [-.30, -.22, 0, .22, .31]) cylinder('steel', [x, .66 + x * .12, 0], .263, .034, [1, .12, 0], 24)
  for (const x of [-.338, .34]) {
    cylinder('zinc', [x, .66 + x * .12, 0], .185, .035, [1, 0, 0], 24)
    cylinder('edge', [x * 1.07, .66 + x * .12, 0], .142, .025, [1, 0, 0], 24)
  }
  box('blue', [-.415, .64, 0], [.15, .23, .31], .018)
  for (const z of [-.21, .21]) box('zinc', [.42, .64, z], [.16, .10, .09], .007)
  cylinder('ochre', [.26, .34, .42], .10, .13)
  cylinder('zinc', [.26, .34, .49], .065, .027)
  box('steel', [0, .93, 0], [.13, .12, .15], .012)
})

function beltDeck({ box, bar, cylinder }, y, length, tilt = 0) {
  const left = -length / 2, right = length / 2
  const level = x => y + x * tilt
  box('rubber', [0, y+.055, 0], [length, .061, .66], .013, tilt)
  for (const z of [-.37, .37]) {
    bar('frame', [left, level(left), z], [right, level(right), z], .07)
    bar('zinc', [left, level(left)-.174, z], [right, level(right)-.174, z], .037)
    for (let i = 0; i < 6; i++) {
      const x = left + i * length / 6, next = x + length / 6
      bar('steel', [x, level(x), z], [next, level(next)-.165, z], .026)
    }
  }
  for (let index = 0; index <= 9; index++) {
    const x = left + index * length / 9
    cylinder(index === 0 || index === 9 ? 'zinc' : 'steel', [x, level(x)+.015, 0], .037, .76, [0, 0, 1], 10)
  }
  for (const x of [left, right]) for (const z of [-.387, .387]) {
    box('yellow', [x, level(x)+.052, z], [.13, .14, .075], .012, tilt)
  }
}

assembly('conveyor', parts => {
  const { box, bar, cylinder } = parts
  beltDeck(parts, .78, .94, .19)
  for (const x of [-.35, .35]) {
    const height = .59 + x * .19
    for (const z of [-.32, .32]) {
      box('frame', [x, height / 2, z], [.056, height, .075], .007)
      box('zinc', [x, .025, z], [.14, .05, .15], .007)
    }
    bar('zinc', [x, .17, -.32], [x, height, .32], .035)
  }
  cylinder('ochre', [.30, .68, .41], .115, .16)
  for (const offset of [.39, .42, .45]) cylinder('frame', [.30, .68, offset], .118, .021)
  box('yellow', [.40, .94, .30], [.15, .12, .18], .01)
})

assembly('transfer', parts => beltDeck(parts, .19, 1))

function storage(name, Fill) {
  assembly(name, ({ box, bar, piece }) => {
    box('frame', [0, .05, 0], [1, .1, .97], .012)
    box('steel', [0, .14, 0], [.91, .16, .86], .023)
    for (const z of [-.455, .455]) {
      box('blue', [0, .525, z], [.97, .81, .063], .012)
      box('zinc', [0, .938, z], [.99, .074, .088], .014)
      for (const x of [-.42, -.23, 0, .23, .42]) {
        box('steel', [x, .482, z * 1.05], [.047, .74, .066])
        bar('zinc', [x, .25, z * 1.1], [x+.067, .74, z * 1.1], .022)
      }
    }
    box('blue', [.461, .52, 0], [.06, .81, .9], .014)
    box('zinc', [.462, .938, 0], [.086, .074, .91], .009)
    box('steel', [-.457, .30, 0], [.075, .41, .92], .011)
    box('yellow', [-.461, .505, 0], [.084, .049, .91], .007)
    // Stable uneven stockpile, with a continuous base rather than individual props.
    const rows = 9, heights = []
    for (let z = 0; z < rows; z++) for (let x = 0; x < rows; x++) {
      const u = (x-4)/4, v = (z-4)/4
      const peak = Math.max(0, 1 - Math.hypot(u+.12, v-.05))
      heights.push([u*.44, .23 + peak*.57 + (Math.sin(x*19+z*3)+1)*.019, v*.42])
    }
    const points = []
    for (let z = 0; z < rows-1; z++) for (let x = 0; x < rows-1; x++) {
      const i = z*rows+x
      points.push(...heights[i], ...heights[i+rows], ...heights[i+1],
        ...heights[i+1], ...heights[i+rows], ...heights[i+rows+1])
    }
    const geometry = new T.BufferGeometry().setAttribute('position', new T.Float32BufferAttribute(points, 3))
    geometry.computeVertexNormals()
    piece(geometry, Fill, [0, 0, 0])
  })
}
storage('sand_storage', 'sand')
storage('gravel_storage', 'stone')

const binary = await new GLTFExporter().parseAsync(scene, { binary: true })
await writeFile(new URL('../public/models/industrial.glb', import.meta.url), new Uint8Array(binary))
