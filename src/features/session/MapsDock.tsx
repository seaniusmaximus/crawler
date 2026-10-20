import { useEffect, useState, type FormEvent, type KeyboardEvent } from 'react'
import * as api from '../../net/api.ts'
import type { MapInfo } from '../../net/api.ts'
import type { World } from '../../model/worlds.ts'
import { useChestStore } from '../../state/chestStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useWorldStore } from '../../state/worldStore.ts'
import { Diamond, Divider, Icon } from '../../ui/Icon.tsx'
import { NewWorld } from '../worlds/NewWorld.tsx'

/** The campaign's maps, a chest in the bottom-left row: see them, prepare new ones, move the party. */
export function MapsDock() {
  const role = useSessionStore((state) => state.role)
  const roomId = useSessionStore((state) => state.roomId)
  const mapsVersion = useSessionStore((state) => state.mapsVersion)
  const open = useChestStore((state) => state.open === 'maps')
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
      (failure: unknown) => live && setError(failure instanceof Error ? failure.message : 'Could not load battle maps'),
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
          onClose={() => useChestStore.getState().close()}
        />
      ) : null}
      <button
        type="button"
        className={`panel chest-fab chest${open ? ' is-open' : ''}`}
        aria-expanded={open}
        aria-label="Maps"
        title={hosting && liveMap ? `Maps · the party is on ${liveMap.name}` : 'Maps'}
        onClick={() => useChestStore.getState().toggle('maps')}
      >
        <Icon id="scroll" size={22} className="is-gold" />
        <span className="chest-fab-copy">
          <span className="chest-fab-state">Maps</span>
          <span className="chest-fab-name">{hosting ? (liveMap?.name ?? '…') : 'No campaign'}</span>
        </span>
      </button>
    </div>
  )
}

/**
 * Laid out like the notes panel: world maps are folders holding the battle maps
 * their pins lead to, and battle maps no world map leads to sit loose beneath.
 */
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
  const worldError = useWorldStore((state) => state.error)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  return (
    <section
      className="panel save-panel maps-panel chest-panel"
      aria-label="Maps"
      // Typing here never reaches the map's shortcuts.
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
    >
      <header className="notes-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Maps</span>
        </h2>
        <button type="button" className="icon-btn is-boxed" aria-label="Close" onClick={onClose}>
          <Icon id="close" size={15} />
        </button>
      </header>

      {/* Like the dice tray: controls on top, a gold rule, and only the list beneath it scrolls. */}
      <div className="panel-split">
        {campaignId && maps !== null ? (
          <>
            <div className="notes-toolbar">
              <input
                className="field"
                type="search"
                placeholder="Search maps"
                aria-label="Search maps"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="button"
                className={`chip-btn is-gold notes-new${creating ? ' is-active' : ''}`}
                aria-expanded={creating}
                onClick={() => setCreating(!creating)}
              >
                <Icon id={creating ? 'close' : 'plus'} size={14} />
                {creating ? 'Cancel' : 'New'}
              </button>
            </div>
            {creating ? (
              <NewMaps campaignId={campaignId} liveId={maps.find((map) => map.live)?.id ?? null} onDone={() => setCreating(false)} />
            ) : null}
          </>
        ) : null}
        <Divider />
      </div>

      <div className="notes-body maps-body">
        {!campaignId ? (
          <p className="panel-empty">
            Battle maps and world maps live inside a campaign. Save this map as a campaign (Save, at the bottom) or
            resume one, then add as many maps as you like.
          </p>
        ) : maps === null ? (
          <p className="panel-empty">Loading maps…</p>
        ) : (
          <div className="notes-list-view">
            <MapTree maps={maps} campaignId={campaignId} query={query} />
          </div>
        )}
        {error ? <p className="panel-note is-error">{error}</p> : null}
        {mapError ? <p className="panel-note is-error">{mapError}</p> : null}
        {worldError ? <p className="panel-note is-error">{worldError}</p> : null}
      </div>
    </section>
  )
}

/** The battle maps each world map's pins lead to, in the campaign's order, each once. */
function linkedMaps(world: World, maps: readonly MapInfo[]): MapInfo[] {
  const linked = new Set(world.pins.map((pin) => pin.mapId).filter(Boolean))
  return maps.filter((map) => linked.has(map.id))
}

function matches(text: string, query: string): boolean {
  return text.toLowerCase().includes(query.trim().toLowerCase())
}

