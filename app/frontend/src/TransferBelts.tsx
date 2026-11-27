import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { BoxGeometry, DodecahedronGeometry, InstancedMesh, Matrix4, Object3D, Quaternion, Vector3 } from 'three'
import type { RenderLink } from './visualFactory'

interface Support {
  start: Vector3
  end: Vector3
  width: number
}

function supportsFor(link: RenderLink): Support[] {
  if (link.length < .9) return []
  const side = new Vector3(0, 0, link.width * .4).applyQuaternion(link.quaternion)
  const supports: Support[] = []
  const count = Math.min(5, Math.ceil(link.length / 2.1))
  for (let index = 1; index <= count; index++) {
    const center = link.start.clone().lerp(link.end, index / (count + 1))
    center.y -= .25
    if (center.y < .18) continue
    const a = center.clone().sub(side)
    const b = center.clone().add(side)
    const aFoot = a.clone().setY(.06)
    const bFoot = b.clone().setY(.06)
    supports.push({ start: aFoot, end: a, width: .062 },
      { start: bFoot, end: b, width: .062 },
      { start: aFoot.clone().setY(.16), end: b, width: .038 },
      { start: a, end: b, width: .060 })
  }
  return supports
}

const supportGeometry = new BoxGeometry()
const rockGeometry = new DodecahedronGeometry(1, 0)
const up = new Vector3(0, 1, 0)

export function TransferSupports({ links }: { links: RenderLink[] }) {
  const batch = useRef<InstancedMesh>(null)
  const supports = useMemo(() => links.flatMap(supportsFor), [links])
  useEffect(() => {
    const mesh = batch.current
    if (!mesh) return
    const transform = new Matrix4()
    const direction = new Vector3()
    const quaternion = new Quaternion()
    supports.forEach(({ start, end, width }, index) => {
      direction.copy(end).sub(start)
      const size = new Vector3(width, direction.length(), width)
      quaternion.setFromUnitVectors(up, direction.normalize())
      transform.compose(start.clone().lerp(end, .5), quaternion, size)
      mesh.setMatrixAt(index, transform)
    })
    mesh.instanceMatrix.needsUpdate = true
    mesh.computeBoundingSphere()
  }, [supports])
  if (!supports.length) return null
  return <instancedMesh ref={batch} args={[supportGeometry, undefined, supports.length]} castShadow receiveShadow>
    <meshStandardMaterial color="#626e73" roughness={.68} metalness={.44} />
  </instancedMesh>
}

export function BeltMaterial({ links, achieved, playing }: {
  links: RenderLink[]; achieved: Record<string, number>; playing: boolean
}) {
  const meshes = useRef(new Map<string, InstancedMesh>())
  const time = useRef(0)
  const { invalidate } = useThree()
  const point = useMemo(() => new Object3D(), [])
  const moving = links.some(link => (achieved[link.id] ?? 0) > 0)

  useEffect(() => {
    invalidate()
    if (!playing || !moving) return
    const timer = window.setInterval(() => { if (!document.hidden) invalidate() }, 1000 / 30)
    return () => window.clearInterval(timer)
  }, [invalidate, playing, moving, links, achieved])

  useFrame((_, delta) => {
    if (playing) time.current += Math.min(delta, .06)
    for (const link of links) {
      const mesh = meshes.current.get(link.id)
      const rate = achieved[link.id] ?? 0
      if (!mesh || rate <= 0) continue
      // Markers are illustrative. Rate controls both packing and relative motion.
      const count = Math.min(42, Math.max(3, Math.ceil(link.length * (2 + rate * 1.3))))
      const speed = .32 + Math.min(rate, 22) * .08
      const lateral = new Vector3(0, 0, 1).applyQuaternion(link.quaternion)
      mesh.count = count
      for (let index = 0; index < count; index++) {
        const progress = (index / count + time.current * speed / link.length) % 1
        const noise = Math.sin(index * 92.731)
        const fine = link.material === 'sand' || link.material === 'fine_aggregate'
        const size = (fine ? .04 : .065) * (.75 + (noise + 1) * .25)
        point.position.copy(link.start).lerp(link.end, progress).addScaledVector(lateral, link.width * .29 * noise)
        point.position.y += .032 + size * .33
        point.rotation.set(index * .73, index * 2, index * .39)
        point.scale.set(size * 1.22, size * .64, size)
        point.updateMatrix()
        mesh.setMatrixAt(index, point.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    }
  })

  return <group name="Achievable throughput indicators">
    {links.filter(link => (achieved[link.id] ?? 0) > 0).map(link => {
      const fine = link.material === 'sand' || link.material === 'fine_aggregate'
      return <instancedMesh key={link.id} ref={node => {
        if (node) meshes.current.set(link.id, node)
        else meshes.current.delete(link.id)
      }} args={[rockGeometry, undefined, 42]} frustumCulled={false}>
        <meshStandardMaterial color={fine ? '#bda777' : '#8d8272'} roughness={.94} />
      </instancedMesh>
    })}
  </group>
}
