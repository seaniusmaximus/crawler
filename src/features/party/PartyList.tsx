import { useState, type ReactNode } from 'react'
import { FOCUS_INSET } from '../../app/layout.ts'
import { initiativeLeader, initiativeOf, nextTurnPlayerId, sortByInitiative, turnTokenIds } from '../../model/combat.ts'
import { characterNameOf, companionOwner, monsterMembers, partyMembers, playerStatuses } from '../../model/players.ts'
import { hpRatio, normalizeStats } from '../../model/stats.ts'
import { STATUS_EFFECTS } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { getActiveFloor } from '../../state/selectors.ts'
import { Avatar } from '../../ui/Avatar.tsx'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { addCompanion, addMonster } from './addMonster.ts'
import { rollInitiativeFor } from './tokenRolls.ts'
import { FOE_SIGHT_LABEL, foeSight, hpTone, revealTitle, tokenPlace, tokenShown, woundLabel } from './tokenInfo.ts'

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
  return sortByInitiative(tokens).filter((token) => tokenShown(token, floors, tokens, viewMode))
}

/**
 * Everyone on the map in one panel: the initiative bar, then the party, then the
 * foes, each a section that folds away. One row of buttons adds any kind of token.
 */
export function TokensCard() {
  const tokens = useDungeonStore((state) => state.dungeon.players ?? [])
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const viewMode = useEditorStore((state) => state.viewMode)
  const role = useSessionStore((state) => state.role)
  const ordered = useOrderedTokens()
  const party = partyMembers(ordered)
  const foes = monsterMembers(ordered)
  const allFoes = monsterMembers(tokens)
  const dm = viewMode !== 'player'
  const canRun = role !== 'guest' && dm
  const onTurn = turnTokenIds(tokens, turnPlayerId)
  // In combat, who Next turn hands to (with any companions acting on their turn).
  const nextId = turnPlayerId ? nextTurnPlayerId(tokens, turnPlayerId) : null
  const upNext = nextId && nextId !== turnPlayerId ? turnTokenIds(tokens, nextId) : new Set<string>()
  const hidden = allFoes.filter((foe) => foeSight(foe, floors, tokens) !== 'seen').length
  // Monsters of a kind go on one roll, so only the first of each counts.
  const rollingFoes = allFoes.filter((foe) => !initiativeLeader(foe, tokens))
  const unrolledFoes = rollingFoes.filter((foe) => foe.initiativeRoll == null)
  const [closed, setClosed] = useState<{ party: boolean; foes: boolean }>({ party: false, foes: false })

  function addPlayer(): void {
    const id = useDungeonStore.getState().addPlayer(getActiveFloor().id)
    if (id) useEditorStore.getState().selectPlayer(id)
  }

  // Players only hear of foes they can see.
  const showFoes = dm || foes.length > 0

  return (
    <section className="panel token-card scroll-v" aria-label="Tokens">
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>Tokens</span>
        </h2>
      </header>

      {canRun && tokens.length > 0 ? <InitiativeBar tokens={tokens} turnPlayerId={turnPlayerId} /> : null}

      <div className="token-list">
        <TokenSection
          title="Party"
          count={party.length}
          closed={closed.party}
          onToggle={() => setClosed({ ...closed, party: !closed.party })}
        >
          {party.length === 0 ? (
            <p className="panel-empty">
              {dm ? 'Add a player, then drag their token onto a floor tile' : 'No visible players'}
            </p>
          ) : (
            party.map((player) => (
              <TokenRow key={player.id} player={player} turn={onTurn.has(player.id)} next={upNext.has(player.id)} />
            ))
          )}
        </TokenSection>

        {showFoes ? (
          <TokenSection
            title="Foes"
            foe
            count={foes.length}
            closed={closed.foes}
            onToggle={() => setClosed({ ...closed, foes: !closed.foes })}
            meta={dm && allFoes.length > 0 ? `${allFoes.length - hidden} seen · ${hidden} hidden` : undefined}
            action={
              canRun && unrolledFoes.length > 0 && unrolledFoes.length < rollingFoes.length ? (
                <button
                  type="button"
                  className="text-btn token-section-action"
                  onClick={() => rollInitiativeFor(unrolledFoes)}
                  title="Roll initiative for every monster that has not rolled yet"
                >
                  <Icon id="d20" size={13} />
                  Roll {unrolledFoes.length}
                </button>
              ) : null
            }
          >
            {foes.length === 0 ? (
              <p className="panel-empty">Add a monster — it starts Invisible; clear that and players see it once they can see into its room</p>
            ) : dm ? (
              foes.map((foe) => <TokenRow key={foe.id} player={foe} turn={onTurn.has(foe.id)} next={upNext.has(foe.id)} />)
            ) : (
              foes.map((foe) => <FoeGlimpse key={foe.id} foe={foe} turn={onTurn.has(foe.id)} next={upNext.has(foe.id)} />)
            )}
          </TokenSection>
        ) : null}
      </div>

      {canRun ? (
        <div className="panel-foot token-add">
          {/* Dashed, like every add button here; three in a row leave no room for plus signs. */}
          <button type="button" className="dashed-btn" onClick={addPlayer} title="A player character">
            <span className="btn-label">Player</span>
          </button>
          <button
            type="button"
            className="dashed-btn"
            onClick={addCompanion}
            title="A familiar, beast or other ally with its own stat block; its owner can run it too"
          >
            <span className="btn-label">Companion</span>
          </button>
          <button type="button" className="dashed-btn is-foe" onClick={addMonster} title="A monster from your library or a blank stat block">
            <span className="btn-label">Monster</span>
          </button>
        </div>
      ) : null}
    </section>
  )
}