function MapTree({ maps, campaignId, query }: { maps: MapInfo[]; campaignId: string; query: string }) {
  const ready = useWorldStore((state) => state.ready)
  const worlds = useWorldStore((state) => state.worlds)
  const [closed, setClosed] = useState<string[]>([])
  const searching = query.trim() !== ''

  const onAWorld = new Set(worlds.flatMap((world) => linkedMaps(world, maps).map((map) => map.id)))
  const loose = maps.filter((map) => !onAWorld.has(map.id) && (!searching || matches(map.name, query)))
  // A world map shows when its name matches (with all it holds), or when something it holds does.
  const folders = worlds
    .map((world) => {
      const inside = linkedMaps(world, maps)
      const shown = !searching || matches(world.name, query) ? inside : inside.filter((map) => matches(map.name, query))
      return { world, maps: shown, hit: !searching || matches(world.name, query) || shown.length > 0 }
    })
    .filter((folder) => folder.hit)

  if (searching && folders.length === 0 && loose.length === 0) return <p className="panel-empty">No maps match.</p>

  return (
    <>
      {!ready ? <p className="panel-note">Loading world maps…</p> : null}
      {folders.map(({ world, maps: inside }) => (
        <WorldFolder
          key={world.id}
          world={world}
          maps={inside}
          campaignId={campaignId}
          // A search opens every folder it found something in.
          open={searching || !closed.includes(world.id)}
          onToggle={() =>
            setClosed((list) => (list.includes(world.id) ? list.filter((id) => id !== world.id) : [...list, world.id]))
          }
        />
      ))}
      {loose.length ? (
        <>
          {folders.length ? <span className="kicker maps-loose-head">Not on a world map</span> : null}
          <ul className="notes-rows">
            {loose.map((map) => (
              <BattleMapRow key={map.id} map={map} campaignId={campaignId} />
            ))}
          </ul>
        </>
      ) : null}
      {ready && worlds.length === 0 && !searching ? (
        <p className="panel-note">
          Add a world map (New, above) to file battle maps under it: pin a place on the world map and link it to a battle map.
        </p>
      ) : null}
    </>
  )
}

type FolderMode = 'idle' | 'rename' | 'confirmDelete'

/** A world map as a folder: open it to see the battle maps its pins lead to. */
function WorldFolder({
  world,
  maps,
  campaignId,
  open,
  onToggle,
}: {
  world: World
  maps: MapInfo[]
  campaignId: string
  open: boolean
  onToggle: () => void
}) {
  const shown = useWorldStore((state) => state.shownId === world.id)
  const [mode, setMode] = useState<FolderMode>('idle')
  const [name, setName] = useState(world.name)

  function rename(event: FormEvent): void {
    event.preventDefault()
    useWorldStore.getState().update(world.id, () => ({ name: name.trim().slice(0, 80) || world.name }))
    setMode('idle')
  }

  return (
    <section className={`notes-folder maps-world${open ? ' is-open' : ''}${shown ? ' is-shown' : ''}`}>
      {mode === 'rename' ? (
        <form className="table-join map-rename" onSubmit={rename}>
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMode('idle')
            }}
            aria-label="World map name"
            maxLength={80}
            autoFocus
          />
          <button type="submit" className="outline-btn is-small">
            Save
          </button>
          <button type="button" className="text-btn" onClick={() => setMode('idle')}>
            Cancel
          </button>
        </form>
      ) : (
        // One line: the name (which opens and closes the folder), then what can be done
        // with it. Asking before a delete takes a second line, only while it asks.
        <div className="notes-folder-head maps-world-head">
          <div className="maps-world-line">
            <button
              type="button"
              className="notes-folder-toggle"
              aria-expanded={open}
              title={open ? `Close ${world.name}` : `Open ${world.name}`}
              onClick={onToggle}
            >
              <Icon id={open ? 'chevronDown' : 'chevronRight'} size={14} className="notes-folder-chevron" />
              <Icon id="world" size={16} className="notes-folder-icon" />
              <span className="notes-folder-name">{world.name}</span>
              {shown ? (
                <span className="maps-flag" title="The table is shown this world map" aria-label="Shown to the table">
                  <Icon id="eye" size={14} />
                </span>
              ) : null}
            </button>
            {mode === 'confirmDelete' ? null : (
              <>
                {/* Only take room while the row is hovered: the name needs it more. */}
                <button
                  type="button"
                  className="icon-btn maps-world-tool"
                  aria-label={`Rename ${world.name}`}
                  title="Rename"
                  onClick={() => {
                    setName(world.name)
                    setMode('rename')
                  }}
                >
                  <Icon id="pencil" size={14} />
                </button>
                <button
                  type="button"
                  className="icon-btn maps-world-tool"
                  aria-label={`Delete ${world.name}`}
                  title="Delete world map"
                  onClick={() => setMode('confirmDelete')}
                >
                  <Icon id="trash" size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              className="chip-btn is-gold maps-world-open"
              aria-label={`Open world map ${world.name}`}
              onClick={() => useWorldStore.getState().view(world.id)}
            >
              <Icon id="world" size={14} />
              Open world map
            </button>
          </div>
          {mode === 'confirmDelete' ? (
            <div className="maps-world-confirm">
              <span className="panel-note">Delete this world map and its pins?</span>
              <button type="button" className="text-btn" onClick={() => setMode('idle')}>
                Keep
              </button>
              <button
                type="button"
                className="outline-btn is-danger is-small"
                onClick={() => useWorldStore.getState().remove(world.id)}
              >
                Delete
              </button>
            </div>
          ) : null}
        </div>
      )}
      {open ? (
        maps.length ? (
          <ul className="notes-rows notes-folder-items">
            {maps.map((map) => (
              <BattleMapRow key={map.id} map={map} campaignId={campaignId} />
            ))}
          </ul>
        ) : (
          <p className="panel-note notes-folder-items maps-folder-empty">
            No pins lead to battle maps yet.{' '}
            <button type="button" className="text-btn" onClick={() => useWorldStore.getState().view(world.id)}>
              Open it
            </button>{' '}
            and link a pin.
          </p>
        )
      ) : null}
    </section>
  )
}

