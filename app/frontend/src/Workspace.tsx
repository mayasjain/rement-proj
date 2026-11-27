import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { PlantScene } from './PlantScene'
import { number, requestPlant, type PlantView } from './plant'

function Header({ onReload, busy }: { onReload?: () => void; busy: boolean }) {
  return <header className="topbar">
    <div className="brand"><div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
      <div><strong>Plant-as-Code</strong><span>Engineering workspace</span></div>
    </div>
    {onReload && <div className="top-actions">
      <span className="preview-label"><i /> Read-only preview</span>
      <button className="button secondary" disabled={busy} onClick={onReload}>Reload baseline</button>
    </div>}
  </header>
}

function Value({ label, value }: { label: string; value: ReactNode }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>
}

function Inspection({ view, selectedId }: { view: PlantView; selectedId: string }) {
  const { plant, result } = view
  const component = plant.components.find(item => item.id === selectedId)
  const selected = plant.equipment.find(item => item.id === selectedId || item.component_ids.includes(selectedId))
  if (!selected) return null
  const geometry = component?.geometry ?? selected.geometry
  const flow = result.equipment[selected.id]
  const ports = selected.ports
  return <aside className="panel inspect" aria-label="Selection inspector">
    <div className="panel-heading"><h2>Inspector</h2></div>
    <div className="inspector-content">
      <span className="asset-id">{selectedId}</span>
      <h3>{component?.name ?? selected.name}</h3>
      {component && <p className="muted parent-name">Component of {selected.name}</p>}
      <h4>Specifications</h4>
      <dl>
        {!component && <Value label="Rated capacity" value={flow.capacity_tph === null ? 'Output sink' : `${number.format(flow.capacity_tph)} t/h`} />}
        {(!component || component.specifications.rated_power_kw !== null) &&
          <Value label="Rated power" value={`${number.format(component?.specifications.rated_power_kw ?? selected.specifications.rated_power_kw)} kW`} />}
        <Value label="Dimensions" value={`${geometry.dimensions_m.map(value => number.format(value)).join(' × ')} m`} />
      </dl>
      {!component && <>
        <h4>Solids throughput</h4>
        <dl>
          <Value label="Required" value={`${number.format(flow.required_tph)} t/h`} />
          <Value label="Achievable" value={`${number.format(flow.achievable_tph)} t/h`} />
          <Value label="Utilization" value={flow.utilization === null ? '—' : <span className={flow.utilization > 1 + 1e-12 ? 'warning-text' : ''}>
            {number.format(flow.utilization * 100)}%</span>} />
        </dl>
        {ports.length > 0 && <>
          <h4>Material ports</h4>
          <ul className="ports">{ports.map(port => <li key={port.id}>
            <span className="port-direction">{port.direction === 'input' ? 'In' : 'Out'}</span>
            {port.material.replaceAll('_', ' ')}
          </li>)}</ul>
        </>}
      </>}
    </div>
  </aside>
}

function Scenario({ baseline, view, onSimulate, busy }: {
  baseline: PlantView; view: PlantView; onSimulate: (feed: number, id: string, rating: number) => void; busy: boolean
}) {
  const crusher = view.plant.equipment.find(item => item.type === 'crusher')!
  const evaluatedRating = crusher.specifications.max_solids_throughput_tph!
  const result = view.result
  const [feed, setFeed] = useState(String(result.requested_feed_tph))
  const [rating, setRating] = useState(String(evaluatedRating))
  const invalidRating = rating !== '' && Number(rating) <= 0
  const dirty = feed === '' || rating === '' || Number(feed) !== result.requested_feed_tph || Number(rating) !== evaluatedRating
  const feasible = result.findings.length === 0
  const worst = view.plant.equipment.find(item => item.id === result.limiting_equipment_ids[0])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (invalidRating) return
    onSimulate(Number(feed), crusher.id, Number(rating))
  }
  return <section className="panel scenario" aria-labelledby="scenario-heading">
    <div className="panel-heading">
      <h2 id="scenario-heading">Production scenario</h2>
      <span className={`status ${feasible ? 'good' : 'bad'}`} role="status">
        {dirty && !busy ? 'Inputs changed' : busy ? 'Evaluating…' : feasible ? 'Feasible' : 'Target exceeds capacity'}
      </span>
    </div>
    <div className="scenario-content">
      <form className="scenario-form" onSubmit={submit}>
        <label>Requested feed <span className="number-input"><input type="number" required min="0" step="any"
          value={feed} disabled={busy} onChange={event => setFeed(event.target.value)} /><span>t/h</span></span></label>
        <label>Crusher capacity <span className="number-input"><input type="number" required min="0" step="any"
          aria-invalid={invalidRating} value={rating} disabled={busy}
          onChange={event => setRating(event.target.value)} /><span>t/h</span></span></label>
        <button className="button primary" disabled={busy || invalidRating} type="submit">Evaluate</button>
        <div className="presets">
          <button className="text-button" disabled={busy || rating === '' || Number(rating) <= 0} type="button" onClick={() => {
            const target = Number((baseline.result.requested_feed_tph * 1.2).toPrecision(12))
            setFeed(String(target))
            onSimulate(target, crusher.id, Number(rating))
          }}>+20% feed</button>
          <button className="text-button" disabled={busy || feed === '' || Number(feed) < 0} type="button"
            onClick={() => { setRating('15'); onSimulate(Number(feed), crusher.id, 15) }}>Try 15 t/h crusher</button>
          <span>{number.format(view.plant.requirements.screen_fine_fraction * 100)}% fine split</span>
          {invalidRating && <span className="warning-text">Enter a capacity greater than zero.</span>}
        </div>
      </form>
      <div className="metrics" aria-label={dirty ? 'Last evaluated results' : 'Evaluated results'}>
        {[['Requested', result.requested_feed_tph], ['Achievable', result.achievable_feed_tph],
          ['Sand', result.sand_output_tph], ['Gravel', result.gravel_output_tph]].map(([label, value]) =>
          <div className="metric" key={label}><span>{label}</span><strong>{number.format(Number(value))}</strong>{' '}<small>t/h</small></div>)}
      </div>
      {result.findings.length ? <ul className="findings" aria-label="Engineering findings">
        {result.findings.map(finding => <li key={`${finding.rule_id}-${finding.equipment_ids.join('-')}`}>
          <b aria-hidden="true">!</b> {finding.explanation}
        </li>)}</ul> : <p className="headroom">
        Maximum feasible feed <strong>{number.format(result.maximum_feasible_feed_tph)} t/h</strong>{worst && ` · Limited by ${worst.name}`}
      </p>}
    </div>
  </section>
}

