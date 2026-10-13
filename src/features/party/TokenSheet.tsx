import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { readPortraitFile } from '../../model/portrait.ts'
import { initiativeLeader } from '../../model/combat.ts'
import { characterNameOf, companionOwner, isCharacter, playerStatuses } from '../../model/players.ts'
import { formatSigned, initiativeBonus, normalizeStats, type CharacterStats } from '../../model/stats.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { Floor, Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useMonsterLibraryStore } from '../../state/monsterLibraryStore.ts'
import { useCanControl, useSessionStore } from '../../state/sessionStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Divider, Icon } from '../../ui/Icon.tsx'
import { Attacks } from './Attacks.tsx'
import { CreatureTraits } from './CreatureTraits.tsx'
import { Spells } from './Spells.tsx'
import { rollInitiativeFor } from './tokenRolls.ts'
import { AbilityGrid, EditableValue, HpAdjust, HpBlock, Passives } from './PlayerStats.tsx'
import { useStatEditing } from './useStatEditing.ts'
import { foeSight, placeLabel, revealTitle, tokenPlace, type FoeSight } from './tokenInfo.ts'

const CONDITIONS_SHOWN = 5

/** The character sheet or stat block for whichever token's row was opened. */
export function TokenSheet() {
  const sheetId = useEditorStore((state) => state.sheetPlayerId)
  const viewMode = useEditorStore((state) => state.viewMode)
  const player = useDungeonStore((state) => (state.dungeon.players ?? []).find((item) => item.id === sheetId))
  if (!player) return null
  // Players never see a foe's stat block.
  if (player.kind === 'monster' && viewMode === 'player') return null
  // Companions get a monster-style stat block, on the party's side of the screen.
  return player.kind === 'player' ? (
    <CharacterSheet key={player.id} player={player} />
  ) : (
    <StatBlock key={player.id} player={player} />
  )
}

function close(): void {
  useEditorStore.getState().openSheet(null)
}

