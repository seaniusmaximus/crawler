import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { markId, WORLD_COLORS, type World, type WorldMark } from '../../model/worlds.ts'
import { useNotesStore } from '../../state/notesStore.ts'
import { useSessionStore } from '../../state/sessionStore.ts'
import { useViewedWorld, useWorldStore, type WorldTool } from '../../state/worldStore.ts'
import { Contained } from '../../ui/Contained.tsx'
import { Icon } from '../../ui/Icon.tsx'
import { goToPin } from './goToPin.ts'
import { TravelConfirm } from './TravelConfirm.tsx'
import { PinCard, WorldInspector } from './WorldInspector.tsx'
import { WorldLabels, WorldPins, WorldRoutes, type WorldCam } from './WorldMarks.tsx'

/** How far in past "fits the window" the map zooms, and how far out. */
const MAX_ZOOM_OVER_FIT = 10
const MIN_ZOOM_OF_FIT = 0.5
/** A press that moves less than this (in screen pixels) is a click. */
const CLICK_SLOP = 4

const TOOLS: { id: WorldTool; icon: string; label: string; title: string }[] = [
  { id: 'select', icon: 'select', label: 'Move', title: 'Drag the map to look around; click a mark to edit it, drag to move it' },
  { id: 'pin', icon: 'pin', label: 'Pin', title: 'Click the map to place a pin: a town, a dungeon, a way into a battle map' },
  { id: 'label', icon: 'label', label: 'Label', title: 'Click the map to letter a name across it' },
  { id: 'route', icon: 'route', label: 'Route', title: 'Click point by point to draw a road or a journey; double-click to finish' },
]

const HINTS: Partial<Record<WorldTool, string>> = {
  pin: 'Click the map to place a pin.',
  label: 'Click the map to place a label.',
  route: 'Click to add points. Double-click or Enter to finish; Esc to cancel.',
}

/** A world map over the battle map, while one is open on this screen. */
export function WorldView() {
  const host = useSessionStore((state) => state.role === 'host')
  const world = useViewedWorld(host)
  if (!world) return null
  return (
    <Contained
      name="World map"
      resetKey={world.id}
      onError={() => {
        // Said out loud in the Maps panel: closing quietly looks like the click did nothing.
        useWorldStore.setState({ error: 'That world map hit a problem and closed. The browser console has the details.' })
        useWorldStore.getState().view(null)
      }}
    >
      <WorldScreen key={world.id} world={world} editable={host} />
    </Contained>
  )
}

/** For a player who stepped back to the battle map while the DM is showing a world map: the way back to it. */
export function WorldReturn() {
  const guest = useSessionStore((state) => state.role === 'guest')
  const shown = useWorldStore((state) => state.shown)
  const viewing = useWorldStore((state) => state.viewingId)
  if (!guest || !shown || viewing) return null
  return (
    <button type="button" className="panel world-return" onClick={() => useWorldStore.getState().view(shown.id)}>
      <Icon id="world" size={16} className="is-gold" />
      <span>
        The DM is showing <strong>{shown.name}</strong>
      </span>
    </button>
  )
}