export function Workspace() {
  const [baseline, setBaseline] = useState<PlantView>()
  const [view, setView] = useState<PlantView>()
  const [selected, select] = useState('')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState('')
  const [scenarioVersion, setScenarioVersion] = useState(0)

  async function load(signal?: AbortSignal) {
    setBusy(true)
    setError('')
    try {
      const next = await requestPlant(undefined, signal)
      setBaseline(next)
      setView(next)
      select(next.plant.equipment.find(item => item.type === 'crusher')!.id)
      setScenarioVersion(version => version + 1)
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the plant.')
    } finally {
      if (!signal?.aborted) setBusy(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [])

  async function simulate(feed: number, id: string, rating: number) {
    setBusy(true)
    setError('')
    try {
      const next = await requestPlant({ requested_feed_tph: feed, equipment_capacities_tph: { [id]: rating } })
      setView(next)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not evaluate the scenario.')
    } finally {
      setBusy(false)
    }
  }

  if (!baseline || !view) return <>
    <Header busy={busy} />
    <main className="loading" aria-live="polite">
      {error ? <><h1>Could not load the plant</h1><p role="alert">{error}</p>
        <button className="button primary" onClick={() => void load()} disabled={busy}>Retry</button></>
        : <p>Loading plant…</p>}
    </main>
  </>

  const { plant, result } = view
  const overloaded = new Set(result.findings.filter(finding => finding.rule_id === 'equipment_overload')
    .flatMap(finding => finding.equipment_ids))
  const components = new Map(plant.components.map(item => [item.id, item]))
  // Use the YAML connection order for the equipment list, beginning at the hopper.
  const processIds = Array.from(new Set(plant.connections.flatMap(stream => [stream.from.equipment_id, stream.to.equipment_id])))
  const equipment = new Map(plant.equipment.map(item => [item.id, item]))

  return <>
    <Header busy={busy} onReload={() => void load()} />
    <main>
      <div className="page-title">
        <h1>{plant.factory.name}</h1>
        <p>Invented equipment specifications · Dry solids only · Washer modeled as a pass-through</p>
      </div>
      {error && <div className="api-error" role="alert">{error}</div>}
      <div className="workbench">
        <nav className="panel equipment" aria-label="Equipment list">
          <div className="panel-heading"><h2>Equipment</h2><span className="count">{plant.equipment.length}</span></div>
          <ul className="equipment-list">{processIds.map(id => {
            const item = equipment.get(id)!
            return <li key={id}>
              <button aria-pressed={selected === id} className={`asset-button ${selected === id ? 'selected' : ''}`}
                onClick={() => select(id)}>
                <span className="asset-symbol" aria-hidden="true">◇</span>
                <span><strong>{item.name}</strong><small>{id}</small></span>
                {overloaded.has(id) && <span className="asset-warning" aria-label="Overloaded">!</span>}
              </button>
              {item.component_ids.length > 0 && <ul className="component-list">{item.component_ids.map(componentId =>
                <li key={componentId}><button className={selected === componentId ? 'selected' : ''}
                  aria-pressed={selected === componentId} onClick={() => select(componentId)}>
                  {components.get(componentId)!.name}
                </button></li>)}</ul>}
            </li>
          })}</ul>
        </nav>
        <section className="panel scene-panel" aria-label="3D plant layout">
          <div className="panel-heading"><h2>Plant layout</h2><span className="count">{plant.connections.length} material streams</span></div>
          <PlantScene plant={plant} selectedId={selected} overloadedIds={overloaded} onSelect={select} />
        </section>
        <Inspection view={view} selectedId={selected} />
      </div>
      <Scenario key={scenarioVersion} baseline={baseline} view={view} onSimulate={simulate} busy={busy} />
    </main>
  </>
}
