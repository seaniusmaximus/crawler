import { useEffect, useState, type ReactNode } from 'react'
import * as api from '../../net/api.ts'
import type { MapInfo } from '../../net/api.ts'
import {
  PIN_GLYPHS,
  WORLD_COLORS,
  pinName,
  type LabelSize,
  type World,
  type WorldLabel,
  type WorldMark,
  type WorldPin,
  type WorldRoute,
} from '../../model/worlds.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useWorldStore } from '../../state/worldStore.ts'
import { Diamond, Icon } from '../../ui/Icon.tsx'
import { goToPin } from './goToPin.ts'
import { PIN_GLYPH_PATHS } from './pinGlyphs.tsx'

type Patch<T> = (change: Partial<T>) => void

/** Change one mark on a world map, or take it off. */
function useMarkEditing(world: World, mark: WorldMark) {
  const update = useWorldStore((state) => state.update)
  function patch<K extends 'pins' | 'labels' | 'routes'>(key: K, change: Partial<World[K][number]>): void {
    update(world.id, (current) => ({
      [key]: (current[key] as World[K][number][]).map((item) => (item.id === mark.id ? { ...item, ...change } : item)),
    }))
  }
  function remove(): void {
    const key = mark.kind === 'pin' ? 'pins' : mark.kind === 'label' ? 'labels' : 'routes'
    update(world.id, (current) => ({ [key]: (current[key] as { id: string }[]).filter((item) => item.id !== mark.id) }))
    useWorldStore.getState().select(null)
  }
  return { patch, remove }
}

/** The DM's panel for the mark they picked on a world map. */
export function WorldInspector({ world, mark }: { world: World; mark: WorldMark }) {
  const { patch, remove } = useMarkEditing(world, mark)
  const pin = mark.kind === 'pin' ? world.pins.find((item) => item.id === mark.id) : undefined
  const label = mark.kind === 'label' ? world.labels.find((item) => item.id === mark.id) : undefined
  const route = mark.kind === 'route' ? world.routes.find((item) => item.id === mark.id) : undefined
  const hidden = (pin ?? label ?? route)?.hidden ?? false
  if (!pin && !label && !route) return null

  return (
    <SidePanel
      title={pin ? 'Place' : label ? 'Label' : 'Route'}
      actions={
        <>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={hidden}
            title={hidden ? 'Hidden from players: click to reveal' : 'Players can see this: click to hide'}
            aria-label={hidden ? 'Reveal to players' : 'Hide from players'}
            onClick={() => patch(mark.kind === 'pin' ? 'pins' : mark.kind === 'label' ? 'labels' : 'routes', { hidden: !hidden })}
          >
            <Icon id={hidden ? 'eyeOff' : 'eye'} size={15} />
          </button>
          <button type="button" className="icon-btn is-danger" title="Delete" aria-label="Delete" onClick={remove}>
            <Icon id="trash" size={15} />
          </button>
        </>
      }
    >
      {hidden ? <p className="panel-note world-hidden-note">Hidden from players.</p> : null}
      {pin ? <PinFields world={world} pin={pin} patch={(change) => patch('pins', change)} /> : null}
      {label ? <LabelFields label={label} patch={(change) => patch('labels', change)} /> : null}
      {route ? <RouteFields route={route} patch={(change) => patch('routes', change)} /> : null}
    </SidePanel>
  )
}

function PinFields({ world, pin, patch }: { world: World; pin: WorldPin; patch: Patch<WorldPin> }) {
  return (
    <>
      <label className="world-field">
        <span className="kicker">Name</span>
        <input
          className="field"
          value={pin.name}
          maxLength={80}
          placeholder="e.g. Phandalin"
          autoFocus={!pin.name}
          onChange={(event) => patch({ name: event.target.value })}
        />
      </label>
      <div className="world-field">
        <span className="kicker">Marker</span>
        <div className="world-glyphs" role="radiogroup" aria-label="Marker">
          {PIN_GLYPHS.map((glyph) => (
            <button
              key={glyph.id}
              type="button"
              role="radio"
              aria-checked={pin.glyph === glyph.id}
              className={`world-glyph${pin.glyph === glyph.id ? ' is-active' : ''}`}
              title={glyph.label}
              onClick={() => patch({ glyph: glyph.id })}
            >
              <GlyphIcon glyph={glyph.id} />
            </button>
          ))}
        </div>
        <Swatches value={pin.color} onPick={(color) => patch({ color })} />
      </div>
      <LeadsTo world={world} pin={pin} patch={patch} />
      <label className="world-field">
        <span className="kicker">What the table reads</span>
        <textarea
          className="field world-text"
          rows={4}
          value={pin.text}
          maxLength={4000}
          placeholder="A mining town on the Triboar Trail…"
          onChange={(event) => patch({ text: event.target.value })}
        />
      </label>
      <label className="world-field">
        <span className="kicker">
          <Icon id="lock" size={12} />
          Only you see this
        </span>
        <textarea
          className="field world-text"
          rows={3}
          value={pin.secret}
          maxLength={4000}
          placeholder="The Redbrands hide under Tresendar Manor."
          onChange={(event) => patch({ secret: event.target.value })}
        />
      </label>
    </>
  )
}

