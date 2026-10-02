import { useCallback, useEffect, useState, type FormEvent } from 'react'
import * as api from '../../net/api.ts'
import type { SavePoint } from '../../net/api.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'

const KIND_LABEL: Record<SavePoint['kind'], string> = {
  named: 'Save point',
  auto: 'Autosave',
  restore: 'Safety copy',
}

/** The hosted campaign's save points: make one, go back to one, or tidy up. */
export function SavePoints({ campaignId }: { campaignId: string }) {
  const [saves, setSaves] = useState<SavePoint[] | null>(null)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<number | null>(null)
  // A brand-new change may still be on its way; saving waits until the relay has it.
  const saveState = useSessionStore((state) => state.saveState)

  const refresh = useCallback(async () => {
    try {
      setSaves(await api.listSaves(campaignId))
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not load save points')
    }
  }, [campaignId])

  useEffect(() => {
    let live = true
    api.listSaves(campaignId).then(
      (list) => live && setSaves(list),
      (failure: unknown) => live && setError(failure instanceof Error ? failure.message : 'Could not load save points'),
    )
    return () => {
      live = false
    }
  }, [campaignId])

  async function run(work: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await work()
      await refresh()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong')
    } finally {
      setBusy(false)
      setConfirming(null)
    }
  }

  function save(event: FormEvent): void {
    event.preventDefault()
    void run(async () => {
      await api.createSave(campaignId, name.trim())
      setName('')
    })
  }

  return (
    <>
      <form className="table-join" onSubmit={save}>
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Name, e.g. Before the dragon"
          aria-label="Save point name"
          maxLength={80}
        />
        <button type="submit" className="outline-btn" disabled={busy || saveState === 'saving'}>
          Save point
        </button>
      </form>

      {saves === null ? (
        <p className="panel-note">Loading save points…</p>
      ) : saves.length === 0 ? (
        <p className="panel-note">No save points yet. Crawler adds an autosave every ten minutes of editing.</p>
      ) : (
        <ul className="campaign-list saves-list" aria-label="Save points">
          {saves.map((save) => (
            <li key={save.id} className="campaign-row">
              <span className="campaign-copy">
                <span className="campaign-name">{save.name}</span>
                <span className="campaign-meta">
                  {KIND_LABEL[save.kind]} · {new Date(save.createdAt).toLocaleString()} · {formatSize(save.size)}
                </span>
              </span>
              {confirming === save.id ? (
                <>
                  <button type="button" className="text-btn" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="outline-btn is-small"
                    disabled={busy}
                    onClick={() => void run(() => api.restoreSave(campaignId, save.id))}
                  >
                    Restore
                  </button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="outline-btn is-small"
                    disabled={busy}
                    onClick={() => setConfirming(save.id)}
                  >
                    Restore…
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`Delete ${save.name}`}
                    title="Delete save point"
                    disabled={busy}
                    onClick={() => void run(() => api.deleteSave(campaignId, save.id))}
                  >
                    <Icon id="close" size={14} />
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {confirming !== null ? (
        <p className="panel-note">Restoring replaces the map for everyone. The current map is kept as a safety copy.</p>
      ) : null}
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}

function formatSize(chars: number): string {
  if (chars < 1024) return `${chars} B`
  if (chars < 1024 * 1024) return `${Math.round(chars / 1024)} KB`
  return `${(chars / 1024 / 1024).toFixed(1)} MB`
}
