import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import type { ObjectPart } from '../../objects/catalog.ts'
import { MAX_CUSTOM_HEIGHT, MAX_LABEL_LENGTH, MIN_PART_SIZE, reshapePart } from '../../objects/custom.ts'
import { partName, round2, type Axis } from './geometry.ts'
import { lighter, PALETTE } from './palette.ts'
import type { Draft } from './useDraft.ts'

export interface ArrangeActions {
  duplicate: () => void
  mirror: (axis: Axis) => void
  centre: (axis: Axis) => void
  remove: () => void
}

const SHAPES: ReadonlyArray<{ id: ObjectPart['shape']; label: string }> = [
  { id: 'box', label: 'Box' },
  { id: 'round', label: 'Round' },
  { id: 'flat', label: 'Flat' },
]

/** The selected part's exact numbers and colours, and tools that act on every selected part. */
export function Inspector({ draft, selected, arrange }: { draft: Draft; selected: readonly number[]; arrange: ArrangeActions }) {
  const primary = selected.at(-1)
  const part = primary === undefined ? undefined : draft.draft.parts[primary]
  const [colorTarget, setColorTarget] = useState<'main' | 'accent'>('main')

  if (!part || primary === undefined) {
    return (
      <div className="studio-inspector is-empty">
        <p>Select a part in any view, or add one from the list.</p>
        <p className="studio-hint">Shift-click or drag a box in the top view to select several.</p>
      </div>
    )
  }

  const footprint = draft.draft
  const live = (change: (part: ObjectPart) => ObjectPart) =>
    draft.set((def) => ({ ...def, parts: def.parts.map((item, i) => (i === primary ? change(item) : item)) }))
  /** One change to every selected part, as one undo step. */
  const toSelected = (change: (part: ObjectPart) => ObjectPart) =>
    draft.commit((def) => ({ ...def, parts: def.parts.map((item, i) => (selected.includes(i) ? change(item) : item)) }))

  const field = (label: string, value: number, apply: (value: number) => ObjectPart, opts: { min: number; max: number; step: number; unit: string }) => (
    <NumberField
      key={label}
      label={label}
      value={value}
      {...opts}
      onBegin={draft.begin}
      onChange={(next) => live(() => apply(next))}
      onEnd={draft.end}
    />
  )
  const cells = { step: 0.05, unit: 'cells' }
  const pixels = { step: 1, unit: 'px' }

  const accentLabel = part.shape === 'flat' ? 'Border' : 'Top'
  const mainLabel = part.shape === 'flat' ? 'Fill' : 'Sides'
  const accentValue = part.shape === 'flat' ? part.border : part.top
  const shownColor = colorTarget === 'main' ? part.color : (accentValue ?? part.color)

  function paint(color: string): void {
    toSelected((item) => {
      if (colorTarget === 'accent') return item.shape === 'flat' ? { ...item, border: color } : { ...item, top: color }
      // A top that was the lighter shade of the old colour follows the new one.
      if (item.shape !== 'flat' && item.top && item.top === lighter(item.color)) return { ...item, color, top: lighter(color) }
      return { ...item, color }
    })
  }

  const used = [...new Set(draft.draft.parts.flatMap((item) => [item.color, item.shape === 'flat' ? item.border : item.top]).filter((c): c is string => !!c))]

  return (
    <div className="studio-inspector">
      <div className="studio-section">
        <div className="studio-section-head">
          <LabelField key={`${primary}:${part.label ?? ''}`} part={part} index={primary} onCommit={(label) => draft.commit((def) => ({ ...def, parts: def.parts.map((item, i) => (i === primary ? { ...item, label } : item)) }))} />
          {selected.length > 1 && <span className="studio-count">+{selected.length - 1} more</span>}
        </div>
        <div className="studio-segment" role="group" aria-label="Shape">
          {SHAPES.map((shape) => (
            <button
              key={shape.id}
              type="button"
              className={part.shape === shape.id ? 'is-active' : ''}
              aria-pressed={part.shape === shape.id}
              onClick={() => toSelected((item) => ({ ...reshapePart(item, shape.id), ...(item.label ? { label: item.label } : {}) }))}
            >
              {shape.label}
            </button>
          ))}
        </div>
      </div>

      <div className="studio-section">
        <h4>Position &amp; size</h4>
        <div className="studio-fields">
          {part.shape === 'round' ? (
            <>
              {field('Centre ↔', part.x, (x) => ({ ...part, x }), { ...cells, min: 0, max: footprint.w })}
              {field('Centre ↕', part.y, (y) => ({ ...part, y }), { ...cells, min: 0, max: footprint.d })}
              {field('Radius', part.r, (r) => ({ ...part, r }), { ...cells, min: MIN_PART_SIZE / 2, max: Math.max(footprint.w, footprint.d) / 2 })}
              {field('Top radius', part.r2 ?? part.r, (r2) => ({ ...part, r2 }), { ...cells, min: 0, max: Math.max(footprint.w, footprint.d) / 2 })}
            </>
          ) : (
            <>
              {field('Left', part.x, (x) => ({ ...part, x }), { ...cells, min: 0, max: footprint.w })}
              {field('Back', part.y, (y) => ({ ...part, y }), { ...cells, min: 0, max: footprint.d })}
              {field('Width', part.w, (w) => ({ ...part, w }), { ...cells, min: MIN_PART_SIZE, max: footprint.w })}
              {field('Depth', part.d, (d) => ({ ...part, d }), { ...cells, min: MIN_PART_SIZE, max: footprint.d })}
            </>
          )}
          {part.shape !== 'flat' && (
            <>
              {field('Raised', part.z, (z) => ({ ...part, z }), { ...pixels, min: 0, max: MAX_CUSTOM_HEIGHT - 1 })}
              {field('Height', part.h, (h) => ({ ...part, h }), { ...pixels, min: 1, max: MAX_CUSTOM_HEIGHT })}
            </>
          )}
        </div>
        <p className="studio-hint">Drag a label to scrub. A wall is 20 px tall; a cell is about 45 px across.</p>
      </div>

      <div className="studio-section">
        <h4>Colour</h4>
        <div className="studio-segment" role="group" aria-label="Which colour">
          <button type="button" className={colorTarget === 'main' ? 'is-active' : ''} onClick={() => setColorTarget('main')}>
            <span className="studio-swatch-dot" style={{ background: part.color }} /> {mainLabel}
          </button>
          <button type="button" className={colorTarget === 'accent' ? 'is-active' : ''} onClick={() => setColorTarget('accent')}>
            <span className="studio-swatch-dot" style={{ background: accentValue ?? part.color, opacity: accentValue ? 1 : 0.35 }} /> {accentLabel}
          </button>
        </div>
        <div className="studio-swatches">
          {PALETTE.map((swatch) => (
            <button
              key={swatch.color}
              type="button"
              className={`studio-swatch${swatch.color === shownColor ? ' is-active' : ''}`}
              style={{ background: swatch.color }}
              title={swatch.name}
              aria-label={swatch.name}
              onClick={() => paint(swatch.color)}
            />
          ))}
        </div>
        {used.length > 0 && (
          <div className="studio-used">
            <span>In this object</span>
            <div className="studio-swatches is-small">
              {used.map((color) => (
                <button key={color} type="button" className="studio-swatch" style={{ background: color }} title={color} aria-label={color} onClick={() => paint(color)} />
              ))}
            </div>
          </div>
        )}
        <div className="studio-row">
          <label className="studio-custom-color" title="Any colour">
            <input
              type="color"
              value={shownColor}
              onFocus={draft.begin}
              onBlur={draft.end}
              onChange={(event) => {
                const color = event.target.value
                draft.begin()
                draft.set((def) => ({
                  ...def,
                  parts: def.parts.map((item, i) => {
                    if (!selected.includes(i)) return item
                    if (colorTarget === 'main') return { ...item, color }
                    return item.shape === 'flat' ? { ...item, border: color } : { ...item, top: color }
                  }),
                }))
              }}
            />
            <span>Custom…</span>
          </label>
          {colorTarget === 'accent' && (
            <>
              {part.shape !== 'flat' && (
                <button type="button" className="studio-chip" onClick={() => toSelected((item) => (item.shape === 'flat' ? item : { ...item, top: lighter(item.color) }))}>
                  Lighter
                </button>
              )}
              <button
                type="button"
                className="studio-chip"
                onClick={() =>
                  toSelected((item) => {
                    if (item.shape === 'flat') return { ...item, border: undefined }
                    return { ...item, top: undefined }
                  })
                }
              >
                {part.shape === 'flat' ? 'No border' : 'Same as sides'}
              </button>
            </>
          )}
        </div>
      </div>

      <div className="studio-section">
        <label className="studio-toggle" title="A soft glow of this part's colour on the map, for flames, embers, lava and magic">
          <input
            type="checkbox"
            checked={!!part.glow}
            onChange={(event) => {
              const on = event.target.checked
              toSelected((item) => {
                const { glow: _glow, ...rest } = item
                return on ? { ...rest, glow: true } : rest
              })
            }}
          />
          <span>
            <strong>Produces light</strong>
            <em>Glows softly on the map: fires, torches, lava, magic.</em>
          </span>
        </label>
      </div>

      <div className="studio-section">
        <h4>Arrange</h4>
        <div className="studio-tools">
          <button type="button" className="studio-chip" onClick={arrange.duplicate} title="Copy the selected parts (Ctrl+D)">
            Duplicate
          </button>
          <button type="button" className="studio-chip" onClick={() => arrange.mirror('x')} title="Add copies mirrored left to right, for the other side">
            Mirror ↔
          </button>
          <button type="button" className="studio-chip" onClick={() => arrange.mirror('y')} title="Add copies mirrored front to back">
            Mirror ↕
          </button>
          <button type="button" className="studio-chip" onClick={() => arrange.centre('x')} title="Centre left to right in the footprint">
            Centre ↔
          </button>
          <button type="button" className="studio-chip" onClick={() => arrange.centre('y')} title="Centre front to back in the footprint">
            Centre ↕
          </button>
          <button type="button" className="studio-chip is-danger" onClick={arrange.remove} title="Remove the selected parts (Delete)">
            Remove
          </button>
        </div>
      </div>
    </div>
  )
}

