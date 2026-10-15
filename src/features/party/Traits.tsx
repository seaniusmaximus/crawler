import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react'
import { MAX_TRAIT_NAME, MAX_TRAIT_TEXT, MAX_TRAITS, newTrait, type Trait } from '../../model/traits.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { NotesToggle, RowNotes } from './RowNotes.tsx'

/**
 * A stat block's traits, written as a stat block does ("Pack Tactics. The wolf
 * has advantage…"): open notes on what the creature can do or simply is.
 * Whoever may edit the block clicks one to rewrite it.
 */
export function Traits({ player, editable }: { player: Player; editable: boolean }) {
  const traits = player.traits ?? []
  /** The trait being written; a new one isn't in the list until it's done. */
  const [editing, setEditing] = useState<Trait | null>(null)

  if (!editable && traits.length === 0) return null

  function save(next: Trait[]): void {
    useDungeonStore.getState().setPlayerTraits(player.id, next)
  }

  function done(changed: Trait): void {
    const empty = !changed.name && !changed.text
    const known = traits.some((item) => item.id === changed.id)
    if (empty) save(traits.filter((item) => item.id !== changed.id))
    else save(known ? traits.map((item) => (item.id === changed.id ? changed : item)) : [...traits, changed])
    setEditing(null)
  }

  const adding = editing != null && !traits.some((item) => item.id === editing.id)

  return (
    <div className="attacks traits-notes">
      <span className="kicker">Traits</span>
      {traits.length === 0 && !adding ? <p className="attacks-empty">No traits yet</p> : null}
      {traits.map((trait) =>
        editable && editing?.id === trait.id ? (
          <TraitForm
            key={trait.id}
            trait={trait}
            onDone={done}
            onCancel={() => setEditing(null)}
            onRemove={() => {
              save(traits.filter((item) => item.id !== trait.id))
              setEditing(null)
            }}
          />
        ) : (
          <TraitNote key={trait.id} trait={trait} editable={editable} onEdit={() => setEditing(trait)} />
        ),
      )}
      {adding ? (
        <TraitForm trait={editing} onDone={done} onCancel={() => setEditing(null)} onRemove={() => setEditing(null)} />
      ) : null}
      {editable && traits.length < MAX_TRAITS && editing == null ? (
        <button type="button" className="dashed-btn attacks-add" onClick={() => setEditing(newTrait())}>
          <Icon id="plus" size={15} />
          Add trait
        </button>
      ) : null}
    </div>
  )
}

/**
 * A trait kept to one row: its name over the start of its text. The chevron
 * opens the whole text, and only shows when the text runs past the row.
 */
function TraitNote({ trait, editable, onEdit }: { trait: Trait; editable: boolean; onEdit: () => void }) {
  const [open, setOpen] = useState(false)
  const [clipped, setClipped] = useState(false)
  const preview = useRef<HTMLSpanElement>(null)

  useLayoutEffect(() => {
    const element = preview.current
    if (!element) return
    const check = () => setClipped(element.scrollWidth > element.clientWidth || trait.text.includes('\n'))
    check()
    const observer = new ResizeObserver(check)
    observer.observe(element)
    return () => observer.disconnect()
  }, [trait.text, open])

  return (
    <div className="spell-row">
      <div className="attack-row">
        <span className="attack-copy">
          {trait.name ? <span className="attack-name">{trait.name}</span> : null}
          {trait.text && !open ? (
            <span ref={preview} className="attack-sub">
              {trait.text}
            </span>
          ) : null}
        </span>
        {trait.text && (clipped || open) ? <NotesToggle open={open} name={trait.name} onToggle={() => setOpen(!open)} /> : null}
        {editable ? (
          <button type="button" className="icon-btn" aria-label={`Edit ${trait.name || 'trait'}`} title="Edit trait" onClick={onEdit}>
            <Icon id="pencil" size={14} />
          </button>
        ) : null}
      </div>
      {trait.text && open ? <RowNotes text={trait.text} /> : null}
    </div>
  )
}

function TraitForm({
  trait,
  onDone,
  onCancel,
  onRemove,
}: {
  trait: Trait
  onDone: (trait: Trait) => void
  onCancel: () => void
  onRemove: () => void
}) {
  const [draft, setDraft] = useState(trait)

  function submit(event: { preventDefault: () => void }): void {
    event.preventDefault()
    onDone({ ...draft, name: draft.name.trim(), text: draft.text.trim() })
  }

  // The map's shortcuts stay out of the way while typing; Ctrl+Enter finishes from the notes.
  function keys(event: KeyboardEvent<HTMLElement>): void {
    event.stopPropagation()
    if (event.key === 'Escape') onCancel()
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) submit(event)
  }

  return (
    <form className="attack-form" onSubmit={submit} onKeyDown={keys}>
      <input
        className="stat-input attack-name-input"
        value={draft.name}
        maxLength={MAX_TRAIT_NAME}
        autoFocus
        aria-label="Trait name"
        placeholder="Pack Tactics"
        onChange={(event) => setDraft({ ...draft, name: event.target.value })}
      />
      <textarea
        className="stat-input trait-text-input"
        value={draft.text}
        maxLength={MAX_TRAIT_TEXT}
        rows={4}
        aria-label="Trait notes"
        placeholder="What it can do, or just what it's like: has advantage on attacks when an ally is within 5 ft…"
        onChange={(event) => setDraft({ ...draft, text: event.target.value })}
      />
      <div className="attack-form-actions">
        <button type="button" className="icon-btn is-danger" aria-label="Remove trait" title="Remove trait" onClick={onRemove}>
          <Icon id="trash" size={15} />
        </button>
        <button type="button" className="chip-btn" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="chip-btn is-primary">
          Done
        </button>
      </div>
    </form>
  )
}
