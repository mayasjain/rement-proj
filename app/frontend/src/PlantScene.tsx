import { Component as Boundary, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Line, OrbitControls } from '@react-three/drei'
import { MathUtils, OrthographicCamera, Vector3 } from 'three'
import type { Component, Equipment, EquipmentType, Plant, Vector } from './plant'

const steel = '#283c4e'
const trim = '#688198'
const dark = '#182735'
const equipmentColors: Record<EquipmentType, string> = {
  hopper: '#557b92', crusher: '#426783', screen: '#647e91',
  washer: '#567e89', conveyor: '#4b667a', storage: '#547389',
}

function Box({ at, size, color, tilt = 0 }: { at: Vector; size: Vector; color: string; tilt?: number }) {
  return <mesh position={at} rotation={[0, 0, tilt]} castShadow receiveShadow>
    <boxGeometry args={size} /><meshStandardMaterial color={color} roughness={0.72} />
  </mesh>
}

function Cylinder({ at, radii, height, color, sides = 24, horizontal = false }: {
  at: Vector; radii: [number, number]; height: number; color: string; sides?: number; horizontal?: boolean
}) {
  return <mesh position={at} rotation={[horizontal ? Math.PI / 2 : 0, sides === 4 ? Math.PI / 4 : 0, 0]} castShadow receiveShadow>
    <cylinderGeometry args={[...radii, height, sides]} /><meshStandardMaterial color={color} roughness={0.7} />
  </mesh>
}

function Machine({ type, color }: { type: EquipmentType; color: string }) {
  switch (type) {
    case 'hopper':
      return <>
        <Cylinder at={[0, .58, 0]} radii={[.68, .19]} height={.55} sides={4} color={color} />
        <Box at={[0, .86, 0]} size={[.96, .08, .96]} color={steel} />
        <Box at={[0, .91, 0]} size={[.78, .05, .78]} color="#a39279" />
        {[-.33, .33].flatMap(x => [-.32, .32].map(z =>
          <Box key={`${x},${z}`} at={[x, .21, z]} size={[.08, .42, .08]} color={steel} />))}
      </>
    case 'crusher':
      return <>
        <Box at={[-.4, .48, 0]} size={[.12, .48, .73]} color={color} />
        <Box at={[.38, .49, -.11]} size={[.1, .5, .52]} color={color} />
        <Box at={[0, .7, -.35]} size={[.9, .2, .13]} color={color} />
        <Cylinder at={[0, .81, -.02]} radii={[.46, .21]} height={.28} sides={4} color={color} />
        <Box at={[0, .96, -.02]} size={[.66, .05, .66]} color={steel} />
        <Box at={[0, .99, -.02]} size={[.48, .017, .48]} color={dark} />
      </>
    case 'screen':
      return <>
        <Box at={[0, .11, 0]} size={[.88, .12, .75]} color={steel} />
        {[-.34, .34].map(x => <Box key={x} at={[x, .35, 0]} size={[.1, .52, .62]} color={trim} />)}
        <group rotation={[0, 0, -.13]}>
          <Box at={[0, .69, 0]} size={[.98, .18, .9]} color={color} />
          <Box at={[0, .8, 0]} size={[.86, .09, .7]} color={dark} />
          {[-.33, -.22, -.11, 0, .11, .22, .33].map(x =>
            <Box key={x} at={[x, .85, 0]} size={[.035, .03, .69]} color={trim} />)}
        </group>
      </>
    case 'washer':
      return <>
        <Box at={[0, .15, 0]} size={[.95, .15, .75]} color={steel} />
        <Box at={[0, .36, 0]} size={[.9, .4, .88]} color={color} />
        <Cylinder at={[0, .65, 0]} radii={[.3, .3]} height={.72} color={color} horizontal />
        <Cylinder at={[0, .65, .37]} radii={[.23, .23]} height={.08} color={trim} horizontal />
        <Cylinder at={[0, .65, .43]} radii={[.085, .085]} height={.05} color={dark} horizontal />
      </>
    case 'conveyor':
      return <>
        {[-.37, .36].map(x => <Box key={x} at={[x, .3, 0]} size={[.055, .55, .68]} color={steel} />)}
        <group position={[0, .63, 0]} rotation={[0, 0, .14]}>
          <Box at={[0, 0, 0]} size={[.99, .15, .79]} color={color} />
          <Box at={[0, .09, 0]} size={[.95, .07, .63]} color={dark} />
          {[-.34, -.17, 0, .17, .34].map(x =>
            <Box key={x} at={[x, .13, 0]} size={[.013, .012, .6]} color={trim} />)}
        </group>
      </>
    case 'storage':
      return <>
        <Box at={[0, .07, 0]} size={[.98, .11, .98]} color={steel} />
        <Box at={[0, .3, 0]} size={[.92, .33, .92]} color={color} />
        {[-.44, .44].map(edge => <group key={edge}>
          <Box at={[edge, .64, 0]} size={[.07, .68, .94]} color={color} />
          <Box at={[0, .55, edge]} size={[.89, .5, .07]} color={color} />
        </group>)}
        <mesh position={[0, .51, 0]} castShadow receiveShadow>
          <coneGeometry args={[.54, .56, 5]} /><meshStandardMaterial color="#a7977b" />
        </mesh>
      </>
  }
}

