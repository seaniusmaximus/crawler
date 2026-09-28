import { useRef, useState } from 'react'
import { sortByInitiative } from '../../model/combat.ts'
import { rollLocal } from '../../model/dice.ts'
import { readPortraitFile } from '../../model/portrait.ts'
import {
  characterNameOf,
  monsterMembers,
  occupantRoom,
  partyMembers,
  playerInitials,
} from '../../model/players.ts'
import { normalizeStats } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { roomRevealed, tokenRevealed } from '../../model/visibility.ts'
import { useDiceStore } from '../../state/diceStore.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { getActiveFloor } from '../../state/selectors.ts'
import { MenuIcon } from '../menus/radialIcons.tsx'
import { PlayerStats } from './PlayerStats.tsx'

export function PartyList({ leftInset }: { leftInset: number }) {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const ordered = sortByInitiative(tokens)
  const ranks = new Map(ordered.map((token, index) => [token.id, index + 1]))
  const visibleOnMap = (player: Player): boolean => {
    if (viewMode !== 'player') return true
    if (!tokenRevealed(player)) return false
    const floor = floors.find((item) => item.id === player.floorId)
    if (!floor) return false
    const room = occupantRoom(floor.rooms, player.x, player.y)
    return !room || roomRevealed(room)
  }
  const party = partyMembers(ordered).filter(visibleOnMap)
  const monsters = monsterMembers(ordered).filter(visibleOnMap)
  const canRun = role !== 'guest'
  const hasRolls = tokens.some((token) => token.initiativeRoll != null)
  const showMonsters = viewMode !== 'player' || monsters.length > 0

  function addPlayer(): void {
    const id = useDungeonStore.getState().addPlayer(getActiveFloor().id)
    if (id) useEditorStore.getState().selectPlayer(id)
  }

  function addMonster(): void {
    const id = useDungeonStore.getState().addMonster(getActiveFloor().id)
    if (id) useEditorStore.getState().selectPlayer(id)
  }

  function rollOutstanding(): void {
    for (const token of tokens) {
      if (token.initiativeRoll != null) continue
      const bonus = normalizeStats(token.stats).initiative ?? 0
      const roll = rollLocal(1, 20, bonus)
      useDiceStore.getState().ingest({
        ...roll,
        title: 'Initiative',
        kind: 'initiative',
        character: characterNameOf(token),
        characterId: token.characterId ?? undefined,
      })
    }
  }

  return (
    <>
      <section className="party">
        <header className="party-head">
          <span>Party</span>
          {viewMode === 'player' ? null : (
            <button type="button" className="party-add" onClick={addPlayer}>
              Add
            </button>
          )}
        </header>
        {canRun && tokens.length > 0 ? (
          <div className="party-turn">
            <button type="button" className="party-add" onClick={rollOutstanding}>
              Roll init
            </button>
            <button type="button" className="party-add" onClick={() => useDungeonStore.getState().advanceTurn()}>
              Next
            </button>
            {hasRolls ? (
              <button type="button" className="party-add" onClick={() => useDungeonStore.getState().clearInitiative()}>
                Clear
              </button>
            ) : null}
          </div>
        ) : null}
        {party.length === 0 ? (
          <p className="party-empty">
            {viewMode === 'player'
              ? 'No visible players'
              : 'Add a player, then drag their token onto a floor tile'}
          </p>
        ) : (
          party.map((player) => (
            <PlayerCard
              key={player.id}
              player={player}
              variant="player"
              rank={hasRolls ? ranks.get(player.id) ?? null : null}
              active={turnPlayerId === player.id}
              leftInset={leftInset}
            />
          ))
        )}
      </section>
      {showMonsters ? (
        <section className="party">
          <header className="party-head">
            <span>Monsters</span>
            {viewMode === 'player' ? null : (
              <button type="button" className="party-add" onClick={addMonster}>
                Add
              </button>
            )}
          </header>
          {monsters.length === 0 ? (
            <p className="party-empty">
              {viewMode === 'player'
                ? 'No visible monsters'
                : 'Add a monster — hidden from players until you reveal it'}
            </p>
          ) : (
            monsters.map((player) => (
              <PlayerCard
                key={player.id}
                player={player}
                variant="monster"
                rank={hasRolls ? ranks.get(player.id) ?? null : null}
                active={turnPlayerId === player.id}
                leftInset={leftInset}
              />
            ))
          )}
        </section>
      ) : null}
    </>
  )
}

