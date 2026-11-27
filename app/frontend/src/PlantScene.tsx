import { Component as Boundary, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Color, Euler, Group, Mesh, MeshStandardMaterial, Object3D, OrthographicCamera, Vector3 } from 'three'
import { BeltMaterial, TransferSupports } from './TransferBelts'
import { assemblyPosition, assetName, conveyorRuns, hopperUrl, industrialUrl, renderLinks, rotation } from './visualFactory'
import type { Component, Equipment, Plant, Throughput, Vector } from './plant'

function Asset({ source, highlight = 'none', centerOnGround = false }: {
  source: Object3D; highlight?: 'overload' | 'part' | 'none'; centerOnGround?: boolean
}) {
  const { instance, surfaces } = useMemo(() => {
    const clone = source.clone(true)
    const surfaces: { material: MeshStandardMaterial; original: Color; intensity: number }[] = []
    clone.traverse(object => {
      if (!(object instanceof Mesh)) return
      object.castShadow = object.receiveShadow = true
      const prepare = (material: MeshStandardMaterial) => {
        const copy = material.clone()
        surfaces.push({ material: copy, original: copy.emissive.clone(), intensity: copy.emissiveIntensity })
        return copy
      }
      object.material = Array.isArray(object.material) ? object.material.map(prepare) : prepare(object.material)
    })
    const root = new Group()
    root.add(clone)
    if (centerOnGround) {
      const box = new Box3().setFromObject(clone)
      const center = box.getCenter(new Vector3())
      clone.position.sub(center.setY(box.min.y))
      root.scale.set(1, 1, 1).divide(box.getSize(new Vector3()))
    }
    return { instance: root, surfaces }
  }, [source, centerOnGround])

  const { invalidate } = useThree()
  useLayoutEffect(() => {
    for (const { material, original, intensity } of surfaces) {
      if (highlight === 'none') {
        material.emissive.copy(original)
        material.emissiveIntensity = intensity
      } else {
        material.emissive.set(highlight === 'overload' ? '#cf4427' : '#f1aa40')
        material.emissiveIntensity = highlight === 'overload' ? .53 : .32
      }
    }
    invalidate()
  }, [surfaces, highlight, invalidate])
  useEffect(() => () => surfaces.forEach(({ material }) => material.dispose()), [surfaces])
  return <primitive object={instance} />
}

function ViewCamera({ center, span, assembly }: { center: Vector; span: number; assembly?: Equipment }) {
  const { camera, size } = useThree()
  const [x, y, z] = assembly
    ? [assembly.geometry.position_m[0], assembly.geometry.position_m[1] + 1.57, assembly.geometry.position_m[2] + .57]
    : center
  const distance = assembly ? Math.max(6.5, ...assembly.geometry.dimensions_m.map(value => value * 1.6)) : span
  useLayoutEffect(() => {
    if (!(camera instanceof OrthographicCamera)) return
    camera.position.set(x + distance * .66, y + distance * .78, z + distance * 1.46)
    camera.zoom = Math.min(size.width / (distance * 1.05), size.height / (distance * .69))
    camera.lookAt(x, y, z)
    camera.updateProjectionMatrix()
  }, [camera, x, y, z, distance, size.width, size.height])
  const target = useMemo<Vector>(() => [x, y, z], [x, y, z])
  return <OrbitControls target={target} makeDefault minPolarAngle={.12} maxPolarAngle={Math.PI / 2.02}
    minZoom={1} maxZoom={320} enableDamping={false} />
}

interface LabelAnchor { id: string; label: string; point: Vector3 }

function ProjectLabels({ anchors, labels }: { anchors: LabelAnchor[]; labels: Map<string, HTMLButtonElement> }) {
  const point = useMemo(() => new Vector3(), [])
  useFrame(({ camera, size }) => {
    camera.updateMatrixWorld()
    for (const anchor of anchors) {
      const label = labels.get(anchor.id)
      if (!label) continue
      point.copy(anchor.point).project(camera)
      const visibility = Math.abs(point.x) <= 1 && Math.abs(point.y) <= 1 && Math.abs(point.z) <= 1
        ? 'visible' : 'hidden'
      const transform = 'translate(' + ((point.x + 1) * size.width / 2) + 'px, '
        + ((1 - point.y) * size.height / 2) + 'px) translate(-50%, -50%)'
      if (label.style.visibility !== visibility) label.style.visibility = visibility
      if (label.style.transform !== transform) label.style.transform = transform
    }
  })
  return null
}

