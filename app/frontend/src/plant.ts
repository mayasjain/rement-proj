export type Vector = [number, number, number]
export type EquipmentType = 'hopper' | 'crusher' | 'screen' | 'washer' | 'conveyor' | 'storage'

export interface Equipment {
  id: string
  name: string
  type: EquipmentType
  specifications: { max_solids_throughput_tph: number | null; rated_power_kw: number }
  ports: { id: string; direction: 'input' | 'output'; material: string }[]
  component_ids: string[]
  geometry: { model_key: string; position_m: Vector; rotation_deg: Vector; dimensions_m: Vector }
}

export interface Component {
  id: string
  name: string
  type: string
  specifications: { rated_power_kw: number | null }
  geometry: { model_key: string; local_position_m: Vector; dimensions_m: Vector }
}

export interface Connection {
  id: string
  from: { equipment_id: string; port_id: string }
  to: { equipment_id: string; port_id: string }
  material: string
}

export interface Plant {
  factory: { name: string }
  requirements: { requested_feed_tph: number; screen_fine_fraction: number }
  equipment: Equipment[]
  components: Component[]
  connections: Connection[]
}

export interface Flow {
  required_tph: number
  achievable_tph: number
}

export interface Throughput {
  requested_feed_tph: number
  maximum_feasible_feed_tph: number
  achievable_feed_tph: number
  sand_output_tph: number
  gravel_output_tph: number
  limiting_equipment_ids: string[]
  equipment: Record<string, Flow & { capacity_tph: number | null; utilization: number | null }>
  streams: Record<string, Flow>
  findings: { rule_id: string; equipment_ids: string[]; explanation: string }[]
}

export interface PlantView {
  plant: Plant
  result: Throughput
  revision?: string | null
  git_dirty?: boolean | null
}

export interface ScenarioDraft {
  requested_feed_tph: number
  equipment_capacities_tph: Record<string, number>
}

export interface DesignDraft {
  requirements: Plant['requirements']
  equipment: Record<string, Omit<Equipment['geometry'], 'model_key'> & {
    specifications: Equipment['specifications']
  }>
}

export async function requestPlant(
  draft?: DesignDraft | ScenarioDraft, signal?: AbortSignal, expectedRevision?: string,
): Promise<PlantView> {
  const response = await fetch(draft && !expectedRevision ? '/api/plant/simulate' : '/api/plant', {
    signal,
    cache: 'no-store',
    ...(draft && {
      method: expectedRevision ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(expectedRevision ? { ...draft, expected_revision: expectedRevision } : draft),
    }),
  })
  if (!response.ok) {
    const failure = await response.json().catch(() => null)
    const detail = failure?.detail
    if (typeof detail === 'string') throw new Error(detail)
    if (Array.isArray(detail)) throw new Error(detail.map(issue => `${issue.loc.slice(1).join(' · ')}: ${issue.msg}`).join(' '))
    throw new Error('The local plant service is unavailable. Check that FastAPI is running.')
  }
  return response.json()
}

export const number = new Intl.NumberFormat('en', { maximumFractionDigits: 3 })