function InternalPart({ item, selected, overloaded, onSelect }: {
  item: Component; selected: boolean; overloaded: boolean; onSelect: (id: string) => void
}) {
  const color = selected ? '#ecb45c' : overloaded ? '#cf725c' : '#c29660'
  return <group position={item.geometry.local_position_m} scale={item.geometry.dimensions_m}
    onClick={event => { event.stopPropagation(); onSelect(item.id) }}>
    {item.geometry.model_key === 'motor'
      ? <Cylinder at={[0, 0, 0]} radii={[.45, .45]} height={.9} horizontal color={color} />
      : <Box at={[0, 0, 0]} size={[1, 1, 1]} color={color} tilt={item.geometry.model_key === 'jaw' ? .26 : 0} />}
  </group>
}

function ViewCamera({ center, span }: { center: Vector; span: number }) {
  const { camera, size } = useThree()
  const [x, y, z] = center
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return
    camera.position.set(x + span * .75, y + span * .93, z + span * 1.38)
    camera.zoom = Math.min(size.width / (span * 1.2), size.height / (span * .72))
    camera.lookAt(x, y, z)
    camera.updateProjectionMatrix()
  }, [camera, x, y, z, span, size.width, size.height])
  return <OrbitControls target={center} makeDefault minPolarAngle={.12} maxPolarAngle={Math.PI / 2.05}
    minZoom={10} maxZoom={160} enableDamping={false} />
}

function ProjectLabels({ equipment, labels }: { equipment: Equipment[]; labels: Map<string, HTMLButtonElement> }) {
  const point = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    for (const item of equipment) {
      const label = labels.get(item.id)
      if (!label) continue
      const [x, y, z] = item.geometry.position_m
      point.set(x, y + item.geometry.dimensions_m[1] + .4, z).project(camera)
      label.style.visibility = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1
        ? 'visible' : 'hidden'
      label.style.transform = `translate(${(point.x + 1) * size.width / 2}px, ${(1 - point.y) * size.height / 2}px) translate(-50%, -50%)`
    }
  })
  return null
}

class SceneBoundary extends Boundary<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <SceneUnavailable /> : this.props.children }
}

function SceneUnavailable() {
  return <div className="scene-unavailable">3D needs WebGL. Use the equipment list to inspect the plant.</div>
}

