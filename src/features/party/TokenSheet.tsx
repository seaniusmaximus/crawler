import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { readPortraitFile } from '../../model/portrait.ts'
import { characterNameOf, playerStatuses } from '../../model/players.ts'
import { formatSigned, hpRatio, normalizeStats, type CharacterStats } from '../../model/stats.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Divider, Icon } from '../../ui/Icon.tsx'
import { rollInitiativeFor } from './tokenRolls.ts'
import { AbilityGrid, EditableValue, HpAdjust, HpBlock, Passives } from './PlayerStats.tsx'
import { useStatEditing } from './useStatEditing.ts'
import { hpTone, placeLabel, tokenPlace } from './tokenInfo.ts'

const CONDITIONS_SHOWN = 5

/** The character sheet or stat block for whichever token's row was opened. */
export function TokenSheet() {
  const sheetId = useEditorStore((state) => state.sheetPlayerId)
  const viewMode = useEditorStore((state) => state.viewMode)
  const player = useDungeonStore((state) => (state.dungeon.players ?? []).find((item) => item.id === sheetId))
  if (!player) return null
  const monster = player.kind === 'monster'
  // Players never see a foe's stat block.
  if (monster && viewMode === 'player') return null
  return monster ? <StatBlock key={player.id} player={player} /> : <CharacterSheet key={player.id} player={player} />
}

function close(): void {
  useEditorStore.getState().openSheet(null)
}

function useCanEdit(player: Player): boolean {
  const role = useSessionStore((state) => state.role)
  const mine = useSessionStore((state) => state.myPlayerId === player.id)
  return role !== 'guest' || mine
}

function CharacterSheet({ player }: { player: Player }) {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  const editable = useCanEdit(player)
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

function StatBlock({ player }: { player: Player }) {
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const editable = useCanEdit(player)
  const stats = normalizeStats(player.stats)
  const { editing, setEditing, commit } = useStatEditing(player)
  const visible = player.visible === true
  const room = tokenPlace(player, floors).room
  const ratio = hpRatio(stats.hp, stats.hpMax)

  return (
    <aside className="panel sheet is-foe scroll-v" aria-label={`${characterNameOf(player)} stat block`}>
      <div className="sheet-body">
        <SheetHead player={player} editable={editable} size={46}>
          {editable && editing === 'klass' ? (
            <input
              className="stat-input is-wide"
              defaultValue={stats.klass}
              autoFocus
              aria-label="Creature type"
              placeholder="Medium undead, neutral evil"
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

        <div className="reveal-bar">
          <span>
            <Icon id={visible ? 'eye' : 'eyeOff'} size={15} />
            {visible ? 'Visible to players' : 'Hidden from players'}
            {room ? ` · ${room.name}` : ''}
          </span>
          <button
            type="button"
            className="chip-btn"
            onClick={() => useDungeonStore.getState().setPlayerVisible(player.id, !visible)}
          >
            {visible ? 'Hide' : 'Reveal'}
          </button>
        </div>

        <Divider tone="foe" />

        <div className="block-lines">
          <div>
            <span className="block-label">Armor Class</span>{' '}
            <EditableValue
              label="Armor class"
              value={stats.ac}
              editing={editing === 'ac'}
              editable={editable}
              className="is-inline"
              onEdit={() => setEditing('ac')}
              onCommit={(value) => commit('ac', value)}
              onCancel={() => setEditing(null)}
            />
          </div>
          <div className="block-hp">
            <span className="block-label">Hit Points</span>
            <EditableValue
              label="Hit points"
              value={stats.hp}
              display={`${stats.hp ?? '–'} / ${stats.hpMax ?? '–'}`}
              editing={editing === 'hp'}
              editable={editable}
              className="is-inline"
              onEdit={() => setEditing('hp')}
              onCommit={(value) => commit('hp', value)}
              onCancel={() => setEditing(null)}
            />
            <span className="hp-bar">
              <span className={`hp-fill is-${hpTone(stats.hp, stats.hpMax)}`} style={{ width: `${(ratio ?? 0) * 100}%` }} />
            </span>
          </div>
          <div>
            <span className="block-label">Speed</span>{' '}
            <EditableValue
              label="Speed"
              value={stats.speed}
              display={stats.speed != null ? `${stats.speed} ft` : '–'}
              editing={editing === 'speed'}
              editable={editable}
              className="is-inline"
              onEdit={() => setEditing('speed')}
              onCommit={(value) => commit('speed', value)}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>

        <Divider tone="foe" />

        <AbilityGrid player={player} stats={stats} editable={editable} editing={editing} setEditing={setEditing} commit={commit} />

        {editable ? <HpAdjust player={player} stats={stats} /> : null}

        <Conditions player={player} />

        <div className="sheet-actions">
          <button
            type="button"
            className="outline-btn"
            disabled={player.initiativeRoll != null}
            title={player.initiativeRoll != null ? `Rolled ${player.initiativeRoll}` : undefined}
            onClick={() => rollInitiativeFor([player])}
          >
            <Icon id="d20" size={15} />
            {player.initiativeRoll != null ? `Initiative ${player.initiativeRoll}` : 'Roll initiative'}
          </button>
          <RemoveButton player={player} />
        </div>
      </div>
    </aside>
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
  const monster = player.kind === 'monster'

  async function onPortrait(file: File | undefined): Promise<void> {
    if (!file) return
    const portrait = await readPortraitFile(file)
    useDungeonStore.getState().setPlayerPortrait(player.id, portrait)
  }

  function commitName(value: string): void {
    const store = useDungeonStore.getState()
    store.renameCharacter(player.id, value)
    if (monster) store.renamePlayer(player.id, value)
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
            aria-label={monster ? 'Monster name' : 'Character name'}
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
}: {
  player: Player
  stats: CharacterStats
  editable: boolean
  editing: boolean
  setEditing: (key: 'initiativeRoll' | null) => void
}) {
  const rolled = player.initiativeRoll
  return (
    <StatTile label="Init">
      <EditableValue
        label="Initiative roll"
        value={rolled}
        display={rolled != null ? `${rolled}` : stats.initiative != null ? formatSigned(stats.initiative) : '–'}
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
  const visible = player.visible === true
  return (
    <div className="sheet-actions">
      <button
        type="button"
        className="outline-btn"
        onClick={() => useDungeonStore.getState().setPlayerVisible(player.id, !visible)}
      >
        <Icon id={visible ? 'eye' : 'eyeOff'} size={15} />
        {visible ? 'Visible to players' : 'Hidden from players'}
      </button>
      <RemoveButton player={player} />
    </div>
  )
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