/** One kind of token under a heading that folds it away, like a notes folder. */
function TokenSection({
  title,
  foe = false,
  count,
  closed,
  onToggle,
  meta,
  action,
  children,
}: {
  title: string
  foe?: boolean
  count: number
  closed: boolean
  onToggle: () => void
  meta?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={`token-section${foe ? ' is-foe' : ''}`}>
      <div className="token-section-head">
        <button type="button" className="token-section-toggle" aria-expanded={!closed} onClick={onToggle}>
          <Icon id={closed ? 'chevronRight' : 'chevronDown'} size={13} />
          <span className="kicker">{title}</span>
          {closed && count > 0 ? <span className="token-section-count">{count}</span> : null}
        </button>
        {meta ? <span className="panel-meta">{meta}</span> : null}
        {action}
      </div>
      {closed ? null : <div className="token-section-rows">{children}</div>}
    </div>
  )
}

/**
 * The DM's combat controls, spelled out: what state initiative is in, and the
 * one or two actions that make sense from there.
 */
function InitiativeBar({ tokens, turnPlayerId }: { tokens: readonly Player[]; turnPlayerId: string | null }) {
  const current = tokens.find((token) => token.id === turnPlayerId)
  // Companions that follow their owner go on the owner's roll, so they don't count here.
  const rolling = tokens.filter((token) => !initiativeLeader(token, tokens))
  const rolled = rolling.filter((token) => token.initiativeRoll != null).length
  const unrolled = rolling.length - rolled
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

function TokenRow({ player, turn, next }: { player: Player; turn: boolean; next: boolean }) {
  const open = useEditorStore((state) => state.sheetPlayerId === player.id)
  const hovered = useEditorStore((state) => state.hoverPlayerId === player.id)
  const viewMode = useEditorStore((state) => state.viewMode)
  const floors = useDungeonStore((state) => state.dungeon.floors)
  const tokens = useDungeonStore((state) => state.dungeon.players)
  const mine = useSessionStore((state) => state.myPlayerId === player.id)
  // A player's companion is marked theirs too.
  const myCompanion = useSessionStore(
    (state) => player.kind === 'companion' && state.myPlayerId != null && state.myPlayerId === player.ownerId,
  )
  const stats = normalizeStats(player.stats)
  const name = characterNameOf(player)
  const monster = player.kind === 'monster'
  const companion = player.kind === 'companion'
  const owner = companion ? companionOwner(player, tokens ?? []) : undefined
  // A monster going with the rest of its kind shows their shared count; only a companion is linked and tucked under its owner.
  const leader = companion ? initiativeLeader(player, tokens ?? []) : undefined
  const initiative = initiativeOf(player, tokens ?? [])
  const visible = player.visible === true
  const dm = viewMode !== 'player'
  // A monster reads as dim to the DM while players can't see it; a party member while the DM hides it.
  const sight = monster ? foeSight(player, floors, tokens ?? []) : null
  const faded = monster ? sight !== 'seen' : !visible
  const ratio = hpRatio(stats.hp, stats.hpMax)
  const statuses = playerStatuses(player)
  const firstStatus = STATUS_EFFECTS.find((effect) => effect.id === statuses[0])
  const room = monster ? tokenPlace(player, floors).room : undefined

  return (
    <div
      className={`token-row${open ? ' is-open' : ''}${hovered ? ' is-hovered' : ''}${mine || myCompanion ? ' is-mine' : ''}${leader ? ' is-follower' : ''}${next ? ' is-next' : ''}`}
      onPointerEnter={() => useEditorStore.getState().setHoverPlayer(player.id)}
      onPointerLeave={() => useEditorStore.getState().setHoverPlayer(null)}
    >
      <button
        type="button"
        className="token-row-main"
        aria-expanded={open}
        aria-label={monster || companion ? `Open ${name} stat block` : `Open ${name}'s sheet`}
        onClick={() => toggleSheet(player)}
      >
        <span
          className={`token-init${turn ? ' is-turn' : ''}${initiative == null ? ' is-empty' : ''}${leader ? ' is-linked' : ''}`}
          title={leader ? `Acts on ${characterNameOf(leader)}'s turn` : undefined}
        >
          {leader ? <Icon id="link" size={12} /> : (initiative ?? '—')}
        </span>
        <span className="token-avatar">
          <Avatar player={player} turn={turn} dim={dm && faded} />
          {next ? <NextChip /> : null}
        </span>
        <span className={`token-copy${dm && faded ? ' is-dim' : ''}`}>
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
              {sight && sight !== 'seen' ? <span className="hidden-chip">{FOE_SIGHT_LABEL[sight]}</span> : null}
            </span>
          ) : companion ? (
            <span className="token-sub">
              <span className="token-sub-clip">{owner ? `${characterNameOf(owner)}'s companion` : 'Companion · DM runs it'}</span>
              {owner && !leader ? (
                <span className="token-sub-icon" title="Rolls its own initiative" aria-label="Rolls its own initiative">
                  <Icon id="d20" size={12} />
                </span>
              ) : null}
            </span>
          ) : null}
        </span>
      </button>
      {monster ? (
        <button
          type="button"
          className="icon-btn"
          aria-pressed={visible}
          aria-label={visible ? `Stop revealing ${name}` : `Reveal ${name}`}
          title={revealTitle(name, visible)}
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
function FoeGlimpse({ foe, turn, next }: { foe: Player; turn: boolean; next: boolean }) {
  const stats = normalizeStats(foe.stats)
  const wound = woundLabel(stats.hp, stats.hpMax)
  return (
    <div className="token-row is-glimpse">
      <span className="token-avatar">
        <Avatar player={foe} size={34} turn={turn} />
        {next ? <NextChip /> : null}
      </span>
      <span className="token-name">{characterNameOf(foe)}</span>
      {wound ? <span className={`wound is-${wound.toLowerCase()}`}>{wound}</span> : null}
    </div>
  )
}

/** Whose turn comes after this one (what Next turn will hand the turn to), on the bottom of their portrait. */
function NextChip() {
  return (
    <span className="next-chip" title="Up next in initiative">
      Next
    </span>
  )
}