function PlayerCard({
  player,
  variant,
  rank,
  active,
  leftInset,
}: {
  player: Player
  variant: 'player' | 'monster'
  rank: number | null
  active: boolean
  leftInset: number
}) {
  const viewMode = useEditorStore((state) => state.viewMode)
  const selected = useEditorStore((state) => state.selectedPlayerId === player.id)
  const hovered = useEditorStore((state) => state.hoverPlayerId === player.id)
  const fileRef = useRef<HTMLInputElement>(null)
  const [editing, setEditing] = useState<null | 'player' | 'character'>(null)
  const [draft, setDraft] = useState('')
  const visible = player.visible === true
  const character = characterNameOf(player)
  const initials = playerInitials(character)
  const mine = useSessionStore((state) => state.myPlayerId === player.id)
  const role = useSessionStore((state) => state.role)
  const canEditNames = variant === 'monster' ? role !== 'guest' : role !== 'guest' || mine
  const monster = variant === 'monster'

  function focus(): void {
    useEditorStore.getState().focusPlayer(player.id, leftInset)
  }

  async function onPortrait(file: File | undefined): Promise<void> {
    if (!file) return
    const portrait = await readPortraitFile(file)
    useDungeonStore.getState().setPlayerPortrait(player.id, portrait)
  }

  function beginEdit(field: 'player' | 'character'): void {
    if (!canEditNames) return
    setDraft(field === 'player' ? player.name : character)
    setEditing(field)
  }

  function commitEdit(): void {
    if (editing === 'player') useDungeonStore.getState().renamePlayer(player.id, draft)
    if (editing === 'character') {
      useDungeonStore.getState().renameCharacter(player.id, draft)
      if (monster) useDungeonStore.getState().renamePlayer(player.id, draft)
    }
    setEditing(null)
  }

  function nameInput(field: 'player' | 'character') {
    return (
      <input
        className={`party-name-input is-${field}`}
        value={draft}
        autoFocus
        aria-label={field === 'player' ? 'Player name' : 'Character name'}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commitEdit}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Enter') commitEdit()
          if (event.key === 'Escape') setEditing(null)
        }}
      />
    )
  }

  return (
    <fieldset
      className={`player-card${monster ? ' is-monster' : ''}${selected ? ' is-selected' : ''}${hovered ? ' is-hovered' : ''}${active ? ' is-turn' : ''}`}
      onPointerEnter={() => useEditorStore.getState().setHoverPlayer(player.id)}
      onPointerLeave={() => useEditorStore.getState().setHoverPlayer(null)}
    >
      <legend className="player-head">
        {rank != null ? <span className="player-rank">{rank}</span> : null}
        {viewMode === 'player' ? (
          <span className="party-portrait" style={{ borderColor: player.color, background: player.color }}>
            {player.portrait ? <img src={player.portrait} alt="" /> : <span>{initials}</span>}
          </span>
        ) : (
          <button
            type="button"
            className="party-portrait"
            title="Set standee cutout"
            aria-label={`Set standee image for ${character}`}
            onClick={(event) => {
              event.stopPropagation()
              fileRef.current?.click()
            }}
            style={{ borderColor: player.color, background: player.color }}
          >
            {player.portrait ? <img src={player.portrait} alt="" /> : <span>{initials}</span>}
          </button>
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
        <div className="player-copy">
          {!monster &&
            (editing === 'player' ? (
              nameInput('player')
            ) : (
              <button
                type="button"
                className="player-user-btn"
                title={canEditNames ? 'Player name — double-click to edit' : 'Player name'}
                onClick={focus}
                onDoubleClick={() => beginEdit('player')}
              >
                {player.name}
              </button>
            ))}
          {editing === 'character' ? (
            nameInput('character')
          ) : (
            <button
              type="button"
              className="player-char-btn"
              title={canEditNames ? `${monster ? 'Monster' : 'Character'} name — double-click to edit` : 'Name'}
              onClick={focus}
              onDoubleClick={() => beginEdit('character')}
            >
              {character}
              {mine ? ' · you' : ''}
            </button>
          )}
        </div>
        {viewMode === 'player' ? null : (
          <div className="player-tools">
            <button
              type="button"
              className={`icon-btn${visible ? ' is-on' : ''}`}
              aria-pressed={visible}
              aria-label={visible ? `Hide ${character} from players` : `Reveal ${character} to players`}
              title={visible ? 'Visible to players' : 'Hidden from players'}
              onClick={(event) => {
                event.stopPropagation()
                useDungeonStore.getState().setPlayerVisible(player.id, !visible)
              }}
            >
              <MenuIcon id={visible ? 'reveal' : 'hide'} />
            </button>
            <button
              type="button"
              className="icon-btn is-danger"
              aria-label={`Remove ${character}`}
              title={monster ? 'Remove monster' : 'Remove player'}
              onClick={(event) => {
                event.stopPropagation()
                useDungeonStore.getState().deletePlayer(player.id)
                const editor = useEditorStore.getState()
                if (editor.selectedPlayerId === player.id) editor.selectPlayer(null)
              }}
            >
              <MenuIcon id="delete" />
            </button>
          </div>
        )}
      </legend>
      <PlayerStats player={player} />
    </fieldset>
  )
}
