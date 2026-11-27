import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { PlantScene } from './PlantScene'
import { VersionControl, type GitAction } from './VersionControl'
import { axes, geometryFields, inputsFromPlant, makeDesign, type Inputs } from './draft'
import { number, requestJson, requestPlant, type PlantView } from './plant'

type Action = 'load' | 'evaluate' | 'save' | 'git'

function Header({ onReload, onSave, busy, state, canSave, hasHistory }: {
  onReload?: () => void; onSave?: () => void; busy: boolean; state?: string; canSave?: boolean; hasHistory?: boolean
}) {
  return <header className="topbar">
    <div className="brand"><div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
      <div><strong>Plant-as-Code</strong><span>Engineering workspace</span></div>
    </div>
    {onReload && <div className="top-actions">
      <span className="preview-label" role="status"><i /> {state ?? 'Read-only preview'}</span>
      {hasHistory && <a className="button secondary history-link" href="#plant-history">History</a>}
      <button className="button secondary" disabled={busy} onClick={onReload}>{onSave ? 'Reload' : 'Reload baseline'}</button>
      {onSave && <button className="button save-button" disabled={busy || !canSave} onClick={onSave}>Save</button>}
    </div>}
  </header>
}

function Value({ label, value }: { label: string; value: ReactNode }) {
  return <div className="detail-row"><dt>{label}</dt><dd>{value}</dd></div>
}

