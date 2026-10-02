import { useEffect, useState, type FormEvent } from 'react'
import * as api from '../../net/api.ts'
import type { MapInfo } from '../../net/api.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Diamond, Icon } from '../../ui/Icon.tsx'

/** The campaign's maps, bottom-left of the floors: see them, prepare new ones, move the party. */
export function MapsDock() {
  const role = useSessionStore((state) => state.role)
  const roomId = useSessionStore((state) => state.roomId)
  const mapsVersion = useSessionStore((state) => state.mapsVersion)
  const [open, setOpen] = useState(false)
  const [maps, setMaps] = useState<MapInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const hosting = role === 'host' && roomId !== null

  // Reload on open, and whenever this tab changes the maps.
  useEffect(() => {
    if (!hosting || !roomId) return
    let live = true
    api.listMaps(roomId).then(
      (list) => {
        if (!live) return
        setMaps(list)
        setError(null)
      },
      (failure: unknown) => live && setError(failure instanceof Error ? failure.message : 'Could not load maps'),
    )
    return () => {
      live = false
    }
  }, [hosting, roomId, mapsVersion, open])

  if (role === 'guest') return null
  const liveMap = hosting ? maps?.find((map) => map.live) : undefined

  return (
    <div className="maps-dock">
      {open ? (
        <MapsPanel
          maps={hosting ? maps : null}
          campaignId={hosting ? roomId : null}
          error={error}
          onClose={() => setOpen(false)}
        />
      ) : null}
      <button
        type="button"
        className={`panel save-fab maps-fab chest${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label="Maps"
        onClick={() => setOpen(!open)}
      >
        <Icon id="scroll" size={22} className="is-gold" />
        <span className="save-fab-copy">
          <span className="save-fab-state">Maps</span>
          <span className="save-fab-name">{hosting ? (liveMap?.name ?? '…') : 'No campaign'}</span>
        </span>
      </button>
    </div>
  )
}

function MapsPanel({
  maps,
  campaignId,
  error,
  onClose,
}: {
  maps: MapInfo[] | null
  campaignId: string | null
  error: string | null
  onClose: () => void
}) {
  const mapError = useSessionStore((state) => state.mapError)

  return (
    <section className="panel save-panel maps-panel chest-panel" aria-label="Maps">
      <div className="panel-body">
        <header className="panel-head">
          <h2 className="panel-title">
            <Diamond />
            <span>Maps</span>
          </h2>
          <button type="button" className="icon-btn is-boxed" aria-label="Close" onClick={onClose}>
            <Icon id="close" size={15} />
          </button>
        </header>

        {!campaignId ? (
          <p className="panel-note">
            Maps live inside a campaign. Save this map as a campaign (Save, at the bottom) or resume one, then add as
            many maps as you like.
          </p>
        ) : maps === null ? (
          <p className="panel-note">Loading maps…</p>
        ) : (
          <>
            <p className="panel-note">Pick a map to move the party there. The party comes along; monsters stay with their map.</p>
            <ul className="campaign-list maps-list" aria-label="Maps in this campaign">
              {maps.map((map) => (
                <MapRow key={map.id} map={map} campaignId={campaignId} />
              ))}
            </ul>
            <NewMap campaignId={campaignId} liveId={maps.find((map) => map.live)?.id ?? null} />
          </>
        )}
        {error ? <p className="panel-note is-error">{error}</p> : null}
        {mapError ? <p className="panel-note is-error">{mapError}</p> : null}
      </div>
    </section>
  )
}

type RowMode = 'idle' | 'confirmMove' | 'rename' | 'confirmDelete'

function MapRow({ map, campaignId }: { map: MapInfo; campaignId: string }) {
  const mapBusy = useSessionStore((state) => state.mapBusy)
  const players = useSessionStore((state) => state.peers.length)
  const [mode, setMode] = useState<RowMode>('idle')
  const [name, setName] = useState(map.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const moving = mapBusy === map.id

  function move(): void {
    if (map.live || mapBusy) return
    // Only ask when someone's screen is about to change under them.
    if (players > 0 && mode !== 'confirmMove') {
      setMode('confirmMove')
      return
    }
    setMode('idle')
    useSessionStore.getState().switchMap(map.id)
  }

  async function run(work: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await work()
      setMode('idle')
      useSessionStore.getState().touchMaps()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong')
    } finally {
      setBusy(false)
    }
  }

  function rename(event: FormEvent): void {
    event.preventDefault()
    void run(() => api.renameMap(campaignId, map.id, name.trim() || map.name))
  }

  if (mode === 'rename') {
    return (
      <li className="campaign-row map-row">
        <form className="table-join map-rename" onSubmit={rename}>
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Escape') setMode('idle')
            }}
            aria-label="Map name"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className="outline-btn is-small" disabled={busy}>
            Save
          </button>
          <button type="button" className="text-btn" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      </li>
    )
  }

  return (
    <li className={`campaign-row map-row${map.live ? ' is-current' : ''}`}>
      <button
        type="button"
        className="map-pick"
        onClick={move}
        disabled={map.live || Boolean(mapBusy)}
        title={map.live ? 'The party is here' : `Move the party to ${map.name}`}
      >
        <span className="campaign-name">{map.name}</span>
        <span className="campaign-meta">
          {mode === 'confirmMove'
            ? `Move the party here? ${players === 1 ? "A player's screen" : "Players' screens"} will switch.`
            : mode === 'confirmDelete'
              ? 'Delete this map and its save points?'
              : moving
                ? 'Moving the party…'
                : details(map)}
        </span>
      </button>
      {mode === 'confirmMove' ? (
        <>
          <button type="button" className="text-btn" onClick={() => setMode('idle')}>
            Cancel
          </button>
          <button type="button" className="outline-btn is-small" onClick={move}>
            Move
          </button>
        </>
      ) : mode === 'confirmDelete' ? (
        <>
          <button type="button" className="text-btn" onClick={() => setMode('idle')}>
            Keep
          </button>
          <button
            type="button"
            className="outline-btn is-danger is-small"
            disabled={busy}
            onClick={() => void run(() => api.deleteMap(campaignId, map.id))}
          >
            Delete
          </button>
        </>
      ) : (
        <>
          {map.live ? <span className="campaign-tag">Live</span> : null}
          <button
            type="button"
            className="icon-btn"
            aria-label={`Rename ${map.name}`}
            title="Rename"
            onClick={() => {
              setName(map.name)
              setMode('rename')
            }}
          >
            <Icon id="pencil" size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={`Copy ${map.name}`}
            title="Make a copy"
            disabled={busy}
            onClick={() => void run(() => api.createMap(campaignId, `${map.name} (copy)`, map.id))}
          >
            <Icon id="copy" size={14} />
          </button>
          {map.live ? null : (
            <button
              type="button"
              className="icon-btn"
              aria-label={`Delete ${map.name}`}
              title="Delete map"
              onClick={() => setMode('confirmDelete')}
            >
              <Icon id="trash" size={14} />
            </button>
          )}
        </>
      )}
      {error ? <p className="panel-note is-error map-row-error">{error}</p> : null}
    </li>
  )
}

/** A blank map to prepare, or a copy of the live one to vary. */
function NewMap({ campaignId, liveId }: { campaignId: string; liveId: string | null }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(from: string | null): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.createMap(campaignId, name.trim() || (from ? 'Copy of the live map' : 'New map'), from)
      setName('')
      useSessionStore.getState().touchMaps()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the map')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <span className="kicker">New map</span>
      <form
        className="table-join"
        onSubmit={(event) => {
          event.preventDefault()
          void create(null)
        }}
      >
        <input
          className="field"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => event.stopPropagation()}
          placeholder="Name, e.g. Goblin Warrens"
          aria-label="New map name"
          maxLength={80}
        />
        <button type="submit" className="outline-btn" disabled={busy}>
          <Icon id="plus" size={14} />
          Blank
        </button>
        <button type="button" className="outline-btn" disabled={busy || !liveId} onClick={() => void create(liveId)}>
          <Icon id="copy" size={14} />
          Copy live
        </button>
      </form>
      <p className="panel-note">New maps are only seen by players once you move the party there.</p>
      {error ? <p className="panel-note is-error">{error}</p> : null}
    </>
  )
}

function details(map: MapInfo): string {
  const parts = [
    `${map.floors} ${map.floors === 1 ? 'floor' : 'floors'}`,
    `${map.rooms} ${map.rooms === 1 ? 'room' : 'rooms'}`,
  ]
  if (map.monsters) parts.push(`${map.monsters} ${map.monsters === 1 ? 'monster' : 'monsters'}`)
  parts.push(`edited ${ago(map.updatedAt)}`)
  return parts.join(' · ')
}

function ago(time: number): string {
  const minutes = Math.round((Date.now() - time) / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(time).toLocaleDateString()
}