/** Which battle map the place leads to, and the way there for the party. */
function LeadsTo({ world, pin, patch }: { world: World; pin: WorldPin; patch: Patch<WorldPin> }) {
  const roomId = useSessionStore((state) => state.roomId)
  const mapsVersion = useSessionStore((state) => state.mapsVersion)
  const mapBusy = useSessionStore((state) => state.mapBusy)
  const liveMapId = useNotesStore((state) => state.mapId)
  const [maps, setMaps] = useState<MapInfo[] | null>(null)

  useEffect(() => {
    if (!roomId) return
    let live = true
    api.listMaps(roomId).then(
      (list) => live && setMaps(list),
      () => live && setMaps([]),
    )
    return () => {
      live = false
    }
  }, [roomId, mapsVersion])

  const target = maps?.find((map) => map.id === pin.mapId)
  const here = Boolean(pin.mapId && pin.mapId === liveMapId)

  return (
    <div className="world-field">
      <span className="kicker">
        <Icon id="link" size={12} />
        Leads to a battle map
      </span>
      <select
        className="field world-select"
        value={pin.mapId ?? ''}
        onChange={(event) => patch({ mapId: event.target.value || null })}
      >
        <option value="">None</option>
        {(maps ?? []).map((map) => (
          <option key={map.id} value={map.id}>
            {map.name}
            {map.live ? ' (party is here)' : ''}
          </option>
        ))}
        {pin.mapId && maps && !target ? <option value={pin.mapId}>A deleted map</option> : null}
      </select>
      {pin.mapId && target ? (
        here ? (
          <button type="button" className="outline-btn world-travel" onClick={() => goToPin(world, pin)}>
            <Icon id="chevronLeft" size={14} />
            The party is here: go to it
          </button>
        ) : (
          <button
            type="button"
            className="outline-btn world-travel"
            disabled={Boolean(mapBusy)}
            onClick={() => goToPin(world, pin)}
          >
            <Icon id="person" size={14} />
            Move the party here
          </button>
        )
      ) : null}
      {pin.mapId && target ? <p className="panel-note">Or double-click the pin.</p> : null}
    </div>
  )
}

function LabelFields({ label, patch }: { label: WorldLabel; patch: Patch<WorldLabel> }) {
  const sizes: { id: LabelSize; name: string }[] = [
    { id: 's', name: 'Small' },
    { id: 'm', name: 'Medium' },
    { id: 'l', name: 'Large' },
  ]
  return (
    <>
      <label className="world-field">
        <span className="kicker">Text</span>
        <input
          className="field"
          value={label.text}
          maxLength={80}
          autoFocus
          onFocus={(event) => event.target.select()}
          onChange={(event) => patch({ text: event.target.value })}
        />
      </label>
      <div className="world-field">
        <span className="kicker">Size</span>
        <div className="segmented">
          {sizes.map((size) => (
            <button
              key={size.id}
              type="button"
              className={label.size === size.id ? 'is-active' : ''}
              onClick={() => patch({ size: size.id })}
            >
              {size.name}
            </button>
          ))}
        </div>
      </div>
    </>
  )
}

function RouteFields({ route, patch }: { route: WorldRoute; patch: Patch<WorldRoute> }) {
  return (
    <>
      <div className="world-field">
        <span className="kicker">Colour</span>
        <Swatches value={route.color} onPick={(color) => patch({ color })} />
      </div>
      <div className="world-field">
        <span className="kicker">Line</span>
        <div className="segmented">
          <button type="button" className={route.dashed ? '' : 'is-active'} onClick={() => patch({ dashed: false })}>
            Solid
          </button>
          <button type="button" className={route.dashed ? 'is-active' : ''} onClick={() => patch({ dashed: true })}>
            Dashed
          </button>
        </div>
      </div>
      <p className="panel-note">Drag its points to reshape it.</p>
    </>
  )
}

function Swatches({ value, onPick }: { value: string; onPick: (color: string) => void }) {
  return (
    <div className="world-swatches" role="radiogroup" aria-label="Colour">
      {WORLD_COLORS.map((color) => (
        <button
          key={color}
          type="button"
          role="radio"
          aria-checked={value === color}
          aria-label={color}
          className={`world-swatch${value === color ? ' is-active' : ''}`}
          style={{ background: color }}
          onClick={() => onPick(color)}
        />
      ))}
    </div>
  )
}

/** A pin's glyph on its own, for the marker picker. */
function GlyphIcon({ glyph }: { glyph: WorldPin['glyph'] }) {
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {PIN_GLYPH_PATHS[glyph]}
    </svg>
  )
}

/** What a player sees when they open a place on the world map. */
export function PinCard({ world, pin }: { world: World; pin: WorldPin }) {
  const liveMapId = useNotesStore((state) => state.mapId)
  const here = Boolean(pin.mapId && pin.mapId === liveMapId)
  return (
    <SidePanel title={PIN_GLYPHS.find((glyph) => glyph.id === pin.glyph)?.label ?? 'Place'}>
      <h3 className="world-card-name">{pinName(pin)}</h3>
      {here ? (
        <button type="button" className="outline-btn world-travel" onClick={() => goToPin(world, pin)}>
          <Icon id="chevronLeft" size={14} />
          The party is here: go to it
        </button>
      ) : null}
      {pin.text.trim() ? (
        <div className="note-read-text">
          {pin.text.split(/\n{2,}/).map((paragraph, index) => (
            <p key={index}>{paragraph}</p>
          ))}
        </div>
      ) : (
        <p className="panel-empty">Nothing more is known of this place.</p>
      )}
    </SidePanel>
  )
}

function SidePanel({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  return (
    <aside
      className="panel world-side scroll-v"
      aria-label={title}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="panel-head">
        <h2 className="panel-title">
          <Diamond />
          <span>{title}</span>
        </h2>
        <div className="world-side-actions">
          {actions}
          <button
            type="button"
            className="icon-btn is-boxed"
            aria-label="Close"
            onClick={() => useWorldStore.getState().select(null)}
          >
            <Icon id="close" size={15} />
          </button>
        </div>
      </header>
      <div className="world-side-body">{children}</div>
    </aside>
  )
}