function Inspection({ view, selectedId, inputs, onChange, busy }: {
  view: PlantView; selectedId: string; inputs: Inputs; onChange?: (key: string, value: string) => void; busy: boolean
}) {
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
      {!component && onChange && <details className="edit-equipment" key={selected.id}>
        <summary>Edit specifications and geometry</summary>
        {flow.capacity_tph !== null && <label className="inspector-input">Rated capacity (t/h)
          <input type="number" step="any" disabled={busy}
            value={inputs[`${selected.id}.capacity`]} onChange={event => onChange(`${selected.id}.capacity`, event.target.value)} />
        </label>}
        <label className="inspector-input">Rated power (kW)
          <input type="number" step="any" disabled={busy}
            value={inputs[`${selected.id}.power`]} onChange={event => onChange(`${selected.id}.power`, event.target.value)} />
        </label>
        {geometryFields.map(({ key, label, unit }) => <fieldset className="geometry-fields" key={key}>
          <legend>{label} ({unit})</legend>
          {axes.map((axis, index) => {
            const field = `${selected.id}.${key}.${index}`
            return <label key={axis}>{axis}
              <input type="number" step="any" disabled={busy} aria-label={`${label} ${axis}`}
                value={inputs[field]} onChange={event => onChange(field, event.target.value)} />
            </label>
          })}
        </fieldset>)}
      </details>}
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

function Scenario({ baseline, view, inputs, onChange, onSimulate, action }: {
  baseline: PlantView; view: PlantView; inputs: Inputs; onChange: (key: string, value: string) => void
  onSimulate: (inputs: Inputs) => void; action: Action | null
}) {
  const crusher = view.plant.equipment.find(item => item.type === 'crusher')!
  const capacityKey = `${crusher.id}.capacity`
  const result = view.result
  const feed = inputs.feed
  const rating = inputs[capacityKey]
  const busy = action !== null
  const invalidRating = rating !== '' && Number(rating) <= 0
  const dirty = JSON.stringify(inputs) !== JSON.stringify(inputsFromPlant(view.plant))
  const feasible = result.findings.length === 0
  const worst = view.plant.equipment.find(item => item.id === result.limiting_equipment_ids[0])
  function submit(event: FormEvent) {
    event.preventDefault()
    if (invalidRating) return
    onSimulate(inputs)
  }
  return <section className="panel scenario" aria-labelledby="scenario-heading">
    <div className="panel-heading">
      <h2 id="scenario-heading">Production scenario</h2>
      <span className={`status ${feasible ? 'good' : 'bad'}`} role="status">
        {action === 'evaluate' ? 'Evaluating…' : dirty ? 'Inputs changed' : feasible ? 'Feasible' : 'Target exceeds capacity'}
      </span>
    </div>
    <div className="scenario-content">
      <form className={`scenario-form ${baseline.revision ? 'editable-scenario' : ''}`} onSubmit={submit}>
        <label>Requested feed <span className="number-input"><input type="number" required min="0" step="any"
          value={feed} disabled={busy} onChange={event => onChange('feed', event.target.value)} /><span>t/h</span></span></label>
        <label>Crusher capacity <span className="number-input"><input type="number" required min="0" step="any"
          aria-invalid={invalidRating} value={rating} disabled={busy}
          onChange={event => onChange(capacityKey, event.target.value)} /><span>t/h</span></span></label>
        {baseline.revision && <label>Fine fraction <span className="number-input">
          <input type="number" required min="0" max="1" step="any" value={inputs.fine} disabled={busy}
            onChange={event => onChange('fine', event.target.value)} /><span>0–1</span></span></label>}
        <button className="button primary" disabled={busy || invalidRating} type="submit">Evaluate</button>
        <div className="presets">
          <button className="text-button" disabled={busy || rating === '' || Number(rating) <= 0} type="button" onClick={() => {
            const target = Number((baseline.result.requested_feed_tph * 1.2).toPrecision(12))
            onSimulate({ ...inputs, feed: String(target) })
          }}>+20% feed</button>
          <button className="text-button" disabled={busy || feed === '' || Number(feed) < 0} type="button"
            onClick={() => onSimulate({ ...inputs, [capacityKey]: '15' })}>Try 15 t/h crusher</button>
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
  const [action, setAction] = useState<Action | null>('load')
  const [error, setError] = useState('')
  const [inputs, setInputs] = useState<Inputs>({})
  const [gitRefresh, refreshGit] = useState(0)
  const busy = action !== null
  const dirty = !!baseline && JSON.stringify(inputs) !== JSON.stringify(inputsFromPlant(baseline.plant))

  function change(key: string, value: string) {
    setInputs(previous => ({ ...previous, [key]: value }))
  }

  function adopt(next: PlantView) {
    setBaseline(next)
    setView(next)
    setInputs(inputsFromPlant(next.plant))
    select(previous => next.plant.equipment.some(item => item.id === previous || item.component_ids.includes(previous))
      ? previous : next.plant.equipment.find(item => item.type === 'crusher')!.id)
    refreshGit(value => value + 1)
  }

  async function load(signal?: AbortSignal) {
    setAction('load')
    setError('')
    try {
      const next = await requestPlant(undefined, signal)
      adopt(next)
    } catch (failure) {
      if (!signal?.aborted) setError(failure instanceof Error ? failure.message : 'Could not load the plant.')
    } finally {
      if (!signal?.aborted) setAction(null)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!baseline?.revision || !dirty) return
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [baseline?.revision, dirty])

  async function submit(values: Inputs, kind: 'evaluate' | 'save') {
    if (!baseline) return
    setInputs(values)
    setAction(kind)
    setError('')
    try {
      const draft = makeDesign(baseline.plant, values)
      const crusher = baseline.plant.equipment.find(item => item.type === 'crusher')!
      const legacy = {
        requested_feed_tph: draft.requirements.requested_feed_tph,
        equipment_capacities_tph: { [crusher.id]: draft.equipment[crusher.id].specifications.max_solids_throughput_tph! },
      }
      const next = await requestPlant(baseline.revision ? draft : legacy, undefined,
        kind === 'save' ? baseline.revision ?? undefined : undefined)
      if (kind === 'save') adopt(next)
      else {
        setView(next)
        setInputs(inputsFromPlant(next.plant))
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'The plant action failed.')
    } finally {
      setAction(null)
    }
  }

  async function updateHistory(head: string, operation: GitAction): Promise<string> {
    if (!baseline?.revision || dirty || busy) return 'Save or discard the draft before changing history.'
    setAction('git')
    setError('')
    try {
      const fields = operation.kind === 'commit' ? { message: operation.message } : { commit: operation.commit }
      const next = await requestJson<PlantView>(`/api/plant/git/${operation.kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...fields, expected_head: head, expected_revision: baseline.revision }),
      })
      adopt(next)
      return ''
    } catch (failure) {
      return failure instanceof Error ? failure.message : 'Could not update the plant history.'
    } finally {
      setAction(null)
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
  const hasHistory = typeof baseline.git_dirty === 'boolean'
  const overloaded = new Set(result.findings.filter(finding => finding.rule_id === 'equipment_overload')
    .flatMap(finding => finding.equipment_ids))
  const components = new Map(plant.components.map(item => [item.id, item]))
  // Use the YAML connection order for the equipment list, beginning at the hopper.
  const processIds = Array.from(new Set(plant.connections.flatMap(stream => [stream.from.equipment_id, stream.to.equipment_id])))
  const equipment = new Map(plant.equipment.map(item => [item.id, item]))

  return <>
    <Header busy={busy} canSave={dirty} hasHistory={hasHistory}
      state={baseline.revision ? action === 'save' ? 'Saving…' : dirty ? 'Unsaved draft' :
        baseline.git_dirty ? 'Saved to YAML · Git changes' : 'Saved to YAML' : undefined}
      onSave={baseline.revision ? () => void submit(inputs, 'save') : undefined}
      onReload={() => {
        if (baseline.revision && dirty && !window.confirm('Discard unsaved edits and reload the plant YAML?')) return
        void load()
      }} />
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
        <Inspection view={view} selectedId={selected} inputs={inputs}
          onChange={baseline.revision ? change : undefined} busy={busy} />
      </div>
      <Scenario baseline={baseline} view={view} inputs={inputs} onChange={change}
        onSimulate={values => void submit(values, 'evaluate')} action={action} />
      {hasHistory && <VersionControl refresh={gitRefresh} busy={busy} dirty={dirty} onAction={updateHistory} />}
    </main>
  </>
}
