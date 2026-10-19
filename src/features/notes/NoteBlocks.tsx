import type { NoteBlock } from '../../model/notes.ts'

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
            <a href={block.src} target="_blank" rel="noreferrer" title="Open full size">
              <img src={block.src} alt={block.caption || 'Handout'} loading="lazy" />
            </a>
            {block.caption ? <figcaption>{block.caption}</figcaption> : null}
          </figure>
        ),
      )}
    </div>
  )
}
