import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { Vector3 } from 'three'
import { assemblyPosition, assetName, conveyorRuns, renderLinks, worldMount } from '../src/visualFactory.ts'

function equipment(id, type, position_m, rotation_deg = [0, 0, 0], dimensions_m = [2, 2, 2]) {
  return { id, type, geometry: { position_m, rotation_deg, dimensions_m }, ports: [] }
}
const source = equipment('not-the-fixture-hopper-id', 'hopper', [2, .4, 4], [0, 90, 0])
const belt = equipment('not-the-fixture-belt-id', 'conveyor', [7, 0, 1], [0, -20, 0], [4, 1.2, 1.3])
const sink = equipment('custom-sink-id', 'storage', [13, 0, 1])
const inlet = { id: 'a', material: 'coarse_aggregate', from: { equipment_id: source.id }, to: { equipment_id: belt.id } }
const outlet = { id: 'b', material: 'gravel', from: { equipment_id: belt.id }, to: { equipment_id: sink.id } }
const plant = { equipment: [source, belt, sink], connections: [inlet, outlet] }

test('port projections follow machine scale and yaw in meters', () => {
  const point = worldMount(source, inlet, false)
  assert.ok(point.distanceTo(new Vector3(2, .974, 3.01)) < 1e-12)
  for (const link of renderLinks(plant)) {
    const span = new Vector3(link.length, 0, 0).applyQuaternion(link.quaternion)
    assert.ok(link.start.clone().add(span).distanceTo(link.end) < 1e-12)
  }
})

test('transfer endpoints coincide with the internal belt flow path', () => {
  const [incoming, outgoing] = renderLinks(plant)
  const [internal] = conveyorRuns(plant)
  assert.equal(internal.id, 'equipment:' + belt.id)
  assert.ok(internal.start.equals(incoming.end))
  assert.ok(internal.end.equals(outgoing.start))
})

test('asset mapping follows the equipment role and explosion offsets preserve original coordinates', () => {
  assert.equal(assetName({ ...sink, ports: [{ material: 'sand' }] }), 'sand_storage')
  const motor = { geometry: { model_key: 'motor', local_position_m: [.8, .6, 0] } }
  assert.deepEqual(assemblyPosition(motor, false), [.8, .6, 0])
  assert.notDeepEqual(assemblyPosition(motor, true), motor.geometry.local_position_m)
  assert.deepEqual(motor.geometry.local_position_m, [.8, .6, 0])
})

test('bundled GLBs fit the download budget and contain required parts', async () => {
  const assets = [
    ['industrial.glb', ['jaw_crusher', 'motor', 'jaw', 'frame', 'screen', 'washer', 'conveyor', 'transfer', 'sand_storage', 'gravel_storage']],
    ['hopper.glb', ['Hopper', 'Belt', 'Structure']],
  ]
  let bytes = 0
  for (const [file, expectedNames] of assets) {
    const asset = await readFile(new URL('../public/models/' + file, import.meta.url))
    bytes += asset.length
    assert.equal(asset.toString('ascii', 0, 4), 'glTF')
    assert.equal(asset.readUInt32LE(4), 2)
    assert.equal(asset.readUInt32LE(8), asset.length)
    const metadata = JSON.parse(asset.subarray(20, 20 + asset.readUInt32LE(12)))
    const names = new Set(metadata.nodes.map(node => node.name))
    assert.ok(expectedNames.every(name => names.has(name)), file)
  }
  assert.ok(bytes < 1_300_000)
})
