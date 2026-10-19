import { useRef, useState } from 'react'
import { newBlockId, noteTitle, type Note, type NoteBlock } from '../../model/notes.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { sendHandout, useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { uploadNoteImage } from './noteImages.ts'
import { goToAnchor, useAnchorLabel, useIsDm } from './noteHooks.ts'

/** How long "Shown" stays on a handout button after it went out. */
const SHOWN_MS = 2000

/**
 * One of this seat's notes, open to write in. The DM marks each part shown or
 * kept back: sharing the note sends players only the shown parts. A player's
 * note is shared whole.
 */
export function NoteEditor({ note }: { note: Note }) {
  const dm = useIsDm()
  const store = useNotesStore.getState()
  const folders = useNotesStore((state) => [...new Set(state.notes.map((item) => item.folder).filter(Boolean))].sort().join('\n'))
  const pinning = useNotesStore((state) => state.pinningId === note.id)
  const mapId = useNotesStore((state) => state.mapId)
  const roomId = useSessionStore((state) => state.roomId)
  const anchor = useAnchorLabel(note.anchor)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [shown, setShown] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
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

  function linkToMap(): void {
    if (!mapId) return
    store.update(note.id, { anchor: { mapId, label: useDungeonStore.getState().dungeon.name || 'This map' } })
  }

  return (
    <div className="note-editor">
      <div className="note-editor-bar">
        <button type="button" className="text-btn notes-back" onClick={() => store.select(null)}>
          <Icon id="chevronLeft" size={14} />
          All notes
        </button>
        <span className="note-editor-bar-end">
          <button
            type="button"
            className={`notes-star${note.starred ? ' is-on' : ''}`}
            aria-label={note.starred ? 'Unstar' : 'Star'}
            aria-pressed={note.starred}
            onClick={() => store.update(note.id, { starred: !note.starred })}
          >
            <Icon id="star" size={15} />
          </button>
          {confirmDelete ? (
            <>
              <button type="button" className="text-btn is-danger" onClick={() => store.remove(note.id)}>
                Delete
              </button>
              <button type="button" className="text-btn" onClick={() => setConfirmDelete(false)}>
                Keep
              </button>
            </>
          ) : (
            <button
              type="button"
              className="icon-btn is-danger"
              aria-label="Delete note"
              title="Delete note"
              onClick={() => setConfirmDelete(true)}
            >
              <Icon id="trash" size={15} />
            </button>
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

      <label className="note-field">
        <span className="kicker">Folder</span>
        <input
          className="field"
          list={`note-folders-${note.id}`}
          value={note.folder}
          placeholder="None"
          onChange={(event) => store.update(note.id, { folder: event.target.value })}
          onBlur={(event) => store.update(note.id, { folder: event.target.value.trim() })}
        />
        <datalist id={`note-folders-${note.id}`}>
          {folders
            .split('\n')
            .filter(Boolean)
            .map((folder) => (
              <option key={folder} value={folder} />
            ))}
        </datalist>
      </label>

      <div className="note-anchor">
        <span className="kicker">Pinned to</span>
        {pinning ? (
          <div className="note-anchor-row">
            <span className="note-anchor-hint">Click a room or object on the map…</span>
            <button type="button" className="text-btn" onClick={() => store.cancelPin()}>
              Cancel
            </button>
          </div>
        ) : anchor ? (
          <div className="note-anchor-row">
            <span className={`note-anchor-label${anchor.here ? '' : ' is-away'}`}>
              <Icon id="pin" size={13} />
              {anchor.label}
            </span>
            {anchor.here ? (
              <button type="button" className="chip-btn" onClick={() => goToAnchor(note.anchor)}>
                Go
              </button>
            ) : null}
            <button type="button" className="text-btn" onClick={() => store.startPin(note.id)}>
              Move
            </button>
            <button type="button" className="text-btn" onClick={() => store.update(note.id, { anchor: null })}>
              Unpin
            </button>
          </div>
        ) : (
          <div className="note-anchor-row">
            <button type="button" className="chip-btn" disabled={!mapId} onClick={() => store.startPin(note.id)}>
              <Icon id="pin" size={13} />
              Pin on map
            </button>
            <button type="button" className="text-btn" disabled={!mapId} onClick={linkToMap}>
              Link to this map
            </button>
          </div>
        )}
      </div>

      <div className="note-share">
        <label className="note-share-toggle">
          <input
            type="checkbox"
            checked={note.shared}
            onChange={(event) => store.update(note.id, { shared: event.target.checked })}
          />
          <span>{dm ? 'Share with players' : 'Share with the table'}</span>
        </label>
        <p className="panel-note">
          {dm
            ? note.shared
              ? shownBlocks.length
                ? shownBlocks.length === note.blocks.length
                  ? 'Players have the whole note in their notebooks.'
                  : `Players have ${shownBlocks.length} of its ${note.blocks.length} parts in their notebooks; the rest stays yours.`
                : 'Players see only the title until you mark parts as shown.'
              : 'Mark the parts players may see, then share. Unmarked parts stay yours.'
            : note.shared
              ? 'Everyone at the table can read this note.'
              : 'Only you can read this note.'}
        </p>
        {dm ? (
          <button
            type="button"
            className="outline-btn"
            disabled={!shownBlocks.length}
            title={shownBlocks.length ? 'Put the shown parts up on every player’s screen now' : 'Mark a part as shown first'}
            onClick={() => show('note', shownBlocks)}
          >
            <Icon id="look" size={15} />
            {shown === 'note' ? 'Shown to players' : 'Show to players now'}
          </button>
        ) : null}
      </div>

      <div className="note-blocks">
        {note.blocks.map((block, index) => (
          <div key={block.id} className={`note-block${dm && block.shared ? ' is-shown' : ''}${dm && !block.shared ? ' is-secret' : ''}`}>
            {block.kind === 'text' ? (
              <textarea
                className="note-text"
                value={block.text}
                placeholder={index === 0 ? (dm ? 'What happens here, what they find, what only you know…' : 'Write something down…') : 'More…'}
                aria-label="Note text"
                onChange={(event) => setBlock(block.id, { text: event.target.value })}
              />
            ) : (
              <div className="note-image">
                <img src={block.src} alt={block.caption || 'Picture'} />
                <input
                  className="field"
                  value={block.caption}
                  placeholder="Caption"
                  aria-label="Caption"
                  onChange={(event) => setBlock(block.id, { caption: event.target.value })}
                />
              </div>
            )}
            <div className="note-block-tools">
              {dm ? (
                <button
                  type="button"
                  className={`note-vis${block.shared ? ' is-shown' : ''}`}
                  aria-pressed={block.shared}
                  title={block.shared ? 'Players see this part when the note is shared' : 'Only you see this part'}
                  onClick={() => setBlock(block.id, { shared: !block.shared })}
                >
                  <Icon id={block.shared ? 'eye' : 'eyeOff'} size={13} />
                  {block.shared ? 'Shown' : 'DM only'}
                </button>
              ) : null}
              {dm && block.kind === 'image' ? (
                <button type="button" className="text-btn" title="Put this picture up on every player’s screen" onClick={() => show(block.id, [block])}>
                  {shown === block.id ? 'Shown' : 'Show players'}
                </button>
              ) : null}
              <span className="note-block-move">
                <button type="button" className="icon-btn" aria-label="Move up" disabled={index === 0} onClick={() => move(block.id, -1)}>
                  <Icon id="chevronUp" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label="Move down"
                  disabled={index === note.blocks.length - 1}
                  onClick={() => move(block.id, 1)}
                >
                  <Icon id="chevronDown" size={13} />
                </button>
                <button
                  type="button"
                  className="icon-btn is-danger"
                  aria-label="Remove this part"
                  onClick={() => setBlocks((blocks) => blocks.filter((item) => item.id !== block.id))}
                >
                  <Icon id="close" size={13} />
                </button>
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className="note-add">
        <button type="button" className="dashed-btn" onClick={addText}>
          <Icon id="plus" size={14} />
          Text
        </button>
        {dm ? (
          <>
            <button
              type="button"
              className="dashed-btn"
              disabled={uploading || !roomId}
              title={roomId ? 'Add a picture, to keep or show players as a handout' : 'Pictures need a hosted campaign'}
              onClick={() => fileRef.current?.click()}
            >
              <Icon id="image" size={14} />
              {uploading ? 'Uploading…' : 'Picture'}
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
