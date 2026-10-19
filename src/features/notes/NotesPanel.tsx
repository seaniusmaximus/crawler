import { useMemo, useState, type KeyboardEvent } from 'react'
import { mapReminders, type Reminder } from '../../model/noteMap.ts'
import { noteMatches, notePreview, noteTitle, sortNotes, type Note, type NoteAnchor, type SharedNote } from '../../model/notes.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { sharedKey, useNotesStore, type NotesTab } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { NoteEditor } from './NoteEditor.tsx'
import { NoteBlocks } from './NoteBlocks.tsx'
import { goToAnchor, lookAtRoom, useAnchorLabel, useAuthorName, useIsDm } from './noteHooks.ts'

/** Where a note's list can be narrowed to. */
type Scope = 'all' | 'map' | 'shared'

/** The notes button beside the toolbar: a notebook that opens and closes the panel. */
export function NotesButton() {
  const open = useNotesStore((state) => state.open)
  const unread = useNotesStore((state) => state.unread.length)
  const dm = useIsDm()
  const label = dm ? 'Notes: campaign notes, handouts and reminders' : 'Notes: your notebook, and what the table has shared'
  return (
    <button
      type="button"
      className={`panel notes-tool${open ? ' is-active' : ''}`}
      aria-pressed={open}
      aria-label={unread ? `${label} (${unread} newly shared)` : label}
      title={label}
      onClick={() => (open ? useNotesStore.getState().closePanel() : useNotesStore.getState().openPanel())}
    >
      <Icon id="notebook" size={19} />
      {unread > 0 ? <span className="notes-dot">{unread > 9 ? '9+' : unread}</span> : null}
    </button>
  )
}

/** Notes: this seat's own, what the table has shared, and (for the DM) what the map reminds them of. */
export function NotesPanel() {
  const open = useNotesStore((state) => state.open)
  const pinningId = useNotesStore((state) => state.pinningId)
  return (
    <>
      {pinningId ? <PinBanner noteId={pinningId} /> : null}
      {open ? <Panel /> : null}
      <NoteErrorToast />
    </>
  )
}

