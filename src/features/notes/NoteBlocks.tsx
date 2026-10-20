import { useEffect, useState } from 'react'
import type { NoteBlock } from '../../model/notes.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { Icon } from '../../ui/Icon.tsx'

/** A note's words and pictures, to read. */
export function NoteBlocks({ blocks }: { blocks: readonly NoteBlock[] }) {
  if (!blocks.length) return <p className="panel-empty">Nothing written yet.</p>
  return (
    <div className="note-read-blocks">
      {blocks.map((block) =>
        block.kind === 'text' ? (
          block.text.trim() ? (
            <div key={block.id} className="note-read-text">
              {block.text.split(/\n{2,}/).map((paragraph, index) => (
                <p key={index}>{paragraph}</p>
              ))}
            </div>
          ) : null
        ) : (
          <figure key={block.id} className="note-read-image">
            <ImageThumb src={block.src} caption={block.caption} />
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>
        ),
      )}
    </div>
  )
}

/** A picture in a note: click to see it full size. */
export function ImageThumb({ src, caption }: { src: string; caption: string }) {
  return (
    <button
      type="button"
      className="note-thumb"
      title="Click to see full size"
      onClick={() => useNotesStore.getState().openImage({ src, caption })}
    >
      <img src={src} alt={caption || 'Picture'} loading="lazy" />
      <span className="note-thumb-zoom" aria-hidden>
        <Icon id="resize" size={13} />
      </span>
    </button>
  )
}

/**
 * A picture from a note over everything, as big as the window allows; click it
 * to see it at its real size (scrolling if it's bigger than the window).
 */
export function ImageLightbox() {
  const image = useNotesStore((state) => state.image)
  // Keyed, so each picture opens fitted to the window.
  return image ? <Lightbox key={image.src} image={image} /> : null
}

function Lightbox({ image }: { image: { src: string; caption: string } }) {
  const close = useNotesStore((state) => state.closeImage)
  const [actual, setActual] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') {
        event.stopPropagation()
        close()
      }
    }
    // Ahead of the dialogs beneath, so Escape closes only the picture.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [close])

  return (
    <div className={`lightbox${actual ? ' is-actual' : ''}`} role="dialog" aria-label={image.caption || 'Picture'} onPointerDown={close}>
      <div className="lightbox-bar" onPointerDown={(event) => event.stopPropagation()}>
        <span className="lightbox-caption">{image.caption}</span>
        <button type="button" className="text-btn" onClick={() => setActual(!actual)}>
          {actual ? 'Fit to window' : 'Actual size'}
        </button>
        <a className="text-btn" href={image.src} target="_blank" rel="noreferrer">
          Open in new tab
        </a>
        <button type="button" className="icon-btn" aria-label="Close" onClick={close}>
          <Icon id="close" size={16} />
        </button>
      </div>
      <div className="lightbox-stage">
        <img
          src={image.src}
          alt={image.caption || 'Picture'}
          title={actual ? 'Click to fit the window' : 'Click for actual size'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => setActual(!actual)}
        />
      </div>
    </div>
  )
}
