import { useRef, useState } from 'react'
import { createSave } from '../../net/api.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { applySave, downloadSave, readSave } from './saveFile.ts'

type Pending = { file: File; save: Awaited<ReturnType<typeof readSave>> }

/** Download the map as a file the DM keeps, or open one back up. */
export function SaveFileActions() {
  const role = useSessionStore((state) => state.role)
  const campaignName = useSessionStore((state) => state.campaignName)
  const saveState = useSessionStore((state) => state.saveState)
  const input = useRef<HTMLInputElement>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function choose(file: File | undefined): Promise<void> {
    if (input.current) input.current.value = ''
    if (!file) return
    setError(null)
    try {
      const save = await readSave(file)
      // Only ask when something would be lost or everyone's map would change.
      if (role === 'host' || saveState === 'unsaved') setPending({ file, save })
      else applySave(save)
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not open that file')
    }
  }

  async function confirm(): Promise<void> {
    if (!pending) return
    setBusy(true)
    const { roomId, role: current } = useSessionStore.getState()
    if (current === 'host' && roomId) {
      // Keep what's being replaced; a failure here shouldn't block opening the file.
      await createSave(roomId, `Before opening ${pending.file.name}`, true).catch(() => undefined)
    }
    applySave(pending.save)
    setPending(null)
    setBusy(false)
  }

  return (
    <>
      <span className="kicker">Backup</span>
      <div className="table-join">
        <button type="button" className="outline-btn" onClick={() => void downloadSave(campaignName ?? 'crawler')}>
          <Icon id="download" size={15} />
          Download save
        </button>
        <button type="button" className="outline-btn" onClick={() => input.current?.click()}>
          Open save file
        </button>
        <input
          ref={input}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(event) => void choose(event.target.files?.[0])}
        />
      </div>
      {pending ? (
        <div className="save-confirm">
          <p className="panel-note">
            {role === 'host'
              ? `Replace “${campaignName ?? 'this campaign'}” for everyone with ${pending.file.name}? The current map is kept as a safety copy in Save points.`
              : `Replace the unsaved map in this tab with ${pending.file.name}?`}
          </p>
          <div className="table-join">
            <button type="button" className="outline-btn" onClick={() => setPending(null)} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="outline-btn is-danger" onClick={() => void confirm()} disabled={busy}>
              Replace map
            </button>
          </div>
        </div>
      ) : null}
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}
