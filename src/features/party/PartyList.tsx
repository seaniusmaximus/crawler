import { FOCUS_INSET } from '../../app/layout.ts'
import { sortByInitiative } from '../../model/combat.ts'
import { characterNameOf, monsterMembers, partyMembers, playerStatuses } from '../../model/players.ts'
import { hpRatio, normalizeStats } from '../../model/stats.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { getActiveFloor } from '../../state/selectors.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { rollInitiativeFor } from './tokenRolls.ts'
import { hpTone, tokenPlace, tokenShown, woundLabel } from './tokenInfo.ts'

function toggleSheet(player: Player): void {
  const editor = useEditorStore.getState()
  if (editor.sheetPlayerId === player.id) {
    editor.openSheet(null)
    return
  }
  editor.openSheet(player.id)
  editor.focusPlayer(player.id, FOCUS_INSET)
}

function useOrderedTokens(): Player[] {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const viewMode = useEditorStore((state) => state.viewMode)
  return sortByInitiative(tokens).filter((token) => tokenShown(token, floors, viewMode))
}

export function PartyCard() {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const party = partyMembers(useOrderedTokens())
  const canRun = role !== 'guest' && viewMode !== 'player'

  function addPlayer(): void {
    const id = useDungeonStore.getState().addPlayer(getActiveFloor().id)
    if (id) useEditorStore.getState().selectPlayer(id)
  }

  return (
    <section className="panel token-card is-party scroll-v" aria-label="Party">
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>The Party</span>
        </h2>
      </header>

      {canRun && tokens.length > 0 ? <InitiativeBar tokens={tokens} turnPlayerId={turnPlayerId} /> : null}

      <div className="token-list">
        {party.length === 0 ? (
          <p className="panel-empty">
            {viewMode === 'player' ? 'No visible players' : 'Add a player, then drag their token onto a floor tile'}
          </p>
        ) : (
          party.map((player) => (
            <TokenRow key={player.id} player={player} turn={turnPlayerId === player.id} />
          ))
        )}
      </div>

      {canRun ? (
        <div className="panel-foot">
          <button type="button" className="dashed-btn" onClick={addPlayer}>
            <Icon id="plus" size={15} />
            Add player
          </button>
        </div>
      ) : null}
    </section>
  )
}

/**
 * The DM's combat controls, spelled out: what state initiative is in, and the
 * one or two actions that make sense from there.
 */