type Gesture =
  | { kind: 'pan'; startX: number; startY: number; cam: WorldCam; moved: boolean; deselect: boolean }
  | { kind: 'mark'; mark: WorldMark; startX: number; startY: number; dx: number; dy: number; moved: boolean }
  | { kind: 'vertex'; routeId: string; index: number }

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function WorldScreen({ world, editable }: { world: World; editable: boolean }) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState<{ w: number; h: number } | null>(null)
  const [cam, setCam] = useState<WorldCam | null>(null)
  // Handlers read the camera from here, so a wheel spin or drag never works from a stale one.
  const camRef = useRef<WorldCam | null>(null)
  useLayoutEffect(() => {
    camRef.current = cam
  }, [cam])
  const gesture = useRef<Gesture | null>(null)
  const [hover, setHover] = useState<[number, number] | null>(null)

  const tool = useWorldStore((state) => (editable ? state.tool : 'select'))
  const selected = useWorldStore((state) => state.selected)
  const draft = useWorldStore((state) => state.draft)
  const shownId = useWorldStore((state) => state.shownId)
  const error = useWorldStore((state) => state.error)
  const liveMapId = useNotesStore((state) => state.mapId)
  const { width: iw, height: ih } = world.image

  const fit = useCallback(
    (box: { w: number; h: number }): WorldCam => {
      const s = Math.min(box.w / iw, box.h / ih) * 0.94
      return { s, x: (box.w - iw * s) / 2, y: (box.h - ih * s) / 2 }
    },
    [iw, ih],
  )

  // Follow the window's size; fit the picture the first time.
  useLayoutEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = (): void => {
      const box = { w: stage.clientWidth, h: stage.clientHeight }
      setSize(box)
      setCam((current) => current ?? fit(box))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [fit])

  const toPicture = useCallback((clientX: number, clientY: number): [number, number] | null => {
    const stage = stageRef.current
    const view = camRef.current
    if (!stage || !view) return null
    const rect = stage.getBoundingClientRect()
    return [(clientX - rect.left - view.x) / view.s, (clientY - rect.top - view.y) / view.s]
  }, [])

  const onPicture = useCallback(
    (point: [number, number] | null): point is [number, number] =>
      Boolean(point && point[0] >= 0 && point[1] >= 0 && point[0] <= iw && point[1] <= ih),
    [iw, ih],
  )

  // The wheel zooms about the pointer. Not through React: its wheel listener can't stop the page scrolling.
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    function onWheel(event: WheelEvent): void {
      event.preventDefault()
      const view = camRef.current
      const box = stage ? { w: stage.clientWidth, h: stage.clientHeight } : null
      if (!view || !box || !stage) return
      const fitted = fit(box).s
      const factor = Math.exp(-event.deltaY * (event.deltaMode === 1 ? 0.05 : 0.0015))
      const s = Math.min(fitted * MAX_ZOOM_OVER_FIT, Math.max(fitted * MIN_ZOOM_OF_FIT, view.s * factor))
      const rect = stage.getBoundingClientRect()
      const px = event.clientX - rect.left
      const py = event.clientY - rect.top
      setCam({ s, x: px - ((px - view.x) / view.s) * s, y: py - ((py - view.y) / view.s) * s })
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [fit])

  const finishRoute = useCallback(() => {
    const store = useWorldStore.getState()
    const points = (store.draft ?? []).filter(
      // A double-click lands its last point twice.
      (point, index, all) => index === 0 || Math.hypot(point[0] - all[index - 1][0], point[1] - all[index - 1][1]) > 0.5,
    )
    store.setDraft(null)
    if (points.length < 2) return
    const id = markId()
    store.update(world.id, (current) => ({
      routes: [...current.routes, { id, points, color: WORLD_COLORS[1], dashed: true, hidden: false }],
    }))
    store.setTool('select')
    store.select({ kind: 'route', id })
  }, [world.id])

  const close = useCallback(() => {
    const store = useWorldStore.getState()
    // The DM leaving the world map they're showing brings everyone back to the battle map.
    if (editable && store.shownId === world.id) store.show(null)
    store.view(null)
  }, [editable, world.id])

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (isTyping(event.target)) return
      const store = useWorldStore.getState()
      if (event.code === 'Escape') {
        if (store.draft) store.setDraft(null)
        else if (store.tool !== 'select') store.setTool('select')
        else if (store.selected) store.select(null)
        // Not while the DM is showing it: a stray Escape shouldn't flip every player's screen.
        else if (!(editable && store.shownId === world.id)) close()
        return
      }
      // Keys pressed on the mark's own panel are for its fields and buttons.
      if (event.target instanceof Element && event.target.closest('.world-side')) return
      if (event.code === 'Enter' && store.draft) {
        finishRoute()
        return
      }
      if (editable && store.selected && (event.code === 'Delete' || event.code === 'Backspace')) {
        const mark = store.selected
        const key = mark.kind === 'pin' ? 'pins' : mark.kind === 'label' ? 'labels' : 'routes'
        store.update(world.id, (current) => ({ [key]: (current[key] as { id: string }[]).filter((item) => item.id !== mark.id) }))
        store.select(null)
        event.preventDefault()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, editable, finishRoute, world.id])

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    const view = camRef.current
    if (!view) return
    const store = useWorldStore.getState()
    const target = event.target as Element
    const panOnly = event.button === 1 || event.button === 2
    if (event.button !== 0 && !panOnly) return
    event.currentTarget.setPointerCapture(event.pointerId)

    const startPan = (deselect: boolean): void => {
      gesture.current = { kind: 'pan', startX: event.clientX, startY: event.clientY, cam: view, moved: false, deselect }
    }
    if (panOnly) return startPan(false)

    const point = toPicture(event.clientX, event.clientY)
    if (tool === 'pin' || tool === 'label') {
      if (!onPicture(point)) return startPan(false)
      const id = markId()
      const [x, y] = point
      store.update(world.id, (current) =>
        tool === 'pin'
          ? {
              pins: [
                ...current.pins,
                { id, x, y, name: '', glyph: 'dot', color: WORLD_COLORS[0], text: '', secret: '', mapId: null, hidden: false },
              ],
            }
          : { labels: [...current.labels, { id, x, y, text: 'New label', size: 'm', hidden: false }] },
      )
      store.setTool('select')
      store.select({ kind: tool, id })
      return
    }
    if (tool === 'route') {
      if (!onPicture(point)) return startPan(false)
      store.setDraft([...(store.draft ?? []), point])
      return
    }

    // Moving about and picking marks.
    const vertex = editable ? target.closest('[data-vertex]') : null
    if (vertex) {
      gesture.current = { kind: 'vertex', routeId: vertex.getAttribute('data-id') ?? '', index: Number(vertex.getAttribute('data-vertex')) }
      return
    }
    const hit = target.closest('[data-mark]')
    const kind = hit?.getAttribute('data-mark') as WorldMark['kind'] | undefined
    const id = hit?.getAttribute('data-id')
    // Players open pins; labels and routes are just part of the picture to them.
    if (kind && id && (editable || kind === 'pin')) {
      store.select({ kind, id })
      const item = kind === 'pin' ? world.pins.find((pin) => pin.id === id) : kind === 'label' ? world.labels.find((label) => label.id === id) : null
      if (editable && item && point) {
        gesture.current = { kind: 'mark', mark: { kind, id }, startX: event.clientX, startY: event.clientY, dx: item.x - point[0], dy: item.y - point[1], moved: false }
        return
      }
      return startPan(false)
    }
    startPan(true)
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>): void {
    const active = gesture.current
    if (!active) {
      if (tool === 'route' && draft) setHover(toPicture(event.clientX, event.clientY))
      return
    }
    if (active.kind === 'pan') {
      const dx = event.clientX - active.startX
      const dy = event.clientY - active.startY
      if (!active.moved && Math.hypot(dx, dy) < CLICK_SLOP) return
      active.moved = true
      setCam({ ...active.cam, x: active.cam.x + dx, y: active.cam.y + dy })
      return
    }
    const point = toPicture(event.clientX, event.clientY)
    if (!point) return
    const x = Math.min(iw, Math.max(0, point[0]))
    const y = Math.min(ih, Math.max(0, point[1]))
    const store = useWorldStore.getState()
    if (active.kind === 'vertex') {
      store.update(world.id, (current) => ({
        routes: current.routes.map((route) =>
          route.id === active.routeId
            ? { ...route, points: route.points.map((p, index): [number, number] => (index === active.index ? [x, y] : p)) }
            : route,
        ),
      }))
      return
    }
    if (!active.moved && Math.hypot(event.clientX - active.startX, event.clientY - active.startY) < CLICK_SLOP) return
    active.moved = true
    const nx = Math.min(iw, Math.max(0, x + active.dx))
    const ny = Math.min(ih, Math.max(0, y + active.dy))
    const { mark } = active
    if (mark.kind === 'pin') {
      store.update(world.id, (current) => ({ pins: current.pins.map((pin) => (pin.id === mark.id ? { ...pin, x: nx, y: ny } : pin)) }))
    } else if (mark.kind === 'label') {
      store.update(world.id, (current) => ({
        labels: current.labels.map((label) => (label.id === mark.id ? { ...label, x: nx, y: ny } : label)),
      }))
    }
  }

  function onPointerUp(): void {
    const active = gesture.current
    gesture.current = null
    // A click on bare map lets go of the picked mark.
    if (active?.kind === 'pan' && !active.moved && active.deselect) useWorldStore.getState().select(null)
  }

  function zoomBy(factor: number): void {
    if (!cam || !size) return
    const fitted = fit(size).s
    const s = Math.min(fitted * MAX_ZOOM_OVER_FIT, Math.max(fitted * MIN_ZOOM_OF_FIT, cam.s * factor))
    const px = size.w / 2
    const py = size.h / 2
    setCam({ s, x: px - ((px - cam.x) / cam.s) * s, y: py - ((py - cam.y) / cam.s) * s })
  }

  const selectedPin = selected?.kind === 'pin' ? world.pins.find((pin) => pin.id === selected.id) : undefined
  const showing = shownId === world.id
  const hint = editable ? HINTS[tool] : undefined
  const marks = cam ? { world, cam, selected: selected?.id ?? null, liveMapId, editable } : null

  return (
    <div className="world-view" role="dialog" aria-label={`World map: ${world.name}`}>
      <header className="world-bar">
        <Icon id="world" size={20} className="is-gold" />
        <div className="world-title">
          <span className="kicker">{editable ? (showing ? 'World map · the table sees it' : 'World map') : 'The DM is showing'}</span>
          <strong>{world.name}</strong>
        </div>
        {editable ? (
          <div className="segmented world-tools" role="toolbar" aria-label="World map tools">
            {TOOLS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={tool === item.id ? 'is-active' : ''}
                aria-pressed={tool === item.id}
                title={item.title}
                onClick={() => useWorldStore.getState().setTool(item.id)}
              >
                <Icon id={item.icon} size={14} />
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="world-bar-end">
          {editable ? (
            <button
              type="button"
              className={`chip-btn world-show${showing ? ' is-gold' : ''}`}
              aria-pressed={showing}
              title={showing ? "Take it off the players' screens" : "Put this world map on every player's screen"}
              onClick={() => useWorldStore.getState().show(showing ? null : world.id)}
            >
              <Icon id={showing ? 'eye' : 'share'} size={14} />
              {showing ? 'Showing the table' : 'Show the table'}
            </button>
          ) : null}
          <button type="button" className="outline-btn is-small" onClick={close}>
            <Icon id="chevronLeft" size={14} />
            {editable && showing ? 'Everyone back to the battle map' : 'Back to the battle map'}
          </button>
        </div>
      </header>

      {hint || error ? (
        <div className="world-hint" role="status">
          {error ? (
            <>
              <span className="is-error">{error}</span>
              <button type="button" className="text-btn" onClick={() => useWorldStore.getState().dismissError()}>
                Dismiss
              </button>
            </>
          ) : (
            <>
              <span>{hint}</span>
              {tool === 'route' && draft ? (
                <>
                  <button type="button" className="text-btn" onClick={() => useWorldStore.getState().setDraft(null)}>
                    Cancel
                  </button>
                  <button type="button" className="outline-btn is-small" disabled={draft.length < 2} onClick={finishRoute}>
                    Finish route
                  </button>
                </>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      <div
        ref={stageRef}
        className={`world-stage is-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onDoubleClick={(event) => {
          if (tool === 'route' && draft) {
            finishRoute()
            return
          }
          // Double-clicking a pin that leads to a battle map goes there.
          if (tool !== 'select') return
          // By what's under the pointer: with the pointer captured, the event itself names the stage.
          const under = document.elementFromPoint(event.clientX, event.clientY)
          const id = under?.closest('[data-mark="pin"]')?.getAttribute('data-id')
          const pin = world.pins.find((item) => item.id === id)
          if (pin) goToPin(world, pin)
        }}
      >
        {cam && marks ? (
          <svg className="world-svg" width="100%" height="100%">
            <image
              href={world.image.src}
              x={cam.x}
              y={cam.y}
              width={iw * cam.s}
              height={ih * cam.s}
              preserveAspectRatio="none"
            />
            <WorldRoutes {...marks} />
            {draft ? <Draft points={draft} hover={hover} cam={cam} /> : null}
            <WorldLabels {...marks} />
            <WorldPins {...marks} />
          </svg>
        ) : null}
      </div>

      <div className="world-zoom panel">
        <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => zoomBy(1.4)}>
          <Icon id="plus" size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => zoomBy(1 / 1.4)}>
          <Icon id="minus" size={16} />
        </button>
        <button type="button" className="icon-btn" aria-label="Fit to window" title="Fit to window" onClick={() => size && setCam(fit(size))}>
          <Icon id="resize" size={15} />
        </button>
      </div>

      {selected && editable ? <WorldInspector key={selected.id} world={world} mark={selected} /> : null}
      {selectedPin && !editable ? <PinCard world={world} pin={selectedPin} /> : null}
      {editable ? <TravelConfirm world={world} /> : null}
    </div>
  )
}

/** A route still being drawn, with a line out to the pointer. */
function Draft({ points, hover, cam }: { points: [number, number][]; hover: [number, number] | null; cam: WorldCam }) {
  const all = hover ? [...points, hover] : points
  const screen = all.map(([x, y]) => `${cam.x + x * cam.s},${cam.y + y * cam.s}`).join(' ')
  return (
    <g className="world-draft">
      <polyline points={screen} />
      {points.map(([x, y], index) => (
        <circle key={index} cx={cam.x + x * cam.s} cy={cam.y + y * cam.s} r={4} />
      ))}
    </g>
  )
}
