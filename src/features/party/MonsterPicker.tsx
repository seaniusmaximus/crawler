import { useEffect, useState, type KeyboardEvent } from 'react'
import { LIBRARY_NAME, type MonsterTemplate, type TemplateKind } from '../../model/monsterTemplates.ts'
import { characterNameOf, isCharacter } from '../../model/players.ts'
import { useAccountStore } from '../../state/accountStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore, type CreaturePicker } from '../../state/editorStore.ts'
import { useMonsterLibraryStore } from '../../state/monsterLibraryStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { placeCreature } from './addMonster.ts'

/** Words that differ between the two pickers. */
const WORDS: Record<TemplateKind, { one: string; many: string }> = {
  monster: { one: 'monster', many: 'monsters' },
  companion: { one: 'companion', many: 'companions' },
}

/**
 * The Add monster or Add companion dialog: the DM's saved ones from that
 * library, searchable, plus a blank one. Companions also say whose they are.
 */
export function MonsterPicker() {
  const picker = useEditorStore((state) => state.creaturePicker)
  // Keyed by kind, so switching from one picker to the other starts afresh.
  return picker ? <PickerDialog key={picker.kind} picker={picker} /> : null
}

function PickerDialog({ picker }: { picker: CreaturePicker }) {
  const { kind } = picker
  const words = WORDS[kind]
  const library = useMonsterLibraryStore((state) => state.monsters)
  const monsters = library.filter((template) => template.kind === kind)
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const characters = tokens.filter(isCharacter)
  const [ownerId, setOwnerId] = useState<string | null>(picker.ownerId)
  // The owner may have left the map while the dialog was open.
  const owner = characters.find((token) => token.id === ownerId)
  const where = useMonsterLibraryStore((state) => state.where)
  const error = useMonsterLibraryStore((state) => state.error)
  const signInAvailable = useAccountStore((state) => state.signInAvailable)
  const [query, setQuery] = useState('')
  const [placeError, setPlaceError] = useState<string | null>(null)
  /** How many of each were placed while the dialog has been open, keyed by template id ('blank' for blank ones). */
  const [placed, setPlaced] = useState<Record<string, number>>({})
  const [lastPlaced, setLastPlaced] = useState<string | null>(null)
  const totalPlaced = Object.values(placed).reduce((sum, n) => sum + n, 0)
  /** A template whose delete button was pressed once: the second press deletes. */
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const needle = query.trim().toLowerCase()
  const shown = needle
    ? monsters.filter((item) => item.name.toLowerCase().includes(needle) || item.stats.klass.toLowerCase().includes(needle))
    : monsters
  const close = () => useEditorStore.getState().setCreaturePicker(null)

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.code === 'Escape') useEditorStore.getState().setCreaturePicker(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Stays open after each one, so a pack of goblins is a few clicks.
  function pick(template: MonsterTemplate | undefined): void {
    const name = placeCreature(kind, template, owner?.id ?? null)
    if (!name) {
      setPlaceError('No free floor tile on this floor to stand it on')
      return
    }
    const key = template?.id ?? 'blank'
    setPlaced((now) => ({ ...now, [key]: (now[key] ?? 0) + 1 }))
    setLastPlaced(name)
    setPlaceError(null)
  }

  function searchKeys(event: KeyboardEvent<HTMLInputElement>): void {
    // The map's shortcuts stay out of the way while typing.
    event.stopPropagation()
    if (event.key === 'Escape') close()
    // Enter places the best match, so "gob⏎" is all it takes.
    if (event.key === 'Enter' && shown.length > 0) pick(shown[0])
  }

  return (
    <div className="dialog-backdrop" onPointerDown={close} role="presentation">
      <div
        className={`dialog monster-dialog is-${kind}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="monster-picker-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <header className="monster-dialog-head">
          <h2 id="monster-picker-title">Add a {words.one}</h2>
          <button type="button" className="icon-btn is-boxed" aria-label="Close" title="Close" onClick={close}>
            <Icon id="close" size={15} />
          </button>
        </header>

        {kind === 'companion' ? (
          <label className="companion-owner">
            <span className="kicker">Companion of</span>
            <select
              className="tileset-select"
              value={owner?.id ?? ''}
              onChange={(event) => setOwnerId(event.target.value || null)}
            >
              {characters.map((token) => (
                <option key={token.id} value={token.id}>
                  {characterNameOf(token)}
                </option>
              ))}
              <option value="">No one — the DM runs it</option>
            </select>
            <span className="companion-owner-note">
              {owner
                ? `Stands beside ${characterNameOf(owner)}, acts on their turn, and they can run it`
                : 'Rolls its own initiative; only you run it'}
            </span>
          </label>
        ) : null}

        <input
          className="monster-search"
          type="search"
          value={query}
          autoFocus
          placeholder={`Search ${monsters.length} saved ${monsters.length === 1 ? words.one : words.many}`}
          aria-label={`Search saved ${words.many}`}
          onChange={(event) => {
            setQuery(event.target.value)
            setConfirmId(null)
          }}
          onKeyDown={searchKeys}
        />

        <ul className="monster-grid" aria-label={`Saved ${words.many}`}>
          <li>
            <button type="button" className="monster-card is-blank" onClick={() => pick(undefined)}>
              <span className="monster-blank-icon">
                <Icon id="plus" size={18} />
              </span>
              <span className="monster-copy">
                <span className="monster-name">Blank {words.one}</span>
                <span className="monster-sub">Fill in its stat block</span>
              </span>
              <PlacedBadge count={placed.blank} />
            </button>
          </li>
          {shown.map((template) => (
            <li key={template.id} className="monster-cell">
              <button
                type="button"
                className="monster-card"
                title={kind === 'companion' && owner ? `Place ${template.name} beside ${characterNameOf(owner)}` : `Place a ${template.name} on this floor`}
                onClick={() => pick(template)}
              >
                <Avatar player={{ ...template, characterName: template.name }} size={36} />
                <span className="monster-copy">
                  <span className="monster-name">{template.name}</span>
                  <span className="monster-sub">{summary(template)}</span>
                </span>
                <PlacedBadge count={placed[template.id]} />
              </button>
              <button
                type="button"
                className={`monster-delete${confirmId === template.id ? ' is-confirm' : ''}`}
                aria-label={confirmId === template.id ? `Confirm delete ${template.name}` : `Delete ${template.name}`}
                title={
                  confirmId === template.id
                    ? `Click again to delete it from your library (${words.many} already placed stay)`
                    : `Delete ${template.name} from your library`
                }
                onClick={() => {
                  if (confirmId !== template.id) {
                    setConfirmId(template.id)
                    return
                  }
                  useMonsterLibraryStore.getState().remove(template.id)
                  setConfirmId(null)
                }}
              >
                {confirmId === template.id ? 'Delete?' : <Icon id="trash" size={14} />}
              </button>
            </li>
          ))}
        </ul>
        {needle && shown.length === 0 ? (
          <p className="monster-none">
            No saved {words.one} matches “{query.trim()}”
          </p>
        ) : null}

        {placeError || error ? <p className="panel-note is-error">{placeError ?? error}</p> : null}
        <p className="monster-foot">
          {where === 'browser' && signInAvailable
            ? 'Saved in this browser. Sign in to keep them with your account.'
            : `Save more to your ${LIBRARY_NAME[kind]} from any ${words.one}’s stat block with Save to library.`}
        </p>

        <footer className="monster-dialog-foot">
          <span className="monster-status" aria-live="polite">
            {lastPlaced ? (
              <>
                <Icon id="plus" size={13} />
                Placed {lastPlaced}
                {totalPlaced > 1 ? <span> · {totalPlaced} added</span> : null}
              </>
            ) : (
              `Click a ${words.one} to place it; add as many as you like`
            )}
          </span>
          <button type="button" className="dialog-button is-primary" onClick={close}>
            Done
          </button>
        </footer>
      </div>
    </div>
  )
}

/** How many of this one were placed since the dialog opened. */
function PlacedBadge({ count }: { count: number | undefined }) {
  return count ? (
    <span className="monster-placed" title={`${count} placed`}>
      ×{count}
    </span>
  ) : null
}

function summary(template: MonsterTemplate): string {
  const { stats, attacks, spells } = template
  return [
    stats.ac != null ? `AC ${stats.ac}` : '',
    stats.hpMax != null ? `HP ${stats.hpMax}` : '',
    attacks.length ? `${attacks.length} attack${attacks.length === 1 ? '' : 's'}` : '',
    spells.length ? `${spells.length} spell${spells.length === 1 ? '' : 's'}` : '',
  ]
    .filter(Boolean)
    .join(' · ') || stats.klass || 'No stats yet'
}