export function PlantScene({ plant, selectedId, overloadedIds, onSelect }: {
  plant: Plant; selectedId: string; overloadedIds: Set<string>; onSelect: (id: string) => void
}) {
  const [cameraReset, resetCamera] = useState(0)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const layout = useMemo(() => {
    const xs = plant.equipment.map(item => item.geometry.position_m[0])
    const zs = plant.equipment.map(item => item.geometry.position_m[2])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const center: Vector = [(minX + maxX) / 2, 0, (minZ + maxZ) / 2]
    return { center, span: Math.max(maxX - minX, maxZ - minZ, 8) + 4 }
  }, [plant.equipment])
  const equipment = new Map(plant.equipment.map(item => [item.id, item]))
  const components = new Map(plant.components.map(item => [item.id, item]))

  return <div className="viewport">
    <SceneBoundary key={cameraReset}>
      <Canvas orthographic frameloop="demand" shadows="percentage" dpr={[1, 1.5]}
        camera={{ near: .1, far: 300 }} fallback={<SceneUnavailable />}>
        <color attach="background" args={['#eaf0f3']} />
        <ViewCamera {...layout} />
        <ProjectLabels equipment={plant.equipment} labels={labels.current} />
        <ambientLight intensity={1.4} />
        <directionalLight position={[layout.center[0] + 8, 14, 7]} intensity={2.35} castShadow
          target-position={layout.center} shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-layout.span} shadow-camera-right={layout.span}
          shadow-camera-top={layout.span} shadow-camera-bottom={-layout.span}
          shadow-camera-far={layout.span * 3} shadow-normalBias={.035} />
        <gridHelper args={[layout.span * 2, Math.ceil(layout.span * 2), '#b8c9d3', '#cedbe2']}
          position={[layout.center[0], -.015, layout.center[2]]} />
        <mesh position={[layout.center[0], -.03, layout.center[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <planeGeometry args={[layout.span * 2, layout.span * 2]} />
          <meshStandardMaterial color="#e7eef2" roughness={1} />
        </mesh>
        {plant.connections.map(stream => {
          const source = equipment.get(stream.from.equipment_id)!
          const destination = equipment.get(stream.to.equipment_id)!
          const start = new Vector3(...source.geometry.position_m)
          const end = new Vector3(...destination.geometry.position_m)
          const from = start.clone().lerp(end, .2).setY(start.y + .25)
          const to = start.clone().lerp(end, .8).setY(end.y + .25)
          const midpoint = from.clone().lerp(to, .62)
          const angle = Math.atan2(to.z - from.z, to.x - from.x)
          return <group key={stream.id}>
            <Line points={[from, to]} color="#4c819b" lineWidth={1.8} dashed dashSize={.18} gapSize={.1} />
            <mesh position={midpoint} rotation={[0, -angle, -Math.PI / 2]}>
              <coneGeometry args={[.095, .24, 10]} /><meshStandardMaterial color="#406b84" />
            </mesh>
          </group>
        })}
        {plant.equipment.map(item => {
          const { position_m, rotation_deg, dimensions_m } = item.geometry
          const overloaded = overloadedIds.has(item.id)
          const active = selectedId === item.id || item.component_ids.includes(selectedId)
          const color = overloaded ? '#b3473c' : equipmentColors[item.type]
          return <group key={item.id} position={position_m}>
            <group rotation={rotation_deg.map(MathUtils.degToRad) as Vector}>
              <group scale={dimensions_m} onClick={event => { event.stopPropagation(); onSelect(item.id) }}>
                <Machine type={item.type} color={color} />
              </group>
              {item.component_ids.map(id => <InternalPart key={id} item={components.get(id)!}
                selected={id === selectedId} overloaded={overloaded} onSelect={onSelect} />)}
            </group>
            {(active || overloaded) && <mesh position={[0, .016, 0]} rotation={[-Math.PI / 2, 0, 0]}>
              <ringGeometry args={[Math.max(dimensions_m[0], dimensions_m[2]) * .55,
                Math.max(dimensions_m[0], dimensions_m[2]) * .57, 52]} />
              <meshBasicMaterial color={overloaded ? '#b94739' : '#2c7193'} />
            </mesh>}
          </group>
        })}
      </Canvas>
    </SceneBoundary>
    <div className="scene-labels">
      {plant.equipment.map(item => {
        const active = selectedId === item.id || item.component_ids.includes(selectedId)
        const overloaded = overloadedIds.has(item.id)
        return <button key={item.id} ref={node => {
          if (node) labels.current.set(item.id, node)
          else labels.current.delete(item.id)
        }} className={`scene-tag ${active ? 'active' : ''} ${overloaded ? 'overloaded' : ''}`}
          aria-label={`Select ${item.name} in 3D`} aria-pressed={active} onClick={() => onSelect(item.id)}>
          {overloaded && <span aria-hidden="true">! </span>}{item.id}
        </button>
      })}
    </div>
    <button className="reset-view" onClick={() => resetCamera(value => value + 1)}>Reset view</button>
    <div className="view-legend"><span /> Material flow</div>
    <div className="view-help">Drag to orbit · Scroll to zoom</div>
  </div>
}