function PlantYard({ center, span }: { center: Vector; span: number }) {
  return <>
    <mesh position={[center[0], -.14, center[2]]} receiveShadow>
      <boxGeometry args={[span * 1.24, .25, span * .62]} />
      <meshStandardMaterial color="#a8aaa3" roughness={.94} />
    </mesh>
    <mesh position={[center[0], -.29, center[2]]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[span * 4, span * 4]} />
      <meshStandardMaterial color="#7d898b" roughness={1} />
    </mesh>
    {[-.28, .28].map(z => <mesh key={z} position={[center[0], -.006, center[2] + z * span]}
      rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[span * 1.14, .045]} />
      <meshStandardMaterial color="#c9a54e" roughness={.91} />
    </mesh>)}
    {[-.36, -.18, 0, .18, .36].map(x => <mesh key={x} position={[center[0] + x * span, -.008, center[2]]}
      rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[.019, span * .61]} />
      <meshStandardMaterial color="#828680" roughness={1} />
    </mesh>)}
  </>
}

function EquipmentMeshes({ plant, result, selectedId, exploded, overloadedIds, playing, onSelect }: {
  plant: Plant; result: Throughput; selectedId: string; exploded?: Equipment
  overloadedIds: Set<string>; playing: boolean; onSelect: (id: string) => void
}) {
  const industrial = useGLTF(industrialUrl)
  const hopper = useGLTF(hopperUrl)
  const components = useMemo(() => new Map(plant.components.map(item => [item.id, item])), [plant.components])
  const links = useMemo(() => renderLinks(plant), [plant])
  const materialPaths = useMemo(() => [...links, ...conveyorRuns(plant)], [links, plant])
  const achieved = useMemo(() => Object.fromEntries([
    ...Object.entries(result.streams).map(([id, flow]) => [id, flow.achievable_tph]),
    ...Object.entries(result.equipment).map(([id, flow]) => ['equipment:' + id, flow.achievable_tph]),
  ]), [result.streams, result.equipment])
  const { gl, invalidate } = useThree()
  useLayoutEffect(() => {
    gl.shadowMap.autoUpdate = false
    gl.shadowMap.needsUpdate = true
    invalidate()
  }, [gl, invalidate, plant, exploded?.id])

  return <>
    {!exploded && links.map(link => <group key={link.id} position={link.start.clone().lerp(link.end, .5)} quaternion={link.quaternion}>
      <group position={[0, -.32, 0]} scale={[link.length, .34, link.width]}>
        <Asset source={industrial.nodes.transfer} />
      </group>
    </group>)}
    {!exploded && <TransferSupports links={links} />}
    {!exploded && <BeltMaterial links={materialPaths} achieved={achieved} playing={playing} />}
    {(exploded ? [exploded] : plant.equipment).map(item => {
      const { position_m, dimensions_m } = item.geometry
      const overloaded = overloadedIds.has(item.id)
      const active = selectedId === item.id || item.component_ids.includes(selectedId)
      const source = item.type === 'hopper' ? hopper.scene : industrial.nodes[assetName(item)]
      return <group key={item.id} position={position_m}>
        <group rotation={rotation(item)}>
          <group scale={dimensions_m} onClick={event => { event.stopPropagation(); onSelect(item.id) }}>
            <Asset source={source} highlight={overloaded ? 'overload' : 'none'} centerOnGround={item.type === 'hopper'} />
          </group>
          {item.component_ids.map(id => {
            const component: Component = components.get(id)!
            const model = industrial.nodes[component.geometry.model_key]
            return <group key={id} position={assemblyPosition(component, exploded?.id === item.id)}
              scale={component.geometry.dimensions_m}
              onClick={event => { event.stopPropagation(); onSelect(id) }}>
              {model ? <Asset source={model} highlight={id === selectedId ? 'part' : 'none'} /> :
                <mesh><boxGeometry /><meshStandardMaterial color="#8c989e" wireframe /></mesh>}
            </group>
          })}
        </group>
        {(active || overloaded) && <mesh position={[0, .007, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[Math.hypot(dimensions_m[0], dimensions_m[2]) * .475,
            Math.hypot(dimensions_m[0], dimensions_m[2]) * .495, 48]} />
          <meshBasicMaterial color={overloaded ? '#ce5239' : '#318494'} />
        </mesh>}
      </group>
    })}
  </>
}

class SceneBoundary extends Boundary<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <SceneUnavailable /> : this.props.children }
}

function SceneUnavailable() {
  return <div className="scene-unavailable">The 3D scene could not load. You can inspect the plant from the equipment list.</div>
}

