import { Icon } from '../../ui/Icon.tsx'

/** The chevron on a stat block row that shows or hides its notes. */
export function NotesToggle({ open, name, onToggle }: { open: boolean; name: string; onToggle: () => void }) {
  const label = `${open ? 'Hide' : 'Show'} notes${name ? ` for ${name}` : ''}`
  return (
    <button type="button" className="icon-btn" aria-expanded={open} aria-label={label} title={label} onClick={onToggle}>
      <Icon id={open ? 'chevronUp' : 'chevronDown'} size={14} />
    </button>
  )
}

/** A row's notes once opened, keeping the DM's own line breaks. */
export function RowNotes({ text }: { text: string }) {
  return <p className="row-notes">{text}</p>
}
