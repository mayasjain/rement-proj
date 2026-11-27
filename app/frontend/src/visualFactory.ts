import { Euler, MathUtils, Quaternion, Vector3 } from 'three'
import type { Component, Connection, Equipment, Plant, Vector } from './plant'

export const industrialUrl = '/models/industrial.glb'
export const hopperUrl = '/models/hopper.glb'

export function rotation(item: Equipment): Vector {
  return item.geometry.rotation_deg.map(MathUtils.degToRad) as Vector
}

function attachment(item: Equipment, stream: Connection, input: boolean): Vector {
  switch (item.type) {
    case 'hopper': return [.495, .287, 0]
    case 'crusher': return input ? [-.44, .90, 0] : [.48, .25, 0]
    case 'screen':
      if (input) return [-.49, .81, 0]
      return [.39, stream.material === 'fine_aggregate' ? .50 : .64,
        stream.material === 'fine_aggregate' ? -.33 : .33]
    case 'washer': return input ? [-.47, .72, 0] : [.46, .71, 0]
    case 'conveyor': return input ? [-.46, .69, 0] : [.47, .89, 0]
    case 'storage': return [-.28, .81, 0]
  }
}

// These are render mounts, derived from equipment poses. Engineering owns the topology.
export function worldMount(item: Equipment, stream: Connection, input: boolean): Vector3 {
  return new Vector3(...attachment(item, stream, input))
    .multiply(new Vector3(...item.geometry.dimensions_m))
    .applyEuler(new Euler(...rotation(item)))
    .add(new Vector3(...item.geometry.position_m))
}

export interface RenderLink {
  id: string
  material: string
  start: Vector3
  end: Vector3
  length: number
  quaternion: Quaternion
  width: number
}

export function renderLinks(plant: Plant): RenderLink[] {
  const equipment = new Map(plant.equipment.map(item => [item.id, item]))
  return plant.connections.map(stream => {
    const source = equipment.get(stream.from.equipment_id)!
    const destination = equipment.get(stream.to.equipment_id)!
    const start = worldMount(source, stream, false)
    const end = worldMount(destination, stream, true)
    const width = MathUtils.clamp(Math.min(source.geometry.dimensions_m[2], destination.geometry.dimensions_m[2]) * .34, .32, .76)
    return renderLink(stream.id, stream.material, start, end, width)
  }).filter(link => link.length > .05)
}

function renderLink(id: string, material: string, start: Vector3, end: Vector3, width: number): RenderLink {
  const length = start.distanceTo(end)
  const direction = end.clone().sub(start).normalize()
  const yaw = Math.atan2(-direction.z, direction.x)
  const pitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z))
  const quaternion = new Quaternion().setFromEuler(new Euler(0, yaw, pitch, 'YXZ'))
  return { id, material, start, end, length, quaternion, width }
}

export function conveyorRuns(plant: Plant): RenderLink[] {
  return plant.equipment.filter(item => item.type === 'conveyor').map(item => {
    const inlet = plant.connections.find(stream => stream.to.equipment_id === item.id)!
    const outlet = plant.connections.find(stream => stream.from.equipment_id === item.id)!
    return renderLink('equipment:' + item.id, outlet.material,
      worldMount(item, inlet, true), worldMount(item, outlet, false), item.geometry.dimensions_m[2] * .61)
  }).filter(link => link.length > .05)
}

export function assetName(item: Equipment): string {
  if (item.type === 'storage') {
    return item.ports.some(port => port.material === 'sand') ? 'sand_storage' : 'gravel_storage'
  }
  return item.type === 'crusher' ? 'jaw_crusher' : item.type
}

export function assemblyPosition(item: Component, exploded: boolean): Vector {
  const position = item.geometry.local_position_m
  if (!exploded) return position
  const offset: Record<string, Vector> = {
    motor: [1.05, .40, .72], jaw: [-.5, 1.22, .62], frame: [0, .22, 1.54],
  }
  return position.map((value, axis) => value + (offset[item.geometry.model_key]?.[axis] ?? 0)) as Vector
}