export function PlantScene({ plant, result, selectedId, overloadedIds, onSelect }: {
  plant: Plant; result: Throughput; selectedId: string; overloadedIds: Set<string>; onSelect: (id: string) => void
}) {
  const [cameraReset, resetCamera] = useState(0)
  const [explodedId, setExplodedId] = useState('')
  const [playing, setPlaying] = useState(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const labels = useRef(new Map<string, HTMLButtonElement>())
  const assembly = plant.equipment.find(item => item.component_ids.length &&
    (item.id === selectedId || item.component_ids.includes(selectedId)))
  const exploded = assembly?.id === explodedId ? assembly : undefined
  const anchors = useMemo<LabelAnchor[]>(() => {
    if (exploded) {
      return plant.components.filter(item => exploded.component_ids.includes(item.id)).map(item => ({
        id: item.id,
        label: item.name,
        point: new Vector3(...assemblyPosition(item, true)).applyEuler(new Euler(...rotation(exploded)))
          .add(new Vector3(...exploded.geometry.position_m)).add(new Vector3(0, item.geometry.dimensions_m[1] * .5 + .16, 0)),
      }))
    }
    return plant.equipment.map(item => ({
      id: item.id, label: item.name,
      point: new Vector3(...item.geometry.position_m).add(new Vector3(0, item.geometry.dimensions_m[1] + .4, 0)),
    }))
  }, [plant, exploded])
  const layout = useMemo(() => {
    const xs = plant.equipment.map(item => item.geometry.position_m[0])
    const zs = plant.equipment.map(item => item.geometry.position_m[2])
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minZ = Math.min(...zs), maxZ = Math.max(...zs)
    const center: Vector = [(minX + maxX) / 2, .45, (minZ + maxZ) / 2]
    return { center, span: Math.max(maxX - minX, maxZ - minZ, 8) + 4.6 }
  }, [plant.equipment])

  return <div className="viewport industrial-viewport">
    <SceneBoundary key={cameraReset}>
      <Canvas orthographic frameloop="demand" shadows="percentage" dpr={[1, 1.25]}
        gl={{ powerPreference: 'high-performance', antialias: true }} camera={{ near: .1, far: 350 }}
        fallback={<SceneUnavailable />}>
        <color attach="background" args={['#829198']} />
        <ViewCamera {...layout} assembly={exploded} />
        <ProjectLabels anchors={anchors} labels={labels.current} />
        <hemisphereLight args={['#eaf4ff', '#968878', 2.05]} />
        <directionalLight position={[layout.center[0] - 10, 14, 8]} intensity={2.65} castShadow
          target-position={[layout.center[0], 0, layout.center[2]]} shadow-mapSize={[1024, 1024]}
          shadow-camera-left={-layout.span * .65} shadow-camera-right={layout.span * .65}
          shadow-camera-top={layout.span * .65} shadow-camera-bottom={-layout.span * .65}
          shadow-camera-far={layout.span * 3} shadow-normalBias={.024} shadow-bias={-.00015} />
        <PlantYard {...layout} />
        <Suspense fallback={null}>
          <EquipmentMeshes plant={plant} result={result} exploded={exploded} selectedId={selectedId}
            overloadedIds={overloadedIds} playing={playing} onSelect={onSelect} />
        </Suspense>
      </Canvas>
    </SceneBoundary>
    <div className="scene-labels">
      {anchors.map(anchor => {
        const active = selectedId === anchor.id || (!exploded && assembly?.id === anchor.id)
        const overloaded = overloadedIds.has(anchor.id)
        return <button key={anchor.id} ref={node => {
          if (node) labels.current.set(anchor.id, node)
          else labels.current.delete(anchor.id)
        }} className={'scene-tag ' + (active ? 'active ' : '') + (overloaded ? 'overloaded' : '')}
          aria-label={'Select ' + anchor.label + ' in 3D'} aria-pressed={active} onClick={() => onSelect(anchor.id)}>
          {overloaded && <span aria-hidden="true">! </span>}{exploded ? anchor.label : anchor.id}
        </button>
      })}
    </div>
    <div className="scene-tools">
      {!exploded && <button aria-pressed={playing} onClick={() => setPlaying(value => !value)}>{playing ? 'Pause flow' : 'Play flow'}</button>}
      {assembly && <button aria-pressed={!!exploded} onClick={() => setExplodedId(exploded ? '' : assembly.id)}>
        {exploded ? 'Reassemble' : 'Explode assembly'}
      </button>}
      <button onClick={() => { setExplodedId(''); resetCamera(value => value + 1) }}>Reset view</button>
    </div>
    {!exploded && <div className="view-legend" title="The motion and density indicate achievable flow. Belt speed and particle sizes are illustrative.">
      <span /> Achievable material flow
    </div>}
    <div className="view-help">{exploded ? 'Select a separated component' : 'Drag to orbit · Scroll to zoom'}</div>
  </div>
}
