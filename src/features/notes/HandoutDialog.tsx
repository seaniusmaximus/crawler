import { useEffect, useState } from 'react'
import { useNotesStore } from '../../state/notesStore.ts'
import { NoteBlocks } from './NoteBlocks.tsx'

/** A handout the DM put up on everyone's screen; players can keep a copy in their notebook. */
export function HandoutDialog() {
  const handout = useNotesStore((state) => state.handouts[0])
  const ready = useNotesStore((state) => state.ready)
  const close = useNotesStore((state) => state.closeHandout)
  const [kept, setKept] = useState<string | null>(null)

  useEffect(() => {
    if (!handout) return
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handout, close])

  if (!handout) return null

  function keep(): void {
    if (!handout) return
    useNotesStore.getState().create({
      title: handout.title,
      folder: 'Handouts',
      blocks: handout.blocks.map((block) => ({ ...block, shared: false })),
    })
    // Stay on the handout rather than jumping into the notebook.
    useNotesStore.getState().closePanel()
    setKept(handout.id)
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close} role="presentation">
      <div
        className="dialog handout-dialog scroll-v"
        role="dialog"
        aria-labelledby="handout-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <span className="kicker">The DM shows the table</span>
        {handout.title ? <h2 id="handout-title">{handout.title}</h2> : null}
        <div className="handout-body">
          <NoteBlocks blocks={handout.blocks} />
        </div>
        <div className="dialog-actions">
          {ready ? (
            <button type="button" className="outline-btn" disabled={kept === handout.id} onClick={keep}>
              {kept === handout.id ? 'Kept in your notes' : 'Keep in my notes'}
            </button>
          ) : null}
          <button type="button" className="chip-btn is-gold" onClick={close}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
