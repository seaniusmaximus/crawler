import { PIN_GLYPH_PATHS } from './pinGlyphs.tsx'
import { LABEL_SCALE, pinName, type World, type WorldLabel, type WorldPin, type WorldRoute } from '../../model/worlds.ts'

/** Where the picture sits on screen: screen = picture × `s` + (`x`, `y`). */
export interface WorldCam {
  x: number
  y: number
  s: number
}

/** Dark ink on a light pin, light on a dark one. */
function inkFor(color: string): string {
  const n = Number.parseInt(color.slice(1), 16)
  const luma = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)
  return luma > 150 ? '#1a1609' : '#f6f1e4'
}

/** A teardrop with its tip on the spot: the head is centred 20px above it. */
const PIN_PATH = 'M0 0C-3.5-7-11-11.5-11-20a11 11 0 0122 0C11-11.5 3.5-7 0 0z'

interface MarksProps {
  world: World
  cam: WorldCam
  selected: string | null
  /** The battle map the party is on, so its pin can say so. */
  liveMapId: string | null
  /** The DM sees hidden marks, dimmed; players never get them. */
  editable: boolean
}

export function WorldRoutes({ world, cam, selected, editable }: MarksProps) {
  return (
    <>
      {world.routes.map((route) => (
        <Route key={route.id} route={route} cam={cam} selected={route.id === selected} editable={editable} />
      ))}
    </>
  )
}

function Route({ route, cam, selected, editable }: { route: WorldRoute; cam: WorldCam; selected: boolean; editable: boolean }) {
  const points = route.points.map(([x, y]) => `${cam.x + x * cam.s},${cam.y + y * cam.s}`).join(' ')
  return (
    <g className={`world-route${route.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`}>
      <polyline className="world-route-halo" points={points} />
      <polyline
        className="world-route-line"
        points={points}
        stroke={route.color}
        strokeDasharray={route.dashed ? '10 8' : undefined}
      />
      {/* A wide invisible stroke, so a thin route is easy to click. */}
      <polyline className="world-hit" points={points} data-mark="route" data-id={route.id} />
      {selected && editable
        ? route.points.map(([x, y], index) => (
            <circle
              key={index}
              className="world-vertex"
              cx={cam.x + x * cam.s}
              cy={cam.y + y * cam.s}
              r={5.5}
              data-vertex={index}
              data-id={route.id}
            />
          ))
        : null}
    </g>
  )
}

export function WorldLabels({ world, cam, selected }: MarksProps) {
  const unit = Math.max(world.image.width, world.image.height) * cam.s
  return (
    <>
      {world.labels.map((label) => (
        <Label key={label.id} label={label} cam={cam} unit={unit} selected={label.id === selected} />
      ))}
    </>
  )
}

function Label({ label, cam, unit, selected }: { label: WorldLabel; cam: WorldCam; unit: number; selected: boolean }) {
  const size = Math.max(4, LABEL_SCALE[label.size] * unit)
  return (
    <text
      className={`world-label${label.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}`}
      x={cam.x + label.x * cam.s}
      y={cam.y + label.y * cam.s}
      fontSize={size}
      strokeWidth={Math.max(1.5, size * 0.16)}
      data-mark="label"
      data-id={label.id}
    >
      {label.text.trim() || 'Label'}
    </text>
  )
}

export function WorldPins({ world, cam, selected, liveMapId, editable }: MarksProps) {
  return (
    <>
      {world.pins.map((pin) => (
        <Pin
          key={pin.id}
          pin={pin}
          cam={cam}
          selected={pin.id === selected}
          here={Boolean(pin.mapId && pin.mapId === liveMapId)}
          editable={editable}
        />
      ))}
    </>
  )
}

/** A pin's tooltip: its name, and where a double-click takes this seat. */
function pinTitle(pin: WorldPin, here: boolean, editable: boolean): string {
  const name = pinName(pin)
  if (here) return `${name}: the party is here. Double-click to go to it.`
  if (pin.mapId && editable) return `${name}. Double-click to move the party here.`
  return name
}

function Pin({ pin, cam, selected, here, editable }: { pin: WorldPin; cam: WorldCam; selected: boolean; here: boolean; editable: boolean }) {
  const ink = inkFor(pin.color)
  return (
    <g
      className={`world-pin${pin.hidden ? ' is-hidden' : ''}${selected ? ' is-selected' : ''}${here ? ' is-here' : ''}`}
      transform={`translate(${cam.x + pin.x * cam.s} ${cam.y + pin.y * cam.s})`}
      data-mark="pin"
      data-id={pin.id}
    >
      <title>{pinTitle(pin, here, editable)}</title>
      {here ? <circle className="world-pin-here" cx={0} cy={-20} r={15} /> : null}
      {selected ? <circle className="world-pin-ring" cx={0} cy={-20} r={15.5} /> : null}
      <ellipse className="world-pin-shadow" cx={0} cy={1} rx={5} ry={2} />
      <path className="world-pin-body" d={PIN_PATH} fill={pin.color} />
      <g
        transform="translate(-7.8 -27.8) scale(0.65)"
        fill="none"
        stroke={ink}
        color={ink}
        strokeWidth={2.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {PIN_GLYPH_PATHS[pin.glyph]}
      </g>
      {pin.mapId ? <circle className="world-pin-link" cx={8.5} cy={-29} r={3.6} /> : null}
      {pin.name.trim() ? (
        <text className="world-pin-name" x={0} y={15}>
          {pin.name.trim()}
        </text>
      ) : null}
    </g>
  )
}
