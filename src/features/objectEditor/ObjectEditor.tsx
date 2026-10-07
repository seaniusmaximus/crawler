import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { OBJECTS, type ObjectDef, type ObjectPart } from '../../objects/catalog.ts'
import { MAX_CUSTOM_PARTS, MAX_CUSTOM_SIZE, MAX_NAME_LENGTH, newPart, reshapePart } from '../../objects/custom.ts'
import { useEditorStore } from '../../state/editorStore.ts'
import { useObjectLibraryStore } from '../../state/objectLibraryStore.ts'
import { ElevationView } from './ElevationView.tsx'
import { centred, clampShift, mirrored, partName, translate, type Axis } from './geometry.ts'
import { Inspector, type ArrangeActions } from './Inspector.tsx'
import { IsoView } from './IsoView.tsx'
import { PlanView } from './PlanView.tsx'
import { useDraft } from './useDraft.ts'
import type { ViewProps } from './views.ts'

/** Picker group listing the DM's Custom objects. */
export const CUSTOM_OBJECTS = 'custom'

const SNAPS: ReadonlyArray<{ step: number; label: string }> = [
  { step: 0, label: 'Off' },
  { step: 0.01, label: '0.01' },
  { step: 0.05, label: '0.05' },
  { step: 0.1, label: '0.1' },
  { step: 0.25, label: '¼ cell' },
  { step: 0.5, label: '½ cell' },
]

const ADD: ReadonlyArray<{ id: 'box' | 'cylinder' | 'cone' | 'flat'; label: string; title: string }> = [
  { id: 'box', label: 'Box', title: 'A block: a seat, a shelf, a leg' },
  { id: 'cylinder', label: 'Cylinder', title: 'A round post, barrel or pot' },
  { id: 'cone', label: 'Cone', title: 'A round that narrows to a point: a flame, a spike' },
  { id: 'flat', label: 'Flat', title: 'Lies on the floor under everything: a rug, a stain' },
]

/**
 * Builds one of the DM's Custom objects out of boxes, rounds and flats.
 * Parts are moved and sized directly in a top view and a side view, and the
 * 3D view shows the object as the map will draw it.
 */
export function ObjectEditor() {
  const opened = useEditorStore((state) => state.objectEditor)
  if (!opened) return null
  // A fresh editor per object opened, so nothing from the last one lingers.
  return <Studio key={opened.id} opened={opened} />
}