function InitiativeBar({ tokens, turnPlayerId }: { tokens: readonly Player[]; turnPlayerId: string | null }) {
  const current = tokens.find((token) => token.id === turnPlayerId)
  const rolled = tokens.filter((token) => token.initiativeRoll != null).length
  const unrolled = tokens.length - rolled
  const store = useDungeonStore.getState()

  if (rolled === 0) {
    return (
      <div className="init-bar">
        <div className="init-status">
          <span className="kicker">Initiative</span>
          <span className="init-state">Not rolled</span>
        </div>
        <div className="init-actions">
          <button type="button" className="init-primary" onClick={() => rollInitiativeFor(tokens)}>
            <Icon id="d20" size={15} />
            Roll initiative
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className={`init-bar${current ? ' is-live' : ''}`}>
      <div className="init-status">
        <span className="kicker">{current ? 'In combat' : 'Initiative'}</span>
        {current ? (
          <span className="init-state">
            <Avatar player={current} size={22} turn />
            <span>
              <strong>{characterNameOf(current)}</strong>&apos;s turn
            </span>
          </span>
        ) : (
          <span className="init-state">Ready to start</span>
        )}
        {unrolled > 0 ? (
          <button
            type="button"
            className="init-link"
            onClick={() => rollInitiativeFor(tokens)}
            title="Roll for everyone who has not rolled yet"
          >
            Roll {unrolled} more
          </button>
        ) : null}
      </div>
      <div className="init-actions">
        <button
          type="button"
          className="init-primary"
          onClick={() => store.advanceTurn()}
          title={current ? 'Pass the turn to the next in initiative order' : 'Begin with the highest initiative'}
        >
          {current ? 'Next turn' : 'Start'}
          <Icon id="nextTurn" size={15} />
        </button>
        <button
          type="button"
          className="init-secondary"
          onClick={() => store.clearInitiative()}
          title="End the encounter and clear everyone's initiative"
        >
          End combat
        </button>
      </div>
    </div>
  )
}

export function FoesCard() {
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const allFoes = monsterMembers(useDungeonStore((state) => state.dungeon.players ?? []))
  const foes = monsterMembers(useOrderedTokens())
  const dm = viewMode !== 'player'
  const canRun = role !== 'guest' && dm
  const hidden = allFoes.filter((foe) => foe.visible !== true).length

  if (!dm && foes.length === 0) return null

  function addMonster(): void {
    const id = useDungeonStore.getState().addMonster(getActiveFloor().id)
    if (id) useEditorStore.getState().selectPlayer(id)
  }

  return (
    <section className="panel token-card is-foes scroll-v" aria-label="Foes">
      <header className="panel-head">
        <h2 className="panel-title is-foe">
          <Diamond />
          <span>Foes</span>
        </h2>
        {dm && allFoes.length > 0 ? (
          <span className="panel-meta">
            {allFoes.length - hidden} revealed · {hidden} hidden
          </span>
        ) : null}
      </header>

      <div className="token-list">
        {foes.length === 0 ? (
          <p className="panel-empty">Add a monster — hidden from players until you reveal it</p>
        ) : dm ? (
          foes.map((foe) => <TokenRow key={foe.id} player={foe} turn={turnPlayerId === foe.id} />)
        ) : (
          foes.map((foe) => <FoeGlimpse key={foe.id} foe={foe} turn={turnPlayerId === foe.id} />)
        )}
      </div>

      {canRun ? (
        <div className="panel-foot">
          <button type="button" className="dashed-btn" onClick={addMonster}>
            <Icon id="plus" size={15} />
            Add monster
          </button>
        </div>
      ) : null}
    </section>
  )
}

function TokenRow({ player, turn }: { player: Player; turn: boolean }) {
  const open = useEditorStore((state) => state.sheetPlayerId === player.id)
  const hovered = useEditorStore((state) => state.hoverPlayerId === player.id)
  const viewMode = useEditorStore((state) => state.viewMode)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const mine = useSessionStore((state) => state.myPlayerId === player.id)
  const stats = normalizeStats(player.stats)
  const name = characterNameOf(player)
  const monster = player.kind === 'monster'
  const visible = player.visible === true
  const dm = viewMode !== 'player'
  const ratio = hpRatio(stats.hp, stats.hpMax)
  const statuses = playerStatuses(player)
  const firstStatus = STATUS_EFFECTS.find((effect) => effect.id === statuses[0])
  const room = monster ? tokenPlace(player, floors).room : undefined

  return (
    <div
      className={`token-row${open ? ' is-open' : ''}${hovered ? ' is-hovered' : ''}${mine ? ' is-mine' : ''}`}
      onPointerEnter={() => useEditorStore.getState().setHoverPlayer(player.id)}
      onPointerLeave={() => useEditorStore.getState().setHoverPlayer(null)}
    >
      <button
        type="button"
        className="token-row-main"
        aria-expanded={open}
        aria-label={monster ? `Open ${name} stat block` : `Open ${name}'s sheet`}
        onClick={() => toggleSheet(player)}
      >
        <span className={`token-init${turn ? ' is-turn' : ''}${player.initiativeRoll == null ? ' is-empty' : ''}`}>
          {player.initiativeRoll ?? '—'}
        </span>
        <Avatar player={player} turn={turn} dim={dm && !visible} />
        <span className={`token-copy${dm && !visible ? ' is-dim' : ''}`}>
          <span className="token-line">
            <span className="token-name-wrap">
              <span className="token-name">
                {name}
                {mine ? <em> · you</em> : null}
              </span>
              {firstStatus ? (
                <span className="status-chip" style={{ color: firstStatus.color }}>
                  {firstStatus.label}
                  {statuses.length > 1 ? ` +${statuses.length - 1}` : ''}
                </span>
              ) : null}
            </span>
            <span className="token-hp">
              {stats.hp ?? '–'}
              <small>/{stats.hpMax ?? '–'}</small>
            </span>
          </span>
          <span className="hp-bar">
            <span
              className={`hp-fill is-${hpTone(stats.hp, stats.hpMax)}`}
              style={{ width: `${(ratio ?? 0) * 100}%` }}
            />
          </span>
          {monster ? (
            <span className="token-sub">
              {stats.ac != null ? <span>AC {stats.ac}</span> : null}
              {stats.ac != null && room ? <span>·</span> : null}
              {room ? <span>{room.name}</span> : null}
              {!visible ? <span className="hidden-chip">Hidden</span> : null}
            </span>
          ) : null}
        </span>
      </button>
      {monster ? (
        <button
          type="button"
          className="icon-btn"
          aria-pressed={visible}
          aria-label={visible ? `Hide ${name}` : `Reveal ${name}`}
          title={visible ? `Hide ${name} from players` : `Reveal ${name} to players`}
          onClick={() => useDungeonStore.getState().setPlayerVisible(player.id, !visible)}
        >
          <Icon id={visible ? 'eye' : 'eyeOff'} />
        </button>
      ) : (
        <span className="ac-shield" title={stats.ac != null ? `Armor Class ${stats.ac}` : 'Armor Class'}>
          <Icon id="shield" size={26} strokeWidth={1.3} />
          <span>{stats.ac ?? '–'}</span>
        </span>
      )}
    </div>
  )
}

/** Players see a foe's name and how hurt it looks, never its numbers. */
function FoeGlimpse({ foe, turn }: { foe: Player; turn: boolean }) {
  const stats = normalizeStats(foe.stats)
  const wound = woundLabel(stats.hp, stats.hpMax)
  return (
    <div className="token-row is-glimpse">
      <Avatar player={foe} size={34} turn={turn} />
      <span className="token-name">{characterNameOf(foe)}</span>
      {wound ? <span className={`wound is-${wound.toLowerCase()}`}>{wound}</span> : null}
    </div>
  )
}
