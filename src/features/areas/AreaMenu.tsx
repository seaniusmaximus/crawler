import { useState, type CSSProperties, type KeyboardEvent } from 'react'
import {
  AREA_SHAPES,
  MAX_AREA_ROUNDS,
  areaColor,
  areaDamageFormula,
  newAreaDamage,
  roundsLeft,
  type AreaDamage,
  type AreaAffects,
  type AreaDuration,
  type AreaSide,
  type AreaTrigger,
  type PlacedArea,
} from '../../model/marks.ts'
import { characterNameOf } from '../../model/players.ts'
import { ABILITY_KEYS, ABILITY_LABEL, type AbilityKey } from '../../model/stats.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore, type AreaMenu as AreaMenuState } from '../../state/editorStore.ts'
import { canRemoveArea, useSessionStore } from '../../state/sessionStore.ts'
import { Icon } from '../../ui/Icon.tsx'
import { Stepper } from '../../ui/Stepper.tsx'
import { DamageTypeField, DiePicker } from '../party/DamageFields.tsx'

const WIDTH = 300

const TRIGGERS: ReadonlyArray<{ id: AreaTrigger; label: string; title: string }> = [
  { id: 'enter', label: 'Entering', title: 'When a creature enters it (once a turn)' },
  { id: 'start', label: 'Turn start', title: 'When a creature starts its turn in it' },
  { id: 'both', label: 'Both', title: 'Either way' },
]

/**
 * A spell area's settings, opened by right-clicking it with the area tool: what
 * it is called, how long it lasts, whether it is hard going, what it does to
 * whoever enters it or starts a turn in it, and (for the DM) whether players can
 * see it. Whoever made it, or the DM, can change it; anyone else just reads it.
 */
export function AreaMenu({ menu }: { menu: AreaMenuState }) {
  const area = useDungeonStore((state) => state.dungeon.areas?.find((item) => item.id === menu.areaId))
  const players = useDungeonStore((state) => state.dungeon.players)
  const round = useDungeonStore((state) => state.dungeon.combat?.round)
  const turnPlayerId = useDungeonStore((state) => state.dungeon.combat?.turnPlayerId ?? null)
  const dm = useSessionStore((state) => state.role !== 'guest')
  // Whose areas are whose follows the seat.
  useSessionStore((state) => state.myPlayerId)
  if (!area) return null
  const editable = canRemoveArea(area)
  const left = Math.max(8, Math.min(menu.x + 14, window.innerWidth - WIDTH - 8))
  const top = Math.max(8, Math.min(menu.y - 20, window.innerHeight - 460))

  function change(fields: Partial<PlacedArea>): void {
    if (area) useSessionStore.getState().updateArea({ ...area, ...fields })
  }

  return (
    <div
      className="panel area-menu scroll-v"
      style={{ left, top, width: WIDTH, '--area': `rgb(${areaColor(area.color).rgb})` } as CSSProperties}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      role="dialog"
      aria-label="Area settings"
    >
      <div className="area-menu-head">
        <span className="area-menu-swatch" aria-hidden />
        {editable ? (
          <NameField area={area} onCommit={(name) => change({ name: name || undefined })} />
        ) : (
          <strong className="area-menu-title">{area.name || 'Area'}</strong>
        )}
        <span className="area-menu-shape">{AREA_SHAPES.find((item) => item.id === area.shape)?.label}</span>
        <button type="button" className="icon-btn" aria-label="Close" onClick={() => useEditorStore.getState().closeMenu()}>
          <Icon id="close" size={14} />
        </button>
      </div>

      {editable ? (
        <>
          <DurationField
            area={area}
            players={players ?? []}
            round={round}
            fallbackCaster={area.playerId ?? (area.owner !== 'dm' ? area.owner : null) ?? turnPlayerId}
            onChange={(duration) => change({ duration })}
          />
          <button
            type="button"
            className={`tool-option area-menu-toggle${area.difficult ? ' is-active' : ''}`}
            aria-pressed={area.difficult === true}
            title="Moving through it costs twice as much (flying ignores it)"
            onClick={() => change({ difficult: area.difficult ? undefined : true })}
          >
            Difficult terrain
          </button>
          <DamageField
            damage={area.damage ?? null}
            side={area.side ?? 'foes'}
            dm={dm}
            onChange={(damage) => change({ damage: damage ?? undefined })}
            onSide={(side) => change({ side })}
          />
          {dm ? (
            <button
              type="button"
              className={`tool-option area-menu-toggle${area.hidden ? ' is-active' : ''}`}
              aria-pressed={area.hidden === true}
              title="Only you see it; it still goes off for whoever walks in (a trap)"
              onClick={() => change({ hidden: area.hidden ? undefined : true })}
            >
              <Icon id={area.hidden ? 'eyeOff' : 'eye'} size={14} />
              {area.hidden ? 'Hidden from players' : 'Players can see it'}
            </button>
          ) : null}
          <div className="area-menu-foot">
            <button
              type="button"
              className="icon-btn is-danger"
              aria-label="Remove area"
              title="Take it off the map"
              onClick={() => {
                useSessionStore.getState().removeAreas([area.id])
                useEditorStore.getState().closeMenu()
              }}
            >
              <Icon id="trash" size={15} />
            </button>
            <button type="button" className="chip-btn is-primary" onClick={() => useEditorStore.getState().closeMenu()}>
              Done
            </button>
          </div>
        </>
      ) : (
        <Summary area={area} players={players ?? []} round={round} />
      )}
    </div>
  )
}