type RowMode = 'idle' | 'confirmMove' | 'rename' | 'confirmDelete'

function BattleMapRow({ map, campaignId }: { map: MapInfo; campaignId: string }) {
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
      <li className="notes-row maps-row">
        <form className="table-join map-rename" onSubmit={rename}>
          <input
            className="field"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setMode('idle')
            }}
            aria-label="Battle map name"
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
    <li className={`notes-row maps-row${map.live ? ' is-live' : ''}`}>
      <button
        type="button"
        className="notes-row-main"
        onClick={move}
        disabled={map.live || Boolean(mapBusy)}
        title={map.live ? 'The party is here' : `Move the party to ${map.name}`}
      >
        <span className="notes-row-title">
          <Icon id="rooms" size={13} className="maps-row-icon" />
          <span className="maps-row-name">{map.name}</span>
          {map.live ? <span className="maps-tag">Live</span> : null}
        </span>
        <span className={`notes-row-preview${mode === 'idle' && !moving ? '' : ' is-ask'}`}>
          {mode === 'confirmMove'
            ? `Move the party here? ${players === 1 ? "A player's screen" : "Players' screens"} will switch.`
            : mode === 'confirmDelete'
              ? 'Delete this battle map and its save points?'
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
        <span className="maps-row-actions">
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
              title="Delete battle map"
              onClick={() => setMode('confirmDelete')}
            >
              <Icon id="trash" size={14} />
            </button>
          )}
        </span>
      )}
      {error ? <p className="panel-note is-error maps-row-error">{error}</p> : null}
    </li>
  )
}

type NewKind = 'battle' | 'world'

/** New: a battle map (blank, or a copy of the live one) or a world map from a picture. */
function NewMaps({ campaignId, liveId, onDone }: { campaignId: string; liveId: string | null; onDone: () => void }) {
  const [kind, setKind] = useState<NewKind>('battle')
  return (
    <div className="maps-new">
      <div className="segmented maps-new-kind" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'battle'}
          className={kind === 'battle' ? 'is-active' : ''}
          onClick={() => setKind('battle')}
        >
          <Icon id="rooms" size={14} />
          Battle map
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === 'world'}
          className={kind === 'world' ? 'is-active' : ''}
          onClick={() => setKind('world')}
        >
          <Icon id="world" size={14} />
          World map
        </button>
      </div>
      {kind === 'battle' ? (
        <NewBattleMap campaignId={campaignId} liveId={liveId} onDone={onDone} />
      ) : (
        <NewWorld campaignId={campaignId} onDone={onDone} />
      )}
    </div>
  )
}

/** A blank battle map to prepare, or a copy of the live one to vary. */
function NewBattleMap({ campaignId, liveId, onDone }: { campaignId: string; liveId: string | null; onDone: () => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function create(from: string | null): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await api.createMap(campaignId, name.trim() || (from ? 'Copy of the live battle map' : 'New battle map'), from)
      setName('')
      useSessionStore.getState().touchMaps()
      onDone()
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Could not create the battle map')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
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
          placeholder="Name, e.g. Goblin Warrens"
          aria-label="New battle map name"
          maxLength={80}
          autoFocus
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
      <p className="panel-note">Players only see a new battle map once you move the party there.</p>
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
