import { useEffect, useState } from 'react'
import { cardProperty, spellFromCard, type SpellCard } from '../../model/spellCard.ts'
import {
  classSpellcasting,
  hasDamage,
  levelLabel,
  MAX_SPELLS,
  normalizeSpellcasting,
  resolveLabel,
  spellAffects,
  spellArea,
  spellAreaLabel,
  spellDamageFormula,
  type Spell,
  type Spellcasting,
} from '../../model/spells.ts'
import { characterNameOf } from '../../model/players.ts'
import { normalizeStats } from '../../model/stats.ts'
import { statusEffect } from '../../model/status.ts'
import type { Player } from '../../model/types.ts'
import { useDungeonStore } from '../../state/dungeonStore.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useSpellCardStore, type OpenSpellCard } from '../../state/spellCardStore.ts'
import { castSpell } from './castSpell.ts'

/**
 * A spell up on screen. One sent from this player's D&D Beyond sheet can be
 * shown to the table, cast straight away (its area onto the map, its dice
 * rolled), or kept on their sheet; one someone else showed is just to read.
 */
export function SpellCardDialog() {
  const open = useSpellCardStore((state) => state.cards[0])
  const close = useSpellCardStore((state) => state.close)

  useEffect(() => {
    if (!open) return
    function onKey(event: KeyboardEvent): void {
      if (event.code === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  if (!open) return null
  // Keyed so each card starts with its buttons fresh.
  return <CardDialog key={open.card.id} open={open} onClose={close} />
}

function CardDialog({ open, onClose }: { open: OpenSpellCard; onClose: () => void }) {
  const { card, mode } = open
  const caster = useCaster(card)
  const role = useSessionStore((state) => state.role)
  const [shown, setShown] = useState(false)
  const [kept, setKept] = useState(false)
  const subtitle = card.subtitle || [cardProperty(card, /^level$/i), cardProperty(card, /^school$/i)].filter(Boolean).join(' · ')
  const lines = card.properties.filter((property) => !/^(level|school)$/i.test(property.label))
  const plan = caster ? castPlan(card, caster) : null
  const onSheet = caster?.spells?.find((spell) => sameName(spell.name, card.name))
  const full = !onSheet && (caster?.spells?.length ?? 0) >= MAX_SPELLS

  function show(): void {
    useSessionStore.getState().reportSpellCard(card)
    setShown(true)
  }

  function cast(): void {
    if (!caster || !plan) return
    castSpell(withCasting(caster, plan.casting), plan.spell)
    // Out of the way, so the area can be aimed.
    onClose()
  }

  function keep(): void {
    if (!caster || !plan) return
    const dungeon = useDungeonStore.getState()
    const spells = caster.spells ?? []
    if (caster.spellcasting == null) dungeon.setPlayerSpellcasting(caster.id, plan.casting)
    // Sent again, it brings the sheet's copy up to date, keeping its uses.
    const next = onSheet
      ? spells.map((spell) => (spell.id === onSheet.id ? { ...plan.spell, id: spell.id, perDay: spell.perDay, used: spell.used } : spell))
      : [...spells, plan.spell]
    dungeon.setPlayerSpells(caster.id, next)
    setKept(true)
  }

  return (
    <div className="dialog-backdrop" onPointerDown={onClose} role="presentation">
      <div
        className="dialog spell-card scroll-v"
        role="dialog"
        aria-labelledby="spell-card-title"
        onPointerDown={(event) => event.stopPropagation()}
      >
        {mode === 'shown' && card.from ? <span className="kicker">{card.from} shows the table</span> : null}
        <h2 id="spell-card-title">{card.name}</h2>
        {subtitle ? <p className="spell-card-sub">{subtitle}</p> : null}
        {lines.length ? (
          <dl className="spell-card-props">
            {lines.map((property) => (
              <div key={property.label}>
                <dt>{property.label}</dt>
                <dd>{property.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {card.description ? (
          <div className="spell-card-text">
            {card.description.split(/\n{2,}/).map((paragraph, index) => (
              <p key={index}>{paragraph}</p>
            ))}
          </div>
        ) : null}

        {mode === 'sent' ? (
          plan && caster ? (
            <p className="spell-card-plan">
              <span className="kicker">In Crawler, for {characterNameOf(caster)}</span>
              {plan.summary}
            </p>
          ) : (
            <p className="spell-card-plan">
              {role === 'guest' ? 'Take a seat at the table to cast this or keep it.' : 'Select a token to cast this or add it to its sheet.'}
            </p>
          )
        ) : null}

        <div className="dialog-actions">
          <button type="button" className="dialog-button" onClick={onClose}>
            Close
          </button>
          {mode === 'sent' && role !== 'solo' ? (
            <button type="button" className="dialog-button" disabled={shown} onClick={show}>
              {shown ? 'Shown' : 'Show to table'}
            </button>
          ) : null}
          {mode === 'sent' ? (
            <button
              type="button"
              className="dialog-button"
              disabled={!plan || kept || full}
              title={full ? `A sheet holds ${MAX_SPELLS} spells` : undefined}
              onClick={keep}
            >
              {kept ? 'On sheet' : full ? 'Sheet full' : onSheet ? 'Update on sheet' : 'Add to sheet'}
            </button>
          ) : null}
          {mode === 'sent' ? (
            <button type="button" className="dialog-button is-primary" disabled={!plan} onClick={cast}>
              Cast now
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/**
 * Who casts a spell sent here: a player's own character; for the DM, the token
 * playing the sheet it came from, else whichever token they have selected.
 */
function useCaster(card: SpellCard): Player | null {
  const players = useDungeonStore((state) => state.dungeon.players)
  const role = useSessionStore((state) => state.role)
  const myPlayerId = useSessionStore((state) => state.myPlayerId)
  const selectedId = useEditorStore((state) => state.selectedPlayerId)
  const tokens = players ?? []
  if (role === 'guest') return tokens.find((token) => token.id === myPlayerId) ?? null
  const bySheet = card.characterId ? tokens.find((token) => token.kind !== 'monster' && token.characterId === card.characterId) : undefined
  return bySheet ?? tokens.find((token) => token.id === selectedId) ?? null
}

/**
 * The spell as this caster would have it, how they cast it (as already set, or
 * as their class does if they have never cast), and a line saying what it will do.
 */
function castPlan(card: SpellCard, caster: Player): { spell: Spell; casting: Spellcasting; summary: string } {
  const stats = normalizeStats(caster.stats)
  const set = normalizeSpellcasting(caster.spellcasting)
  const casting = caster.spellcasting == null && caster.kind !== 'monster' ? classSpellcasting(stats, set) : set
  const spell = spellFromCard(card)
  const area = spellArea(spell)
  const healing = spell.type.toLowerCase() === 'healing'
  const duration = cardProperty(card, /^duration$/i)
  const parts = [
    levelLabel(spell.level),
    resolveLabel(spell, casting, stats),
    hasDamage(spell)
      ? `${spellDamageFormula(spell)}${spell.type ? ` ${spell.type}` : ''}${spell.resolve === 'save' && !healing ? (spell.onSave === 'half' ? ', half on save' : ', none on save') : ''}`
      : null,
    spell.condition ? statusEffect(spell.condition).label : null,
    area ? `${spellAreaLabel(area)}${spellAffects(spell) !== 'all' ? `, ${spellAffects(spell)} only` : ''}` : null,
    area && /concentration/i.test(duration) ? 'concentration' : null,
  ].filter(Boolean)
  return { spell, casting, summary: parts.join(' · ') }
}

/** The caster with how they cast set, for a first cast before they have any spells. */
function withCasting(caster: Player, casting: Spellcasting): Player {
  if (caster.spellcasting != null) return caster
  useDungeonStore.getState().setPlayerSpellcasting(caster.id, casting)
  return { ...caster, spellcasting: casting }
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}