function NameField({ area, onCommit }: { area: PlacedArea; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(area.name ?? '')
  function keys(event: KeyboardEvent<HTMLInputElement>): void {
    // The map's shortcuts stay out of the way while typing.
    event.stopPropagation()
    if (event.key === 'Enter') event.currentTarget.blur()
  }
  return (
    <input
      className="stat-input area-menu-name"
      value={draft}
      maxLength={40}
      placeholder="Name it (Spirit Guardians, pit trap…)"
      aria-label="Area name"
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => draft.trim() !== (area.name ?? '') && onCommit(draft.trim())}
      onKeyDown={keys}
    />
  )
}

/** Until removed, so many rounds, or while a caster keeps concentrating. */
function DurationField({
  area,
  players,
  round,
  fallbackCaster,
  onChange,
}: {
  area: PlacedArea
  players: readonly Player[]
  round: number | undefined
  fallbackCaster: string | null
  onChange: (duration: AreaDuration | undefined) => void
}) {
  const kind = area.duration?.kind ?? 'none'
  const left = roundsLeft(area, round) ?? 10
  const casterId = area.duration?.kind === 'concentration' ? area.duration.casterId : null
  // Anyone on the map can be the caster; the area's own creature (or its maker) comes first.
  const firstCaster = players.find((player) => player.id === fallbackCaster)?.id ?? players[0]?.id ?? null
  return (
    <div className="area-menu-block">
      <span className="kicker">Lasts</span>
      <div className="segment-grid" role="radiogroup" aria-label="How long it lasts">
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'none'}
          className={`segment${kind === 'none' ? ' is-on' : ''}`}
          onClick={() => onChange(undefined)}
        >
          Until removed
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'rounds'}
          className={`segment${kind === 'rounds' ? ' is-on' : ''}`}
          onClick={() => onChange({ kind: 'rounds', rounds: 10 })}
        >
          Rounds
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={kind === 'concentration'}
          className={`segment${kind === 'concentration' ? ' is-on' : ''}`}
          disabled={!firstCaster}
          title={firstCaster ? 'While its caster keeps concentrating' : 'Needs a token on the map to concentrate'}
          onClick={() => firstCaster && onChange({ kind: 'concentration', casterId: firstCaster })}
        >
          Concentration
        </button>
      </div>
      {kind === 'rounds' ? (
        <Stepper
          className="is-compact"
          label={round != null ? 'Rounds left' : 'Rounds'}
          value={`${left}`}
          onDown={() => onChange({ kind: 'rounds', rounds: left - 1 })}
          onUp={() => onChange({ kind: 'rounds', rounds: left + 1 })}
          downDisabled={left <= 1}
          upDisabled={left >= MAX_AREA_ROUNDS}
        />
      ) : null}
      {kind === 'concentration' ? (
        <label className="attack-select">
          <span className="kicker">Caster</span>
          <select
            className="tileset-select"
            value={casterId ?? ''}
            onChange={(event) => onChange({ kind: 'concentration', casterId: event.target.value })}
          >
            {players.map((player) => (
              <option key={player.id} value={player.id}>
                {characterNameOf(player)}
              </option>
            ))}
          </select>
        </label>
      ) : null}
    </div>
  )
}