function Studio({ opened }: { opened: ObjectDef }) {
  const close = useEditorStore((state) => state.closeObjectEditor)
  const customs = useObjectLibraryStore((state) => state.objects)
  const where = useObjectLibraryStore((state) => state.where)
  const error = useObjectLibraryStore((state) => state.error)
  const draft = useDraft(opened)
  const def = draft.draft
  const [selection, setSelection] = useState<number[]>(opened.parts.length ? [0] : [])
  const selected = selection.filter((index) => index < def.parts.length)
  const [hover, setHover] = useState<number | null>(null)
  const [snapStep, setSnapStep] = useState(0.05)
  const [sideAxis, setSideAxis] = useState<Axis>('x')
  const [confirm, setConfirm] = useState<'close' | 'delete' | null>(null)
  /** A layer being dragged in the list, and where it would land: above or below another. */
  const [dragging, setDragging] = useState<number | null>(null)
  const [dropAt, setDropAt] = useState<{ index: number; above: boolean } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const saved = customs.some((item) => item.id === opened.id)
  const dirty = JSON.stringify(def) !== JSON.stringify(opened)
  const full = def.parts.length >= MAX_CUSTOM_PARTS

  useEffect(() => rootRef.current?.focus(), [])

  function select(index: number | null, additive: boolean): void {
    if (index === null) {
      if (!additive) setSelection([])
      return
    }
    if (!additive) {
      setSelection([index])
      return
    }
    setSelection((current) => (current.includes(index) ? current.filter((i) => i !== index) : [...current, index]))
  }

  function selectMany(indices: readonly number[], additive: boolean): void {
    setSelection((current) => (additive ? [...new Set([...current, ...indices])] : [...indices]))
  }

  /** Append parts and select them. */
  function addParts(parts: ObjectPart[]): void {
    const room = MAX_CUSTOM_PARTS - draft.get().parts.length
    const adding = parts.slice(0, Math.max(0, room))
    if (adding.length === 0) return
    const first = draft.get().parts.length
    draft.commit((current) => ({ ...current, parts: [...current.parts, ...adding] }))
    setSelection(adding.map((_, i) => first + i))
  }

  function addPart(kind: (typeof ADD)[number]['id']): void {
    // New parts take the colours of the one selected, so a build stays in one material.
    const like = selected.length ? def.parts[selected.at(-1)!] : undefined
    const colors = like ? { color: like.color, ...(like.shape !== 'flat' && like.top ? { top: like.top } : {}) } : {}
    const box = { ...newPart(def), ...colors } as ObjectPart
    const part =
      kind === 'box'
        ? box
        : kind === 'flat'
          ? reshapePart(box, 'flat')
          : kind === 'cone'
            ? { ...(reshapePart(box, 'round') as Extract<ObjectPart, { shape: 'round' }>), r2: 0, h: 20 }
            : reshapePart(box, 'round')
    addParts([part])
  }

  /** Change every selected part as one undo step. */
  function changeSelected(change: (part: ObjectPart) => ObjectPart): void {
    if (selected.length === 0) return
    draft.commit((current) => ({ ...current, parts: current.parts.map((part, i) => (selected.includes(i) ? change(part) : part)) }))
  }

  const arrange: ArrangeActions = {
    duplicate: () => {
      const step = snapStep || 0.05
      addParts(selected.map((i) => translate(def.parts[i]!, step, step)))
    },
    mirror: (axis) => addParts(selected.map((i) => mirrored(def.parts[i]!, axis, def))),
    centre: (axis) => changeSelected((part) => centred(part, axis, def)),
    remove: () => {
      if (selected.length === 0) return
      draft.commit((current) => ({ ...current, parts: current.parts.filter((_, i) => !selected.includes(i)) }))
      setSelection([])
    },
  }

  /**
   * Move the selected parts up (toward the front, +1) or down the layers, one
   * step, keeping them selected. Layers decide only where parts overlap.
   */
  function shiftLayers(delta: 1 | -1): void {
    if (selected.length === 0) return
    const parts = [...def.parts]
    const chosen = new Set(selected)
    const order = [...chosen].sort((a, b) => (delta > 0 ? b - a : a - b))
    for (const index of order) {
      const target = index + delta
      if (target < 0 || target >= parts.length || chosen.has(target)) continue
      ;[parts[index], parts[target]] = [parts[target]!, parts[index]!]
      chosen.delete(index)
      chosen.add(target)
    }
    draft.commit((current) => ({ ...current, parts }))
    setSelection([...chosen])
  }

  /** Drop the part at `from` just above (in front of) or below the part at `onto`. */
  function dropLayer(from: number, onto: number, above: boolean): void {
    if (from === onto) return
    const parts = [...def.parts]
    const [moved] = parts.splice(from, 1)
    const anchor = from < onto ? onto - 1 : onto
    const to = above ? anchor + 1 : anchor
    parts.splice(to, 0, moved!)
    draft.commit((current) => ({ ...current, parts }))
    setSelection([to])
  }

  function startFrom(id: string): void {
    const source = [...OBJECTS, ...customs].find((item) => item.id === id)
    if (!source) return
    draft.commit((current) => ({ ...current, w: source.w, d: source.d, parts: source.parts.map((part) => ({ ...part })) }))
    setSelection(source.parts.length ? [0] : [])
  }

  function setFootprint(change: Partial<Pick<ObjectDef, 'w' | 'd'>>): void {
    draft.commit((current) => ({ ...current, ...change }))
  }

  function save(): void {
    const result = useObjectLibraryStore.getState().save(draft.get())
    if (!result) return
    const editor = useEditorStore.getState()
    editor.setObjectGroup(CUSTOM_OBJECTS)
    editor.setObjectKind(result.id)
    close()
  }

  function remove(): void {
    useObjectLibraryStore.getState().remove(opened.id)
    const editor = useEditorStore.getState()
    if (editor.objectKind === opened.id) editor.setObjectKind('table')
    close()
  }

  function requestClose(): void {
    if (dirty) setConfirm('close')
    else close()
  }

  // Keys stay in the editor: the map listens on the window, and Delete or T there would act on the map.
  function onKeyDown(event: ReactKeyboardEvent): void {
    event.stopPropagation()
    const target = event.target as HTMLElement
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (event.key === 'Escape') {
      event.preventDefault()
      if (typing) target.blur()
      else if (confirm) setConfirm(null)
      else if (selected.length) setSelection([])
      else requestClose()
      return
    }
    if (mod && key === 's') {
      event.preventDefault()
      save()
      return
    }
    if (typing) return
    if (mod && key === 'z') {
      event.preventDefault()
      if (event.shiftKey) draft.redo()
      else draft.undo()
    } else if (mod && key === 'y') {
      event.preventDefault()
      draft.redo()
    } else if (mod && key === 'd') {
      event.preventDefault()
      arrange.duplicate()
    } else if (mod && key === 'a') {
      event.preventDefault()
      setSelection(def.parts.map((_, i) => i))
    } else if (mod && (event.key === ']' || event.key === '[')) {
      event.preventDefault()
      shiftLayers(event.key === ']' ? 1 : -1)
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault()
      arrange.remove()
    } else if (event.key.startsWith('Arrow')) {
      event.preventDefault()
      const step = (snapStep || 0.01) * (event.shiftKey ? 5 : 1)
      const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0
      const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0
      const shift = clampShift(selected.map((i) => def.parts[i]!), dx, dy, def)
      changeSelected((part) => translate(part, shift.dx, shift.dy))
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault()
      const dz = (event.key === 'PageUp' ? 1 : -1) * (event.shiftKey ? 5 : 1)
      changeSelected((part) => translate(part, 0, 0, dz))
    }
  }

  const view: ViewProps = { draft, selected, hover, snapStep, onSelect: select, onSelectMany: selectMany, onHover: setHover }

  return (
    <div className="studio-backdrop" role="presentation">
      <div
        ref={rootRef}
        className="studio"
        role="dialog"
        aria-label={saved ? 'Edit object' : 'New object'}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="studio-bar">
          <span className="studio-title">{saved ? 'Edit object' : 'New object'}</span>
          <input
            className="studio-name"
            value={def.name}
            maxLength={MAX_NAME_LENGTH}
            onFocus={draft.begin}
            onBlur={draft.end}
            onChange={(event) => draft.set((current) => ({ ...current, name: event.target.value }))}
            aria-label="Object name"
            placeholder="Name"
          />
          <div className="studio-group" title="How many cells the object covers, before it's scaled on the map">
            <span>Footprint</span>
            <Stepper value={def.w} label="across" onChange={(w) => setFootprint({ w })} />
            <span className="studio-times">×</span>
            <Stepper value={def.d} label="deep" onChange={(d) => setFootprint({ d })} />
          </div>
          <label className="studio-group" title="Moves and sizes snap to this; hold Alt while dragging to ignore it">
            <span>Snap</span>
            <select className="tileset-select" value={snapStep} onChange={(event) => setSnapStep(Number(event.target.value))}>
              {SNAPS.map((item) => (
                <option key={item.step} value={item.step}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <div className="studio-group">
            <button type="button" className="studio-icon-btn" onClick={draft.undo} disabled={!draft.canUndo} title="Undo (Ctrl+Z)" aria-label="Undo">
              ↶
            </button>
            <button type="button" className="studio-icon-btn" onClick={draft.redo} disabled={!draft.canRedo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
              ↷
            </button>
          </div>
          <span className="studio-spacer" />
          {confirm === 'close' ? (
            <div className="studio-confirm">
              <span>Discard your changes?</span>
              <button type="button" className="dialog-button is-cancel" onClick={() => setConfirm(null)}>
                Keep editing
              </button>
              <button type="button" className="dialog-button is-danger" onClick={close}>
                Discard
              </button>
            </div>
          ) : confirm === 'delete' ? (
            <div className="studio-confirm">
              <span>Delete from Custom objects? Maps it stands on keep their copies.</span>
              <button type="button" className="dialog-button is-cancel" onClick={() => setConfirm(null)}>
                Keep it
              </button>
              <button type="button" className="dialog-button is-danger" onClick={remove}>
                Delete
              </button>
            </div>
          ) : (
            <>
              {saved && (
                <button type="button" className="dialog-button is-danger" onClick={() => setConfirm('delete')}>
                  Delete
                </button>
              )}
              <button type="button" className="dialog-button is-cancel" onClick={requestClose}>
                Cancel
              </button>
              <button
                type="button"
                className="dialog-button is-primary"
                onClick={save}
                disabled={def.parts.length === 0}
                title={def.parts.length === 0 ? 'Add a part first' : 'Save (Ctrl+S)'}
              >
                {saved ? 'Save' : 'Add to Custom objects'}
              </button>
            </>
          )}
        </header>

        <div className="studio-body">
          <aside className="studio-panel studio-parts">
            <div className="studio-panel-head">
              <h3>Layers</h3>
              <span className="studio-count">
                {def.parts.length}/{MAX_CUSTOM_PARTS}
              </span>
              <button
                type="button"
                className="studio-icon-btn is-small"
                onClick={() => shiftLayers(1)}
                disabled={selected.length === 0}
                title="Bring forward (Ctrl+])"
                aria-label="Bring forward"
              >
                ↑
              </button>
              <button
                type="button"
                className="studio-icon-btn is-small"
                onClick={() => shiftLayers(-1)}
                disabled={selected.length === 0}
                title="Send backward (Ctrl+[)"
                aria-label="Send backward"
              >
                ↓
              </button>
            </div>
            <p className="studio-hint">Where parts overlap, higher layers draw on top. Drag to reorder.</p>
            {/* Front-most first, like an image editor's layers: the last part paints last. */}
            <ul className="studio-part-list" onDragLeave={() => setDropAt(null)}>
              {def.parts
                .map((part, index) => ({ part, index }))
                .reverse()
                .map(({ part, index }) => (
                  <li
                    key={index}
                    className={
                      dropAt?.index === index && dragging !== null && dragging !== index
                        ? dropAt.above
                          ? 'is-drop-above'
                          : 'is-drop-below'
                        : undefined
                    }
                    onDragOver={(event) => {
                      if (dragging === null) return
                      event.preventDefault()
                      const box = event.currentTarget.getBoundingClientRect()
                      setDropAt({ index, above: event.clientY < box.top + box.height / 2 })
                    }}
                    onDrop={(event) => {
                      event.preventDefault()
                      if (dragging !== null && dropAt) dropLayer(dragging, dropAt.index, dropAt.above)
                      setDragging(null)
                      setDropAt(null)
                    }}
                  >
                    <button
                      type="button"
                      draggable
                      className={`studio-part-row${selected.includes(index) ? ' is-active' : ''}${hover === index ? ' is-hover' : ''}${dragging === index ? ' is-dragging' : ''}`}
                      onClick={(event) => select(index, event.shiftKey || event.ctrlKey || event.metaKey)}
                      onPointerEnter={() => setHover(index)}
                      onPointerLeave={() => setHover(null)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move'
                        event.dataTransfer.setData('text/plain', String(index))
                        setDragging(index)
                      }}
                      onDragEnd={() => {
                        setDragging(null)
                        setDropAt(null)
                      }}
                      aria-pressed={selected.includes(index)}
                    >
                      <span className="studio-grip" aria-hidden>
                        ⋮⋮
                      </span>
                      <span className="studio-swatch-dot" style={{ background: part.color }} />
                      <span className="studio-part-name">{partName(part, index)}</span>
                      {part.glow && (
                        <span className="studio-part-glow" title="Produces light">
                          ✦
                        </span>
                      )}
                      <span className="studio-part-meta">{part.shape === 'flat' ? 'floor' : `${part.z}–${part.z + part.h}`}</span>
                    </button>
                  </li>
                ))}
              {def.parts.length === 0 && <li className="studio-hint">No parts yet. Add one below.</li>}
            </ul>
            <div className="studio-add">
              {ADD.map((item) => (
                <button key={item.id} type="button" className="gold-btn" onClick={() => addPart(item.id)} disabled={full} title={item.title}>
                  + {item.label}
                </button>
              ))}
            </div>
            <label className="studio-from">
              <span>Start from</span>
              <select className="tileset-select" value="" onChange={(event) => startFrom(event.target.value)}>
                <option value="" disabled>
                  Copy another object…
                </option>
                <optgroup label="Catalog">
                  {OBJECTS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
                {customs.length > 0 && (
                  <optgroup label="Custom objects">
                    {customs.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <p className={`studio-where${error ? ' is-error' : ''}`}>
              {error ??
                (where === 'account'
                  ? 'Saved to Custom objects with your account.'
                  : 'Saved to Custom objects in this browser. Sign in to keep them with your account.')}
            </p>
          </aside>

          <section className="studio-views">
            <div className="studio-panel studio-view">
              <div className="studio-panel-head">
                <h3>Top</h3>
                <span className="studio-hint">Drag to move · handles to size · drag empty space to select</span>
              </div>
              <PlanView {...view} />
            </div>
            <div className="studio-panel studio-view">
              <div className="studio-panel-head">
                <h3>Side</h3>
                <div className="studio-segment is-small" role="group" aria-label="Which side">
                  <button type="button" className={sideAxis === 'x' ? 'is-active' : ''} onClick={() => setSideAxis('x')}>
                    Front
                  </button>
                  <button type="button" className={sideAxis === 'y' ? 'is-active' : ''} onClick={() => setSideAxis('y')}>
                    Left
                  </button>
                </div>
                <span className="studio-hint">Drag up and down to raise · top and bottom handles set height</span>
              </div>
              <ElevationView {...view} axis={sideAxis} />
            </div>
          </section>

          <section className="studio-side">
            <div className="studio-panel studio-view is-iso">
              <div className="studio-panel-head">
                <h3>3D</h3>
                <span className="studio-hint">Click a part to select it</span>
              </div>
              <IsoView def={def} selected={selected} hover={hover} onSelect={select} onHover={setHover} />
            </div>
            <div className="studio-panel studio-inspector-wrap">
              <Inspector draft={draft} selected={selected} arrange={arrange} />
            </div>
          </section>
        </div>

        <footer className="studio-keys">
          <span><kbd>Shift</kbd>-click select several</span>
          <span><kbd>←↑→↓</kbd> nudge</span>
          <span><kbd>PgUp</kbd>/<kbd>PgDn</kbd> raise, lower</span>
          <span><kbd>Alt</kbd>-drag no snap</span>
          <span><kbd>Ctrl+D</kbd> duplicate</span>
          <span><kbd>Ctrl+]</kbd>/<kbd>Ctrl+[</kbd> layer up, down</span>
          <span><kbd>Del</kbd> remove</span>
          <span><kbd>Ctrl+Z</kbd> undo</span>
          <span><kbd>Ctrl+S</kbd> save</span>
        </footer>
      </div>
    </div>
  )
}

function Stepper({ value, label, onChange }: { value: number; label: string; onChange: (value: number) => void }) {
  return (
    <span className="studio-stepper" role="group" aria-label={`Cells ${label}`}>
      <button type="button" onClick={() => onChange(Math.max(1, value - 1))} disabled={value <= 1} aria-label={`Fewer cells ${label}`}>
        −
      </button>
      <strong>{value}</strong>
      <button type="button" onClick={() => onChange(Math.min(MAX_CUSTOM_SIZE, value + 1))} disabled={value >= MAX_CUSTOM_SIZE} aria-label={`More cells ${label}`}>
        +
      </button>
    </span>
  )
}
