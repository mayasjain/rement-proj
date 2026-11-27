import { useEffect, useState, type FormEvent } from 'react'
import { requestJson } from './plant'

type Commit = { hash: string; subject: string; date: string }
type Status = { branch: string; head: string; dirty: boolean; history: Commit[] }
type Change = { field: string; before: unknown; after: unknown }
type Comparison = 'working' | 'head'
export type GitAction = { kind: 'commit'; message: string } | { kind: 'restore'; commit: string }

const fieldLabels: Record<string, [string, string]> = {
  requested_feed_tph: ['Requested feed', 't/h'],
  screen_fine_fraction: ['Fine fraction', ''],
  max_solids_throughput_tph: ['Rated capacity', 't/h'],
  rated_power_kw: ['Rated power', 'kW'],
  position_m: ['Position', 'm'],
  rotation_deg: ['Rotation', '°'],
  dimensions_m: ['Dimensions', 'm'],
}

function displayField(path: string) {
  const parts = path.split('.')
  const leaf = parts.at(-1)!
  const [label, unit] = fieldLabels[leaf] ?? [leaf.replaceAll('_', ' '), '']
  const entity = ['equipment', 'components', 'connections'].includes(parts[0]) ? parts[1] : ''
  return { label: entity ? `${entity} · ${label}` : label, unit }
}

function displayValue(value: unknown, unit: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number') return `${value}${unit ? ` ${unit}` : ''}`
  if (Array.isArray(value) && value.every(item => typeof item === 'number')) {
    return `${value.join(', ')}${unit ? ` ${unit}` : ''}`
  }
  return typeof value === 'string' ? value : JSON.stringify(value) ?? '—'
}

export function VersionControl({ refresh, busy, dirty, onAction }: {
  refresh: number; busy: boolean; dirty: boolean
  onAction?: (head: string, action: GitAction) => Promise<string>
}) {
  const [status, setStatus] = useState<Status>()
  const [statusError, setStatusError] = useState('')
  const [selected, setSelected] = useState('')
  const [against, setAgainst] = useState<Comparison>('working')
  const [diff, setDiff] = useState<Change[]>()
  const [diffError, setDiffError] = useState('')
  const [message, setMessage] = useState('')
  const [notice, setNotice] = useState('')
  const [writeError, setWriteError] = useState('')
  const commit = status?.history.find(item => item.hash === selected) ?? status?.history[0]

  useEffect(() => {
    const controller = new AbortController()
    setStatusError('')
    requestJson<Status>('/api/plant/git', { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) setStatus(next) })
      .catch(error => { if (!controller.signal.aborted) setStatusError(error.message) })
    return () => controller.abort()
  }, [refresh])

  useEffect(() => {
    if (!commit) return
    const controller = new AbortController()
    setDiff(undefined)
    setDiffError('')
    const params = new URLSearchParams({ commit: commit.hash, against })
    requestJson<Change[]>(`/api/plant/git/diff?${params}`, { signal: controller.signal })
      .then(next => { if (!controller.signal.aborted) setDiff(next) })
      .catch(error => { if (!controller.signal.aborted) setDiffError(error.message) })
    return () => controller.abort()
  }, [commit?.hash, against, refresh])

  async function createCommit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!onAction || !status || dirty || busy || !message.trim()) return
    setNotice('')
    const error = await onAction(status.head, { kind: 'commit', message: message.trim() })
    setWriteError(error)
    if (!error) {
      setSelected('')
      setMessage('')
      setNotice('Plant changes committed.')
    }
  }

  async function restore() {
    if (!onAction || !status || !commit || status.dirty || dirty || busy) return
    if (!window.confirm(`Restore ${commit.hash.slice(0, 7)} as a new commit on ${status.branch}?`)) return
    setNotice('')
    const error = await onAction(status.head, { kind: 'restore', commit: commit.hash })
    setWriteError(error)
    if (!error) {
      setSelected('')
      setNotice('Snapshot restored in a new commit.')
    }
  }

  return <section id="plant-history" className="panel history-panel" aria-labelledby="history-heading">
    <div className="panel-heading">
      <h2 id="history-heading">Version history</h2>
      {status && <div className="repository-status">
        <span className="branch-name">{status.branch || 'Detached HEAD'}</span>
        <code title={status.head}>{status.head.slice(0, 7)}</code>
        <span className={`status ${status.dirty ? 'bad' : 'good'}`}>
          {onAction ? status.dirty ? 'Uncommitted files' : 'Clean' : 'Published snapshot'}
        </span>
      </div>}
    </div>
    <div className="history-body">
      {statusError ? <p className="warning-text" role="alert">{statusError}</p> :
        !status ? <p className="muted" role="status">Loading Git history…</p> :
          <>
            <div className="history-layout">
              <ul className="commit-list" aria-label="Plant commits">
                {status.history.map(item => <li key={item.hash}>
                  <button className={`commit-item ${commit?.hash === item.hash ? 'selected' : ''}`}
                    aria-pressed={commit?.hash === item.hash} disabled={busy}
                    onClick={() => { setSelected(item.hash); setNotice('') }}>
                    <strong>{item.subject || '(No commit message)'}</strong>
                    <span><code>{item.hash.slice(0, 7)}</code>{item.hash === status.head ? ' · HEAD' : ''}
                      {' · '}<time dateTime={item.date}>{item.date.slice(0, 10)}</time></span>
                  </button>
                </li>)}
              </ul>
              <div className="comparison">
                <div className="comparison-heading">
                  <h3>Compare <code>{commit?.hash.slice(0, 7)}</code></h3>
                  {onAction ? <label>With <select value={against} disabled={busy}
                    onChange={event => setAgainst(event.target.value as Comparison)}>
                    <option value="working">Saved YAML</option>
                    <option value="head">Current commit</option>
                  </select></label> : <span className="muted">With published plant</span>}
                </div>
                {diffError ? <p className="warning-text" role="alert">{diffError}</p> :
                  !diff ? <p className="muted" role="status">Loading field changes…</p> :
                    diff.length === 0 ? <p className="muted">No field changes.</p> :
                      <table className="field-diff" aria-label="Plant field changes">
                        <thead><tr><th scope="col">Field</th><th scope="col">Before</th><th scope="col">After</th></tr></thead>
                        <tbody>{diff.map(change => {
                          const { label, unit } = displayField(change.field)
                          return <tr key={change.field}>
                            <th scope="row" title={change.field}>{label}</th>
                            <td>{displayValue(change.before, unit)}</td>
                            <td>{displayValue(change.after, unit)}</td>
                          </tr>
                        })}</tbody>
                      </table>}
                {onAction && <button className="button light-button restore-button" disabled={busy || dirty || status.dirty ||
                  !status.branch || commit?.hash === status.head} onClick={() => void restore()}>Restore snapshot</button>}
              </div>
            </div>
            {onAction && <form className="commit-form" onSubmit={createCommit}>
              <label>Commit message <input value={message} maxLength={240} required disabled={busy}
                onChange={event => setMessage(event.target.value)} placeholder="Describe the saved design change" /></label>
              <button className="button primary" disabled={busy || dirty || !status.dirty || !status.branch || !message.trim()}
                type="submit">Commit saved changes</button>
            </form>}
            {onAction && (dirty ? <p className="muted history-note">Save or discard the draft before committing or restoring.</p> :
              status.dirty && <p className="muted history-note">Commit or resolve uncommitted files before restoring.</p>)}
            {writeError && <p role="alert" className="warning-text history-note">{writeError}</p>}
            {notice && <p role="status" className="history-note">{notice}</p>}
          </>}
    </div>
  </section>
}