function CharacterSheet({ player }: { player: Player }) {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  const editable = useCanControl(player)
  const stats = normalizeStats(player.stats)
  const { editing, setEditing, commit } = useStatEditing(player)
  const role = useSessionStore((state) => state.role)
  const dm = viewMode !== 'player' && role !== 'guest'
  const identity = [stats.race, stats.klass].filter(Boolean).join(' ')
  const subline = [identity, stats.level != null ? `Lv ${stats.level}` : ''].filter(Boolean)
  const textKeys = (event: KeyboardEvent<HTMLInputElement>) => {
    event.stopPropagation()
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key === 'Escape') setEditing(null)
  }

  return (
    <aside className="panel sheet is-party scroll-v" aria-label={`${characterNameOf(player)} character sheet`}>
      <div className="sheet-body">
        <SheetHead player={player} editable={editable} size={50}>
          <span className="sheet-sub">
            {editable && editing === 'klass' ? (
              <span className="sheet-sub-edit">
                <input
                  className="stat-input is-race"
                  defaultValue={stats.race}
                  autoFocus
                  aria-label="Race"
                  placeholder="Race"
                  // Saved without closing, so Tab moves on to the class field.
                  onBlur={(event) => useDungeonStore.getState().setPlayerStat(player.id, 'race', event.target.value)}
                  onKeyDown={textKeys}
                />
                <input
                  className="stat-input is-wide"
                  defaultValue={stats.klass}
                  aria-label="Class"
                  placeholder="Class"
                  onBlur={(event) => commit('klass', event.target.value)}
                  onKeyDown={textKeys}
                />
              </span>
            ) : (
              <button
                type="button"
                className="link-text"
                disabled={!editable}
                onClick={() => setEditing('klass')}
                title={editable ? 'Edit race and class' : undefined}
              >
                {subline.join(' · ') || (editable ? 'Add race and class' : '')}
              </button>
            )}
          </span>
          <span className="sheet-place">{placeLabel(player, floors)}</span>
        </SheetHead>

        <HpBlock player={player} stats={stats} editable={editable} editing={editing} setEditing={setEditing} />

        <div className="stat-tiles">
          <StatTile label="AC">
            <EditableValue
              label="Armor class"
              value={stats.ac}
              editing={editing === 'ac'}
              editable={editable}
              onEdit={() => setEditing('ac')}
              onCommit={(value) => commit('ac', value)}
              onCancel={() => setEditing(null)}
            />
          </StatTile>
          <InitTile player={player} stats={stats} editable={editable} editing={editing === 'initiativeRoll'} setEditing={setEditing} />
          <StatTile label="Speed" unit={stats.speed != null ? 'ft' : undefined}>
            <EditableValue
              label="Speed"
              value={stats.speed}
              editing={editing === 'speed'}
              editable={editable}
              onEdit={() => setEditing('speed')}
              onCommit={(value) => commit('speed', value)}
              onCancel={() => setEditing(null)}
            />
          </StatTile>
          <StatTile label="Level">
            <EditableValue
              label="Level"
              value={stats.level}
              editing={editing === 'level'}
              editable={editable}
              onEdit={() => setEditing('level')}
              onCommit={(value) => commit('level', value)}
              onCancel={() => setEditing(null)}
            />
          </StatTile>
        </div>

        <Divider />

        <AbilityGrid player={player} stats={stats} editable={editable} editing={editing} setEditing={setEditing} commit={commit} />
        <Passives stats={stats} editable={editable} editing={editing} setEditing={setEditing} commit={commit} />

        <Conditions player={player} />

        {player.characterId ? (
          <a
            className="outline-link"
            href={`https://www.dndbeyond.com/characters/${player.characterId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Icon id="external" size={15} />
            Open D&amp;D Beyond sheet
          </a>
        ) : null}

        {dm ? <SheetActions player={player} /> : null}
      </div>
    </aside>
  )
}

const SIGHT_LINE: Record<FoeSight, string> = {
  invisible: 'Invisible to players',
  seen: 'Players can see it',
  hidden: 'Hidden from players',
}

/** A monster's stat block, or a companion's: the same, but on the party's side and run by its owner too. */
function StatBlock({ player }: { player: Player }) {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const tokens = useDungeonStore((state) => state.dungeon.players)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const editable = useCanControl(player)
  const stats = normalizeStats(player.stats)
  const { editing, setEditing, commit } = useStatEditing(player)
  const companion = player.kind === 'companion'
  const dm = viewMode !== 'player' && role !== 'guest'
  const leader = initiativeLeader(player, tokens ?? [])

  return (
    <aside
      className={`panel sheet scroll-v ${companion ? 'is-party is-companion' : 'is-foe'}`}
      aria-label={`${characterNameOf(player)} stat block`}
    >
      <div className="sheet-body">
        <SheetHead player={player} editable={editable} size={46}>
          {editable && editing === 'klass' ? (
            <input
              className="stat-input is-wide"
              defaultValue={stats.klass}
              autoFocus
              aria-label="Creature type"
              placeholder={companion ? 'Tiny fey, familiar' : 'Medium undead, neutral evil'}
              onBlur={(event) => commit('klass', event.target.value)}
              onKeyDown={(event) => {
                event.stopPropagation()
                if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
                if (event.key === 'Escape') setEditing(null)
              }}
            />
          ) : (
            <button
              type="button"
              className="link-text sheet-type"
              disabled={!editable}
              onClick={() => setEditing('klass')}
              title={editable ? 'Edit creature type' : undefined}
            >
              {stats.klass || (editable ? 'Add creature type' : '')}
            </button>
          )}
        </SheetHead>

        {companion ? (
          <CompanionBar player={player} editable={editable} dm={dm} />
        ) : (
          <RevealBar player={player} floors={floors} tokens={tokens ?? []} />
        )}

        {/* The same readout and tiles as a character sheet, so numbers read alike for party and foes. */}
        <HpBlock player={player} stats={stats} editable={editable} editing={editing} setEditing={setEditing} />
        {/* Right under the bar it changes, so a hit is applied without scrolling. */}
        {editable ? <HpAdjust player={player} stats={stats} /> : null}

        <div className="stat-tiles is-three">
          <StatTile label="AC">
            <EditableValue
              label="Armor class"
              value={stats.ac}
              editing={editing === 'ac'}
              editable={editable}
              onEdit={() => setEditing('ac')}
              onCommit={(value) => commit('ac', value)}
              onCancel={() => setEditing(null)}
            />
          </StatTile>
          <InitTile
            player={player}
            stats={stats}
            editable={editable}
            editing={editing === 'initiativeRoll'}
            setEditing={setEditing}
            leader={leader}
          />
          <StatTile label="Speed" unit={stats.speed != null ? 'ft' : undefined}>
            <EditableValue
              label="Speed"
              value={stats.speed}
              editing={editing === 'speed'}
              editable={editable}
              onEdit={() => setEditing('speed')}
              onCommit={(value) => commit('speed', value)}
              onCancel={() => setEditing(null)}
            />
          </StatTile>
        </div>

        {companion ? <Divider /> : <Divider tone="foe" />}

        <AbilityGrid player={player} stats={stats} editable={editable} editing={editing} setEditing={setEditing} commit={commit} />

        <CreatureTraits player={player} stats={stats} editable={editable} />

        <Attacks player={player} stats={stats} editable={editable} />

        <Spells player={player} stats={stats} editable={editable} />

        <Conditions player={player} />

        {(editable && !leader) || dm ? (
          <div className="sheet-actions">
            {/* A companion on its owner's turn goes on their roll. */}
            {leader ? null : (
              <button
                type="button"
                className="outline-btn"
                disabled={!editable || player.initiativeRoll != null}
                title={player.initiativeRoll != null ? `Rolled ${player.initiativeRoll}` : undefined}
                onClick={() => rollInitiativeFor([player])}
              >
                <Icon id="d20" size={15} />
                {player.initiativeRoll != null ? `Initiative ${player.initiativeRoll}` : 'Roll initiative'}
              </button>
            )}
            {/* Like a character, a companion is the DM's to remove. */}
            {dm ? <RemoveButton player={player} /> : null}
          </div>
        ) : null}
        {/* The libraries are the DM's, kept with their account. */}
        {editable && role !== 'guest' ? (
          <div className="sheet-actions">
            {companion && dm ? <VisibleButton player={player} /> : null}
            <SaveTemplateButton player={player} />
          </div>
        ) : null}
        <LibraryError />
      </div>
    </aside>
  )
}

/** What players see of a monster right now, and the DM's switch to reveal it out of sight. */
function RevealBar({ player, floors, tokens }: { player: Player; floors: readonly Floor[]; tokens: readonly Player[] }) {
  const visible = player.visible === true
  const sight = foeSight(player, floors, tokens)
  const room = tokenPlace(player, floors).room
  return (
    <div className="reveal-bar">
      <span>
        <Icon id={sight === 'seen' ? 'eye' : 'eyeOff'} size={15} />
        {SIGHT_LINE[sight]}
        {room ? ` · ${room.name}` : ''}
      </span>
      <button
        type="button"
        className="chip-btn"
        aria-pressed={visible}
        title={revealTitle(characterNameOf(player), visible)}
        onClick={() => useDungeonStore.getState().setPlayerVisible(player.id, !visible)}
      >
        {visible ? 'Revealed' : 'Reveal'}
      </button>
    </div>
  )
}

/**
 * Whose companion this is (the DM picks) and whether it acts on their turn
 * (the DM or its owner picks). Without an owner it always rolls its own.
 */
function CompanionBar({ player, editable, dm }: { player: Player; editable: boolean; dm: boolean }) {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const owner = companionOwner(player, tokens)
  const characters = tokens.filter(isCharacter)
  const follows = player.followsOwner === true && owner !== undefined
  const store = useDungeonStore.getState()
  return (
    <div className="reveal-bar">
      {dm ? (
        <label className="companion-of">
          <Icon id="person" size={15} />
          <select
            className="tileset-select"
            aria-label="Whose companion"
            value={owner?.id ?? ''}
            onChange={(event) => store.setCompanionOwner(player.id, event.target.value || null)}
          >
            {characters.map((token) => (
              <option key={token.id} value={token.id}>
                {characterNameOf(token)}&apos;s companion
              </option>
            ))}
            <option value="">No one&apos;s: you run it</option>
          </select>
        </label>
      ) : (
        <span>
          <Icon id="person" size={15} />
          {owner ? `${characterNameOf(owner)}'s companion` : 'Companion'}
        </span>
      )}
      {owner ? (
        <button
          type="button"
          className={`chip-btn${follows ? ' is-primary' : ''}`}
          aria-pressed={follows}
          disabled={!editable}
          title={
            follows
              ? `Acts on ${characterNameOf(owner)}'s turn; click to roll its own initiative instead`
              : `Rolls its own initiative; click to act on ${characterNameOf(owner)}'s turn instead`
          }
          onClick={() => store.setCompanionFollows(player.id, !follows)}
        >
          {follows ? 'On their turn' : 'Own initiative'}
        </button>
      ) : null}
    </div>
  )
}