const AFFECTS: ReadonlyArray<{ id: AreaAffects; label: string }> = [
  { id: 'all', label: 'All creatures' },
  { id: 'enemies', label: 'Enemies only' },
  { id: 'allies', label: 'Allies only' },
]

/**
 * Who an area that takes in only one side hurts, from the side it is on:
 * enemies of the party's are monsters, of the monsters' the party; allies the other way.
 */
function hurtBy(side: AreaSide, affects: Exclude<AreaAffects, 'all'>): string {
  const monsters = (side === 'party') === (affects === 'enemies')
  return monsters ? 'monsters' : 'the party'
}

/**
 * The damage it does and when: dice, type, trigger, the save against it, and
 * whether it hurts everyone or only enemies (of the side it is on, which the DM
 * can switch; a player's areas are always the party's).
 */
function DamageField({
  damage,
  side,
  dm,
  onChange,
  onSide,
}: {
  damage: AreaDamage | null
  side: AreaSide
  dm: boolean
  onChange: (damage: AreaDamage | null) => void
  onSide: (side: AreaSide) => void
}) {
  const update = (fields: Partial<AreaDamage>) => damage && onChange({ ...damage, ...fields })
  return (
    <div className="area-menu-block">
      <button
        type="button"
        className={`tool-option area-menu-toggle${damage ? ' is-active' : ''}`}
        aria-pressed={damage != null}
        title="Rolls damage for whoever enters it or starts a turn in it"
        onClick={() => onChange(damage ? null : newAreaDamage())}
      >
        {damage ? `Deals ${areaDamageFormula(damage)}` : 'Deals damage'}
      </button>
      {damage ? (
        <>
          <div className="segment-grid" role="radiogroup" aria-label="When it goes off">
            {TRIGGERS.map((trigger) => (
              <button
                key={trigger.id}
                type="button"
                role="radio"
                aria-checked={damage.trigger === trigger.id}
                className={`segment${damage.trigger === trigger.id ? ' is-on' : ''}`}
                title={trigger.title}
                onClick={() => update({ trigger: trigger.id })}
              >
                {trigger.label}
              </button>
            ))}
          </div>
          <div className="segment-grid" role="radiogroup" aria-label="Who it hurts">
            {AFFECTS.map((choice) => (
              <button
                key={choice.id}
                type="button"
                role="radio"
                aria-checked={damage.affects === choice.id}
                className={`segment${damage.affects === choice.id ? ' is-on' : ''}`}
                title={choice.id === 'all' ? 'Every creature, friend or foe' : `Only ${hurtBy(side, choice.id)}`}
                onClick={() => update({ affects: choice.id })}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {damage.affects !== 'all' ? (
            dm ? (
              <label className="attack-select">
                <span className="kicker">Cast by</span>
                <select
                  className="tileset-select"
                  value={side}
                  onChange={(event) => onSide(event.target.value === 'party' ? 'party' : 'foes')}
                >
                  <option value="foes">A monster: {damage.affects === 'enemies' ? 'hurts the party' : 'hurts monsters'}</option>
                  <option value="party">The party: {damage.affects === 'enemies' ? 'hurts monsters' : 'hurts the party'}</option>
                </select>
              </label>
            ) : (
              <p className="area-menu-note">Hurts {hurtBy(side, damage.affects)} only</p>
            )
          ) : null}
          <DiePicker faces={damage.faces} onPick={(faces) => update({ faces })} />
          <div className="attack-line">
            <Stepper
              className="is-compact"
              label="Dice"
              value={`${damage.count}`}
              onDown={() => update({ count: damage.count - 1 })}
              onUp={() => update({ count: damage.count + 1 })}
              downDisabled={damage.count <= 1}
              upDisabled={damage.count >= 40}
            />
            <Stepper
              className="is-compact"
              label="Extra"
              value={damage.bonus >= 0 ? `+${damage.bonus}` : `${damage.bonus}`}
              onDown={() => update({ bonus: damage.bonus - 1 })}
              onUp={() => update({ bonus: damage.bonus + 1 })}
            />
          </div>
          <DamageTypeField value={damage.type} onChange={(type) => update({ type })} />
          <div className="attack-line">
            <label className="attack-select">
              <span className="kicker">Save</span>
              <select
                className="tileset-select"
                value={damage.save?.ability ?? ''}
                onChange={(event) => {
                  const ability = ABILITY_KEYS.find((key) => key === event.target.value) as AbilityKey | undefined
                  update({ save: ability ? { dc: 13, onSave: 'half', ...damage.save, ability } : null })
                }}
              >
                <option value="">No save</option>
                {ABILITY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {ABILITY_LABEL[key]}
                  </option>
                ))}
              </select>
            </label>
            {damage.save ? (
              <Stepper
                className="is-compact"
                label="DC"
                value={`${damage.save.dc}`}
                onDown={() => damage.save && update({ save: { ...damage.save, dc: damage.save.dc - 1 } })}
                onUp={() => damage.save && update({ save: { ...damage.save, dc: damage.save.dc + 1 } })}
                downDisabled={damage.save.dc <= 1}
                upDisabled={damage.save.dc >= 40}
              />
            ) : null}
          </div>
          {damage.save ? (
            <label className="attack-select">
              <span className="kicker">On a success</span>
              <select
                className="tileset-select"
                value={damage.save.onSave}
                onChange={(event) =>
                  damage.save && update({ save: { ...damage.save, onSave: event.target.value === 'none' ? 'none' : 'half' } })
                }
              >
                <option value="half">Half damage</option>
                <option value="none">No damage</option>
              </select>
            </label>
          ) : null}
        </>
      ) : null}
    </div>
  )
}

/** Someone else's area: what it does, without the controls. */
function Summary({ area, players, round }: { area: PlacedArea; players: readonly Player[]; round: number | undefined }) {
  const caster = area.duration?.kind === 'concentration' ? area.duration.casterId : null
  const casterName = caster ? players.find((player) => player.id === caster) : undefined
  const left = roundsLeft(area, round)
  const lines = [
    left != null ? `${left} round${left === 1 ? '' : 's'} left` : null,
    caster ? `While ${casterName ? characterNameOf(casterName) : 'its caster'} concentrates` : null,
    area.difficult ? 'Difficult terrain' : null,
    area.damage
      ? `${areaDamageFormula(area.damage)} ${area.damage.trigger === 'enter' ? 'on entering' : area.damage.trigger === 'start' ? 'at turn start' : 'on entering or at turn start'}${
          area.damage.save ? ` · DC ${area.damage.save.dc} ${ABILITY_LABEL[area.damage.save.ability]}` : ''
        }${area.damage.affects !== 'all' ? ` · ${hurtBy(area.side ?? 'foes', area.damage.affects)} only` : ''}`
      : null,
  ].filter((line) => line != null)
  return (
    <ul className="area-menu-summary">
      {lines.length ? lines.map((line) => <li key={line}>{line}</li>) : <li>Just marks the ground</li>}
    </ul>
  )
}
