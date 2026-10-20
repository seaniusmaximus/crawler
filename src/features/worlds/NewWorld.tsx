import { useRef, useState } from 'react'
import { blankWorld, MAX_WORLDS } from '../../model/worlds.ts'
import { useWorldStore } from '../../state/worldStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { uploadWorldImage } from './worldImage.ts'

/** A new world map from a picture the DM picks; it opens once it's made. */
export function NewWorld({ campaignId, onDone }: { campaignId: string; onDone?: () => void }) {
  const ready = useWorldStore((state) => state.ready)
  const full = useWorldStore((state) => state.worlds.length >= MAX_WORLDS)
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function create(file: File): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      const image = await uploadWorldImage(campaignId, file)
      const fallback = file.name.replace(/\.[^.]+$/, '').slice(0, 80)
      useWorldStore.getState().create(blankWorld(name.trim() || fallback || 'World map', image))
      setName('')
      onDone?.()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not make that world map')
    } finally {
      setBusy(false)
    }
  }

  if (full) return <p className="panel-note">A campaign holds up to {MAX_WORLDS} world maps; delete one first.</p>

  return (
    <>
      <form
        className="table-join"
        onSubmit={(event) => {
          event.preventDefault()
          fileRef.current?.click()
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Name, e.g. The Sword Coast"
          aria-label="New world map name"
          maxLength={80}
          autoFocus
        />
        <button type="submit" className="outline-btn" disabled={busy || !ready}>
          <Icon id="image" size={14} />
          {busy ? 'Uploading…' : 'Choose picture'}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/gif"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void create(file)
          }}
        />
      </form>
      <p className="panel-note">A picture of the wider world to pin places on. Pins can lead to battle maps.</p>
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}