function SheetHead({
  player,
  editable,
  size,
  children,
}: {
  player: Player
  editable: boolean
  size: number
  children: ReactNode
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState(false)
  const name = characterNameOf(player)
  // Monsters and companions have one name; a character's player keeps theirs.
  const creature = player.kind !== 'player'

  async function onPortrait(file: File | undefined): Promise<void> {
    if (!file) return
    const portrait = await readPortraitFile(file)
    useDungeonStore.getState().setPlayerPortrait(player.id, portrait)
  }

  function commitName(value: string): void {
    const store = useDungeonStore.getState()
    store.renameCharacter(player.id, value)
    if (creature) store.renamePlayer(player.id, value)
    setRenaming(false)
  }

  return (
    <header className="sheet-head">
      {editable ? (
        <button
          type="button"
          className="portrait-btn"
          title="Set standee cutout"
          aria-label={`Set standee image for ${name}`}
          onClick={() => fileRef.current?.click()}
        >
          <Avatar player={player} size={size} />
        </button>
      ) : (
        <Avatar player={player} size={size} />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/*"
        hidden
        onChange={(event) => {
          void onPortrait(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      <div className="sheet-title">
        {renaming ? (
          <input
            className="name-input"
            defaultValue={name}
            autoFocus
            aria-label={creature ? 'Name' : 'Character name'}
            onBlur={(event) => commitName(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation()
              if (event.key === 'Enter') (event.target as HTMLInputElement).blur()
              if (event.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <button
            type="button"
            className="sheet-name"
            disabled={!editable}
            title={editable ? 'Double-click to rename' : undefined}
            onDoubleClick={() => editable && setRenaming(true)}
          >
            {name}
          </button>
        )}
        {children}
      </div>
      <button type="button" className="icon-btn is-boxed" aria-label="Close" title="Close" onClick={close}>
        <Icon id="close" size={15} />
      </button>
    </header>
  )
}

function StatTile({ label, unit, children }: { label: string; unit?: string; children: ReactNode }) {
  return (
    <div className="stat-tile">
      <span className="kicker">{label}</span>
      {children}
      {unit ? <span className="stat-unit">{unit}</span> : null}
    </div>
  )
}

function InitTile({
  player,
  stats,
  editable,
  editing,
  setEditing,
  leader,
}: {
  player: Player
  stats: CharacterStats
  editable: boolean
  editing: boolean
  setEditing: (key: 'initiativeRoll' | null) => void
  /** Whose turn a following companion takes; it goes on their roll. */
  leader?: Player
}) {
  const rolled = player.initiativeRoll
  const bonus = initiativeBonus(stats)
  if (leader) {
    return (
      <StatTile label="Init">
        <EditableValue
          label={`Initiative (${characterNameOf(leader)}'s)`}
          value={leader.initiativeRoll}
          display={leader.initiativeRoll != null ? `${leader.initiativeRoll}` : '–'}
          editing={false}
          editable={false}
          onEdit={() => {}}
          onCommit={() => {}}
          onCancel={() => {}}
        />
      </StatTile>
    )
  }
  return (
    <StatTile label="Init">
      <EditableValue
        label="Initiative roll"
        value={rolled}
        display={rolled != null ? `${rolled}` : bonus != null ? formatSigned(bonus) : '–'}
        editing={editing}
        editable={editable}
        onEdit={() => setEditing('initiativeRoll')}
        onCommit={(value) => {
          useDungeonStore.getState().setInitiativeRoll(player.id, value === '' ? null : Number(value))
          setEditing(null)
        }}
        onCancel={() => setEditing(null)}
      />
    </StatTile>
  )
}

function Conditions({ player }: { player: Player }) {
  const [expanded, setExpanded] = useState(false)
  const active = playerStatuses(player)
  const ordered = [
    ...STATUS_EFFECTS.filter((effect) => active.includes(effect.id)),
    ...STATUS_EFFECTS.filter((effect) => !active.includes(effect.id)),
  ]
  const limit = Math.max(CONDITIONS_SHOWN, active.length)
  const shown = expanded ? ordered : ordered.slice(0, limit)
  const more = ordered.length - shown.length

  return (
    <div className="conditions">
      <span className="kicker">Conditions</span>
      <div className="condition-list">
        {shown.map((effect) => {
          const on = active.includes(effect.id)
          return (
            <button
              key={effect.id}
              type="button"
              className={`condition${on ? ' is-on' : ''}`}
              aria-pressed={on}
              style={{ '--status': effect.color } as CSSProperties}
              onClick={() => useDungeonStore.getState().togglePlayerStatus(player.id, effect.id)}
            >
              {effect.label}
            </button>
          )
        })}
        {more > 0 ? (
          <button type="button" className="condition is-more" onClick={() => setExpanded(true)}>
            +{more} more
          </button>
        ) : expanded ? (
          <button type="button" className="condition is-more" onClick={() => setExpanded(false)}>
            Fewer
          </button>
        ) : null}
      </div>
    </div>
  )
}

function SheetActions({ player }: { player: Player }) {
  return (
    <div className="sheet-actions">
      <VisibleButton player={player} />
      <RemoveButton player={player} />
    </div>
  )
}

/** The DM hides or shows a party token (a character or companion) to players. */
function VisibleButton({ player }: { player: Player }) {
  const visible = player.visible === true
  return (
    <button
      type="button"
      className="outline-btn"
      onClick={() => useDungeonStore.getState().setPlayerVisible(player.id, !visible)}
    >
      <Icon id={visible ? 'eye' : 'eyeOff'} size={15} />
      {visible ? 'Visible to players' : 'Hidden from players'}
    </button>
  )
}

/**
 * Saves the monster to the DM's Monster library, standee, stats and attacks.
 * A template of the same name is replaced, so tweaking and saving again updates it.
 */
function SaveTemplateButton({ player }: { player: Player }) {
  const existing = useMonsterLibraryStore((state) => state.matchFor(player))
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const name = characterNameOf(player)

  async function save(): Promise<void> {
    setStatus('saving')
    const saved = await useMonsterLibraryStore.getState().saveToken(player)
    setStatus(saved ? 'saved' : 'idle')
    if (saved) window.setTimeout(() => setStatus((now) => (now === 'saved' ? 'idle' : now)), 1600)
  }

  return (
    <button
      type="button"
      className="outline-btn"
      disabled={status === 'saving'}
      title={
        existing
          ? `Replace "${existing.name}" in your Monster library with this stat block`
          : `Save ${name} to your Monster library, to place again on any map`
      }
      onClick={() => void save()}
    >
      <Icon id="save" size={15} />
      {status === 'saved' ? 'Saved' : status === 'saving' ? 'Saving…' : existing ? 'Update library' : 'Save to library'}
    </button>
  )
}

function LibraryError() {
  const error = useMonsterLibraryStore((state) => state.error)
  return error ? <p className="panel-note is-error">{error}</p> : null
}

function RemoveButton({ player }: { player: Player }) {
  const name = characterNameOf(player)
  return (
    <button
      type="button"
      className="icon-btn is-danger"
      aria-label={`Remove ${name}`}
      title={`Remove ${name}`}
      onClick={() => {
        useDungeonStore.getState().deletePlayer(player.id)
        const editor = useEditorStore.getState()
        if (editor.selectedPlayerId === player.id) editor.selectPlayer(null)
        editor.openSheet(null)
      }}
    >
      <Icon id="trash" />
    </button>
  )
}
