import { useRef, useState } from 'react'
import { newBlockId, noteTitle, type Note, type NoteBlock } from '../../model/notes.ts'
import { sendHandout, useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { ImageThumb } from './NoteBlocks.tsx'
import { uploadNoteImage } from './noteImages.ts'
import { goToAnchor, useAnchorLabel, useIsDm } from './noteHooks.ts'

/** How long "Shown" stays on a handout button after it went out. */
const SHOWN_MS = 2000

/**
 * One of this seat's notes, open to write in. It is private or shared; a DM's
 * shared note goes to players without the parts marked hidden. A player's note
 * is shared whole.
 */
export function NoteEditor({ note }: { note: Note }) {
  const dm = useIsDm()
  const store = useNotesStore.getState()
  const roomId = useSessionStore((state) => state.roomId)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  // The DM picks parts to hide only once the note is shared.
  const choosing = dm && note.shared
  const shownBlocks = note.blocks.filter((block) => block.shared)

  function setBlocks(change: (blocks: NoteBlock[]) => NoteBlock[]): void {
    store.update(note.id, (current) => ({ blocks: change(current.blocks) }))
  }

  function setBlock(id: string, change: Partial<NoteBlock>): void {
    setBlocks((blocks) => blocks.map((block) => (block.id === id ? ({ ...block, ...change } as NoteBlock) : block)))
  }

  function move(id: string, step: number): void {
    setBlocks((blocks) => {
      const from = blocks.findIndex((block) => block.id === id)
      const to = from + step
      if (from < 0 || to < 0 || to >= blocks.length) return blocks
      const next = [...blocks]
      const [block] = next.splice(from, 1)
      next.splice(to, 0, block)
      return next
    })
  }

  /** Sharing a DM's note for the first time shows players all of it, until parts are hidden. */
  function setShared(shared: boolean): void {
    store.update(note.id, (current) => ({
      shared,
      ...(dm && shared && !current.blocks.some((block) => block.shared)
        ? { blocks: current.blocks.map((block) => ({ ...block, shared: true })) }
        : {}),
    }))
  }

  /** A new part starts hidden, so nothing typed into a shared note reaches players before the DM says so. */
  function addText(): void {
    setBlocks((blocks) => [...blocks, { id: newBlockId(), kind: 'text', text: '', shared: false }])
  }

  async function addImage(file: File): Promise<void> {
    if (!roomId) return
    setUploading(true)
    setUploadError(null)
    try {
      const src = await uploadNoteImage(roomId, file)
      setBlocks((blocks) => [...blocks, { id: newBlockId(), kind: 'image', src, caption: '', shared: false }])
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : 'Could not upload that picture')
    } finally {
      setUploading(false)
    }
  }

  function show(id: string, blocks: NoteBlock[]): void {
    if (!blocks.length) return
    const sent = sendHandout({
      id: crypto.randomUUID(),
      title: noteTitle(note),
      blocks: blocks.map((block) => ({ ...block, shared: true })),
    })
    if (!sent) return
    setShown(id)
    window.setTimeout(() => setShown((current) => (current === id ? null : current)), SHOWN_MS)
  }

  return (
    <div className="note-editor">
      <div className="note-editor-bar">
        <button type="button" className="text-btn notes-back" onClick={() => store.select(null)}>
          <Icon id="chevronLeft" size={14} />
          Notes
        </button>
        <span className="note-editor-bar-end">
          {confirmDelete ? (
            <>
              <span className="note-confirm">Delete this note?</span>
              <button type="button" className="text-btn is-danger" onClick={() => store.remove(note.id)}>
                Delete
              </button>
              <button type="button" className="text-btn" onClick={() => setConfirmDelete(false)}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`notes-star${note.starred ? ' is-on' : ''}`}
                aria-label={note.starred ? 'Unstar' : 'Star: keep at the top'}
                title={note.starred ? 'Unstar' : 'Star: keep at the top'}
                aria-pressed={note.starred}
                onClick={() => store.update(note.id, { starred: !note.starred })}
              >
                <Icon id="star" size={15} />
              </button>
              <button
                type="button"
                className="icon-btn is-danger"
                aria-label="Delete note"
                title="Delete note"
                onClick={() => setConfirmDelete(true)}
              >
                <Icon id="trash" size={15} />
              </button>
            </>
          )}
        </span>
      </div>

      <input
        className="note-title-input"
        value={note.title}
        placeholder="Untitled note"
        aria-label="Title"
        autoFocus={!note.title}
        onChange={(event) => store.update(note.id, { title: event.target.value })}
      />

      <div className="note-chips">
        <PinChip note={note} />
        <FolderChip note={note} />
      </div>

      <div className="note-share">
        <div className="segmented note-share-switch" role="radiogroup" aria-label="Who can read it">
          <button type="button" role="radio" aria-checked={!note.shared} className={note.shared ? '' : 'is-active'} onClick={() => setShared(false)}>
            <Icon id="lock" size={13} />
            Private
          </button>
          <button type="button" role="radio" aria-checked={note.shared} className={note.shared ? 'is-active' : ''} onClick={() => setShared(true)}>
            <Icon id="eye" size={13} />
            {dm ? 'Shared with players' : 'Shared with the table'}
          </button>
        </div>
        {choosing ? (
          <div className="note-share-row">
            <p className="panel-note">
              {shownBlocks.length === note.blocks.length
                ? 'Players can read all of it. Hide a part (a solution, a secret) with its eye.'
                : shownBlocks.length
                  ? `Players can read ${shownBlocks.length} of ${note.blocks.length} parts. Hidden parts stay yours.`
                  : 'Every part is hidden: players see only the title.'}
            </p>
            <button
              type="button"
              className="chip-btn is-gold"
              disabled={!shownBlocks.length}
              title="Pop it up on every player’s screen now"
              onClick={() => show('note', shownBlocks)}
            >
              {shown === 'note' ? 'Shown' : 'Show now'}
            </button>
          </div>
        ) : null}
      </div>

      <div className="note-blocks">
        {note.blocks.map((block, index) => {
          const hidden = choosing && !block.shared
          return (
            <div key={block.id} className={`note-block${hidden ? ' is-hidden' : ''}`}>
              {block.kind === 'text' ? (
                <textarea
                  className="note-text"
                  value={block.text}
                  placeholder={index === 0 ? (dm ? 'What’s here, what they find, what only you know…' : 'Write something down…') : 'More…'}
                  aria-label="Note text"
                  onChange={(event) => setBlock(block.id, { text: event.target.value })}
                />
              ) : (
                <div className="note-image">
                  <ImageThumb src={block.src} caption={block.caption} />
                  <input
                    className="note-caption"
                    value={block.caption}
                    placeholder="Add a caption"
                    aria-label="Caption"
                    onChange={(event) => setBlock(block.id, { caption: event.target.value })}
                  />
                </div>
              )}
              <div className="note-block-tools">
                {choosing ? (
                  <button
                    type="button"
                    className={`note-vis${hidden ? ' is-hidden' : ''}`}
                    aria-pressed={!hidden}
                    title={hidden ? 'Hidden from players: click to let them read it' : 'Players can read this: click to hide it'}
                    onClick={() => setBlock(block.id, { shared: hidden })}
                  >
                    <Icon id={hidden ? 'eyeOff' : 'eye'} size={13} />
                    {hidden ? 'Hidden from players' : 'Players see this'}
                  </button>
                ) : null}
                <span className="note-block-move">
                  {dm && block.kind === 'image' ? (
                    <button type="button" className="text-btn" title="Pop this picture up on every player’s screen" onClick={() => show(block.id, [block])}>
                      {shown === block.id ? 'Shown' : 'Show players'}
                    </button>
                  ) : null}
                  {note.blocks.length > 1 ? (
                    <>
                      <button type="button" className="icon-btn" aria-label="Move up" title="Move up" disabled={index === 0} onClick={() => move(block.id, -1)}>
                        <Icon id="chevronUp" size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        aria-label="Move down"
                        title="Move down"
                        disabled={index === note.blocks.length - 1}
                        onClick={() => move(block.id, 1)}
                      >
                        <Icon id="chevronDown" size={13} />
                      </button>
                    </>
                  ) : null}
                  <button
                    type="button"
                    className="icon-btn is-danger"
                    aria-label="Remove this part"
                    title="Remove this part"
                    onClick={() => setBlocks((blocks) => blocks.filter((item) => item.id !== block.id))}
                  >
                    <Icon id="trash" size={13} />
                  </button>
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="note-add">
        <button type="button" className="text-btn" onClick={addText}>
          <Icon id="plus" size={13} />
          Add text
        </button>
        {dm ? (
          <>
            <button
              type="button"
              className="text-btn"
              disabled={uploading || !roomId}
              title={roomId ? 'A map, a letter, a portrait: keep it, or show it to players' : 'Pictures need a hosted campaign'}
              onClick={() => fileRef.current?.click()}
            >
              <Icon id="image" size={13} />
              {uploading ? 'Uploading…' : 'Add picture'}
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void addImage(file)
              }}
            />
          </>
        ) : null}
      </div>
      {uploadError ? <p className="panel-note is-error">{uploadError}</p> : null}
    </div>
  )
}

/** Where the note is pinned: click to look there; or pin it to a room or object. */
function PinChip({ note }: { note: Note }) {
  const store = useNotesStore.getState()
  const pinning = useNotesStore((state) => state.pinningId === note.id)
  const mapId = useNotesStore((state) => state.mapId)
  const anchor = useAnchorLabel(note.anchor)

  if (pinning) {
    return (
      <span className="note-chip is-active">
        <Icon id="pin" size={13} />
        Click a room or object…
        <button type="button" className="note-chip-x" aria-label="Cancel pinning" onClick={() => store.cancelPin()}>
          <Icon id="close" size={11} />
        </button>
      </span>
    )
  }
  if (!anchor) {
    return (
      <button type="button" className="note-chip is-add" disabled={!mapId} onClick={() => store.startPin(note.id)}>
        <Icon id="pin" size={13} />
        Pin to map
      </button>
    )
  }
  return (
    <span className={`note-chip${anchor.here ? ' is-pin' : ''}`}>
      <button
        type="button"
        className="note-chip-main"
        disabled={!anchor.here}
        title={anchor.here ? 'Show it on the map' : 'On a map the party isn’t on'}
        onClick={() => goToAnchor(note.anchor)}
      >
        <Icon id="pin" size={13} />
        {anchor.label}
      </button>
      <button type="button" className="note-chip-x" aria-label="Unpin" title="Unpin" onClick={() => store.update(note.id, { anchor: null })}>
        <Icon id="close" size={11} />
      </button>
    </span>
  )
}

/** The note's folder: click to type one, picking from those already used. */
function FolderChip({ note }: { note: Note }) {
  const store = useNotesStore.getState()
  const folders = useNotesStore((state) => [...new Set(state.notes.map((item) => item.folder).filter(Boolean))].sort().join('\n'))
  const [editing, setEditing] = useState(false)

  if (editing) {
    return (
      <span className="note-chip is-active">
        <Icon id="folder" size={13} />
        <input
          className="note-chip-input"
          list={`note-folders-${note.id}`}
          defaultValue={note.folder}
          placeholder="Folder name"
          aria-label="Folder"
          autoFocus
          onBlur={(event) => {
            store.update(note.id, { folder: event.target.value.trim() })
            setEditing(false)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === 'Escape') event.currentTarget.blur()
          }}
        />
        <datalist id={`note-folders-${note.id}`}>
          {folders
            .split('\n')
            .filter(Boolean)
            .map((folder) => (
              <option key={folder} value={folder} />
            ))}
        </datalist>
      </span>
    )
  }
  return (
    <button type="button" className={`note-chip${note.folder ? '' : ' is-add'}`} title="Put it in a folder" onClick={() => setEditing(true)}>
      <Icon id="folder" size={13} />
      {note.folder || 'Add to folder'}
    </button>
  )
}