function LabelField({ part, index, onCommit }: { part: ObjectPart; index: number; onCommit: (label: string | undefined) => void }) {
  // Remounted (by key) when the part or its saved name changes, so it starts from that.
  const [text, setText] = useState(part.label ?? '')
  return (
    <input
      className="studio-label-input"
      value={text}
      maxLength={MAX_LABEL_LENGTH}
      placeholder={partName({ ...part, label: undefined }, index)}
      aria-label="Part name"
      onChange={(event) => setText(event.target.value)}
      onBlur={() => {
        const label = text.trim() || undefined
        if (label !== part.label) onCommit(label)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
    />
  )
}

/**
 * A number to type in, nudge with the arrow keys (Shift for ten steps), or
 * scrub by dragging its label sideways.
 */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  unit,
  onBegin,
  onChange,
  onEnd,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  onBegin: () => void
  onChange: (value: number) => void
  onEnd: () => void
}) {
  const shown = String(round2(value))
  const [text, setText] = useState(shown)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setText(shown)
  }, [shown])
  const clamp = (n: number) => round2(Math.max(min, Math.min(max, n)))

  function scrub(event: ReactPointerEvent): void {
    event.preventDefault()
    const startX = event.clientX
    const startValue = value
    onBegin()
    const move = (e: PointerEvent) => {
      const steps = Math.round((e.clientX - startX) / (e.shiftKey ? 1 : 4))
      onChange(clamp(startValue + steps * step))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      onEnd()
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter') event.currentTarget.blur()
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    const next = clamp(value + (event.key === 'ArrowUp' ? 1 : -1) * step * (event.shiftKey ? 10 : 1))
    setText(String(next))
    onChange(next)
  }

  return (
    <label className="studio-field">
      <span className="studio-field-label" onPointerDown={scrub} title="Drag sideways to change">
        {label}
      </span>
      <span className="studio-field-input">
        <input
          inputMode="decimal"
          value={text}
          onFocus={(event) => {
            focused.current = true
            event.currentTarget.select()
            onBegin()
          }}
          onChange={(event) => {
            setText(event.target.value)
            const next = Number(event.target.value)
            if (event.target.value.trim() !== '' && Number.isFinite(next)) onChange(clamp(next))
          }}
          onBlur={() => {
            focused.current = false
            setText(shown)
            onEnd()
          }}
          onKeyDown={onKeyDown}
        />
        <em>{unit}</em>
      </span>
    </label>
  )
}