function Panel() {
  const dm = useIsDm()
  const ready = useNotesStore((state) => state.ready)
  const tab = useNotesStore((state) => state.tab)
  const selectedId = useNotesStore((state) => state.selectedId)
  const readingKey = useNotesStore((state) => state.readingKey)
  const notes = useNotesStore((state) => state.notes)
  const shared = useNotesStore((state) => state.shared)
  const selected = notes.find((note) => note.id === selectedId)
  const reading = shared.find((note) => sharedKey(note) === readingKey)
  const tabs: { id: NotesTab; label: string; count?: number }[] = [
    { id: 'mine', label: dm ? 'Campaign' : 'My notes' },
    { id: 'table', label: 'Shared', count: shared.length },
  ]
  if (dm) tabs.push({ id: 'reminders', label: 'Reminders' })

  return (
    <aside
      className="panel notes-panel scroll-v"
      aria-label="Notes"
      // Typing here never reaches the map's shortcuts.
      onKeyDown={(event: KeyboardEvent) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <header className="notes-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Notes</span>
        </h2>
        <button
          type="button"
          className="icon-btn is-boxed"
          aria-label="Close notes"
          onClick={() => useNotesStore.getState().closePanel()}
        >
          <Icon id="close" size={15} />
        </button>
      </header>
      <div className="segmented notes-tabs" role="tablist">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={tab === item.id}
            className={tab === item.id ? 'is-active' : ''}
            onClick={() => useNotesStore.getState().setTab(item.id)}
          >
            {item.label}
            {item.count ? <span className="notes-tab-count">{item.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="notes-body">
        {tab === 'reminders' && dm ? (
          <Reminders />
        ) : !ready ? (
          <NotReady />
        ) : tab === 'table' ? (
          reading ? (
            <SharedReader note={reading} />
          ) : (
            <SharedList notes={shared} />
          )
        ) : selected ? (
          <NoteEditor key={selected.id} note={selected} />
        ) : (
          <NoteList notes={notes} />
        )}
      </div>
    </aside>
  )
}

function NotReady() {
  const role = useSessionStore((state) => state.role)
  const status = useSessionStore((state) => state.status)
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  let text: string
  if (role === 'solo') text = 'Notes are kept with a campaign. Open or host one from the Table menu to start writing.'
  else if (status !== 'live') text = 'Waiting for the table…'
  else if (role === 'guest' && !myPlayerId) text = 'Take a seat at the table to keep a notebook.'
  else text = 'Opening your notes…'
  return <p className="panel-empty">{text}</p>
}

function NoteList({ notes }: { notes: readonly Note[] }) {
  const dm = useIsDm()
  const mapId = useNotesStore((state) => state.mapId)
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState<Scope>('all')
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set())

  const shown = sortNotes(notes).filter(
    (note) =>
      noteMatches(note, query) &&
      (scope === 'all' || (scope === 'map' ? note.anchor?.mapId === mapId : note.shared)),
  )
  const folders = [...new Set(shown.map((note) => note.folder))].sort((a, b) =>
    a === '' ? 1 : b === '' ? -1 : a.localeCompare(b),
  )

  function toggle(folder: string): void {
    const next = new Set(closed)
    if (next.has(folder)) next.delete(folder)
    else next.add(folder)
    setClosed(next)
  }

  return (
    <div className="notes-list-view">
      <div className="notes-toolbar">
        <input
          className="field"
          type="search"
          placeholder="Search notes"
          aria-label="Search notes"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <button type="button" className="chip-btn is-gold" onClick={() => useNotesStore.getState().create()}>
          New note
        </button>
      </div>
      <div className="notes-scopes" role="group" aria-label="Show">
        {(
          [
            ['all', 'All'],
            ['map', 'This map'],
            ['shared', dm ? 'Shared' : 'Shared by me'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={`notes-scope${scope === id ? ' is-on' : ''}`}
            aria-pressed={scope === id}
            onClick={() => setScope(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {notes.length === 0 ? (
        <p className="panel-empty">
          {dm
            ? 'Plan the campaign here: rooms, puzzles, secrets, handouts. Right-click a room or object to leave a note on it.'
            : 'Jot down names, clues and anything worth remembering. Pin a note to the map to find it again.'}
        </p>
      ) : shown.length === 0 ? (
        <p className="panel-empty">No notes match.</p>
      ) : (
        folders.map((folder) => {
          const inFolder = shown.filter((note) => note.folder === folder)
          const isClosed = closed.has(folder)
          return (
            <section key={folder || '—'} className="notes-folder">
              {folders.length > 1 || folder ? (
                <button type="button" className="notes-folder-head" aria-expanded={!isClosed} onClick={() => toggle(folder)}>
                  <Icon id={isClosed ? 'chevronDown' : 'chevronUp'} size={13} />
                  <span>{folder || 'Unfiled'}</span>
                  <span className="notes-folder-count">{inFolder.length}</span>
                </button>
              ) : null}
              {isClosed ? null : (
                <ul className="notes-rows">
                  {inFolder.map((note) => (
                    <NoteRow key={note.id} note={note} />
                  ))}
                </ul>
              )}
            </section>
          )
        })
      )}
    </div>
  )
}

function NoteRow({ note }: { note: Note }) {
  const anchor = useAnchorLabel(note.anchor)
  const preview = notePreview(note)
  return (
    <li className="notes-row">
      <button
        type="button"
        className={`notes-star${note.starred ? ' is-on' : ''}`}
        aria-label={note.starred ? 'Unstar' : 'Star'}
        aria-pressed={note.starred}
        onClick={() => useNotesStore.getState().update(note.id, { starred: !note.starred })}
      >
        <Icon id="star" size={14} />
      </button>
      <button type="button" className="notes-row-main" onClick={() => useNotesStore.getState().select(note.id)}>
        <span className="notes-row-title">{noteTitle(note)}</span>
        {preview ? <span className="notes-row-preview">{preview}</span> : null}
        {anchor || note.shared ? (
          <span className="notes-row-meta">
            {anchor ? (
              <span className={`notes-row-pin${anchor.here ? '' : ' is-away'}`}>
                <Icon id="pin" size={12} />
                {anchor.label}
              </span>
            ) : null}
            {note.shared ? (
              <span className="notes-row-shared">
                <Icon id="eye" size={12} />
                Shared
              </span>
            ) : null}
          </span>
        ) : null}
      </button>
      {anchor?.here ? (
        <button
          type="button"
          className="icon-btn"
          aria-label="Look at it on the map"
          title="Look at it on the map"
          onClick={() => goToAnchor(note.anchor)}
        >
          <Icon id="look" size={15} />
        </button>
      ) : null}
    </li>
  )
}

function SharedList({ notes }: { notes: readonly SharedNote[] }) {
  const dm = useIsDm()
  if (notes.length === 0) {
    return (
      <p className="panel-empty">
        {dm
          ? 'Nothing shared yet. Share a note and players see only the parts you mark as shown; players can share their notes here too.'
          : 'Nothing shared yet. What the DM or other players share with the table shows up here.'}
      </p>
    )
  }
  return (
    <ul className="notes-rows">
      {notes.map((note) => (
        <SharedRow key={sharedKey(note)} note={note} />
      ))}
    </ul>
  )
}

function SharedRow({ note }: { note: SharedNote }) {
  const author = useAuthorName(note.author)
  const preview = notePreview(note)
  return (
    <li className="notes-row">
      <button type="button" className="notes-row-main" onClick={() => useNotesStore.getState().read(sharedKey(note))}>
        <span className="notes-row-title">{noteTitle(note)}</span>
        {preview ? <span className="notes-row-preview">{preview}</span> : null}
        <span className="notes-row-meta">
          <span className={`notes-row-author${note.author === 'dm' ? ' is-dm' : ''}`}>{author}</span>
        </span>
      </button>
    </li>
  )
}

/** A note someone shared with the table, to read; it can be copied into this seat's own notes. */
function SharedReader({ note }: { note: SharedNote }) {
  const author = useAuthorName(note.author)
  const dm = useIsDm()
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const mine = note.author === (dm ? 'dm' : myPlayerId)
  const [copied, setCopied] = useState(false)

  function copy(): void {
    useNotesStore.getState().create({
      title: noteTitle(note),
      blocks: note.blocks.map((block) => ({ ...block, shared: false })),
    })
    setCopied(true)
  }

  return (
    <div className="note-reader">
      <button type="button" className="text-btn notes-back" onClick={() => useNotesStore.getState().read(null)}>
        <Icon id="chevronLeft" size={14} />
        Shared notes
      </button>
      <span className="kicker">Shared by {author}</span>
      <h3 className="note-reader-title">{noteTitle(note)}</h3>
      <NoteBlocks blocks={note.blocks} />
      {mine ? null : (
        <div className="panel-foot">
          <button type="button" className="outline-btn" disabled={copied} onClick={copy}>
            <Icon id="copy" size={15} />
            {copied ? 'Copied to your notes' : 'Copy to my notes'}
          </button>
        </div>
      )}
    </div>
  )
}

/** What the map reminds the DM of, room by room: traps standing there and hidden zones over them. */
function Reminders() {
  const dungeon = useDungeonStore((state) => state.dungeon)
  const notes = useNotesStore((state) => state.notes)
  const mapId = useNotesStore((state) => state.mapId)
  const reminders = useMemo(() => mapReminders(dungeon), [dungeon])
  const rooms = new Map<string, Reminder[]>()
  for (const reminder of reminders) rooms.set(reminder.roomId, [...(rooms.get(reminder.roomId) ?? []), reminder])

  function noteIt(reminder: Reminder): void {
    const anchor: NoteAnchor | null = mapId
      ? {
          mapId,
          floorId: reminder.floorId,
          roomId: reminder.roomId,
          ...(reminder.objectId ? { objectId: reminder.objectId } : {}),
          label: reminder.roomName,
        }
      : null
    useNotesStore.getState().create({ title: reminder.text, anchor, folder: 'Traps' })
  }

  if (reminders.length === 0) {
    return (
      <p className="panel-empty">
        Traps you place in rooms, and hidden zones laid with the area tool, are listed here room by room so you remember
        to spring them. You also get a reminder when the party walks in.
      </p>
    )
  }
  return (
    <div className="notes-reminders">
      {[...rooms.values()].map((items) => {
        const first = items[0]
        const pinned = notes.filter((note) => note.anchor?.mapId === mapId && note.anchor?.roomId === first.roomId).length
        return (
          <section key={first.roomId} className="notes-folder">
            <div className="notes-reminder-room">
              <span>{first.roomName}</span>
              {pinned ? <span className="notes-folder-count">{pinned} {pinned === 1 ? 'note' : 'notes'}</span> : null}
              <button
                type="button"
                className="icon-btn"
                aria-label={`Look at ${first.roomName}`}
                title={`Look at ${first.roomName}`}
                onClick={() => lookAtRoom(first.floorId, first.roomId)}
              >
                <Icon id="look" size={15} />
              </button>
            </div>
            <ul className="notes-rows">
              {items.map((reminder) => (
                <li key={reminder.id} className="notes-reminder">
                  <Icon id={reminder.kind === 'trap' ? 'trap' : 'aoe'} size={14} className="is-gold" />
                  <span className="notes-reminder-text">{reminder.text}</span>
                  <button type="button" className="text-btn" title="Start a note about it" onClick={() => noteIt(reminder)}>
                    Note it
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/** While a note waits for a spot on the map: what to click, and a way out. */
function PinBanner({ noteId }: { noteId: string }) {
  const note = useNotesStore((state) => state.notes.find((item) => item.id === noteId))
  return (
    <div className="notes-pin-banner panel" role="status" onPointerDown={(event) => event.stopPropagation()}>
      <Icon id="pin" className="is-gold" />
      <span>
        Click a room or object to pin <strong>{note ? noteTitle(note) : 'the note'}</strong>
      </span>
      <button type="button" className="text-btn" onClick={() => useNotesStore.getState().cancelPin()}>
        Cancel
      </button>
    </div>
  )
}

function NoteErrorToast() {
  const error = useNotesStore((state) => state.error)
  if (!error) return null
  return (
    <div className="notes-error panel" role="alert">
      <span>{error}</span>
      <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => useNotesStore.getState().dismissError()}>
        <Icon id="close" size={14} />
      </button>
    </div>
  )
}
