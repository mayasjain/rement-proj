import type { DesignDraft, Equipment, Plant, Vector } from './plant'

export type Inputs = Record<string, string>
export const axes = ['X', 'Y', 'Z']
export const geometryFields = [
  { key: 'position_m', label: 'Position', unit: 'm', positive: false },
  { key: 'rotation_deg', label: 'Rotation', unit: '°', positive: false },
  { key: 'dimensions_m', label: 'Dimensions', unit: 'm', positive: true },
] as const

export function inputsFromPlant(plant: Plant): Inputs {
  const inputs: Inputs = {
    feed: String(plant.requirements.requested_feed_tph),
    fine: String(plant.requirements.screen_fine_fraction),
  }
  for (const item of plant.equipment) {
    const { rated_power_kw, max_solids_throughput_tph } = item.specifications
    inputs[`${item.id}.power`] = String(rated_power_kw)
    if (max_solids_throughput_tph !== null) inputs[`${item.id}.capacity`] = String(max_solids_throughput_tph)
    for (const { key } of geometryFields) {
      item.geometry[key].forEach((value, axis) => { inputs[`${item.id}.${key}.${axis}`] = String(value) })
    }
  }
  return inputs
}

export function makeDesign(plant: Plant, inputs: Inputs): DesignDraft {
  function read(key: string, label: string, condition = (_: number) => true, hint = '') {
    const value = Number(inputs[key])
    if (!inputs[key]?.trim() || !Number.isFinite(value) || !condition(value)) {
      throw new Error(`Enter a valid value for ${label}${hint}.`)
    }
    return value
  }
  const equipment: DesignDraft['equipment'] = {}
  function vector(item: Equipment, field: typeof geometryFields[number]): Vector {
    const { key, label, positive } = field
    return [0, 1, 2].map(axis => read(`${item.id}.${key}.${axis}`,
      `${item.name} ${label.toLowerCase()} ${axes[axis]}`, value => !positive || value > 0,
      positive ? ' greater than zero' : '')) as Vector
  }
  for (const item of plant.equipment) {
    equipment[item.id] = {
      specifications: {
        rated_power_kw: read(`${item.id}.power`, `${item.name} rated power`, value => value >= 0, ' of zero or more'),
        max_solids_throughput_tph: item.specifications.max_solids_throughput_tph === null ? null :
          read(`${item.id}.capacity`, `${item.name} capacity`, value => value > 0, ' greater than zero'),
      },
      position_m: vector(item, geometryFields[0]),
      rotation_deg: vector(item, geometryFields[1]),
      dimensions_m: vector(item, geometryFields[2]),
    }
  }
  return {
    requirements: {
      requested_feed_tph: read('feed', 'requested feed', value => value >= 0, ' of zero or more'),
      screen_fine_fraction: read('fine', 'fine fraction', value => value >= 0 && value <= 1, ' from 0 to 1'),
    },
    equipment,
  }
}
