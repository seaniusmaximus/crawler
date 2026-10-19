import { create } from 'zustand'
import { rotateAt, zoomAt } from '../canvas/camera.ts'
import { areaColor, clampAreaFeet, clampLineWidth, type AreaShape } from '../model/marks.ts'
import type { TemplateKind } from '../model/monsterTemplates.ts'
import type { SpellArea } from '../model/spells.ts'
import type { AreaMark } from '../model/marks.ts'
import type { CastRoll } from '../features/areas/castRolls.ts'
import { nextTurn } from '../model/objects.ts'
import type { DoorStyle, Tool } from '../model/tools.ts'
import type { StairLanding, StairUsePrompt } from '../model/stairs.ts'
import type { ViewMode } from '../model/visibility.ts'
import type { Camera, ObjectTurn, StairsDir } from '../model/types.ts'
import type { ObjectDef } from '../objects/catalog.ts'

export interface RoomMenu {
  kind: 'room'
  roomId: string
  /** The cell right-clicked, where a pulled token lands (or as near as it can). */
  cellX: number
  cellY: number
  x: number
  y: number
}

export interface OpeningMenu {
  kind: 'opening'
  roomId: string
  cellX: number
  cellY: number
  x: number
  y: number
}

export interface ObjectMenu {
  kind: 'object'
  roomId: string
  objectId: string
  x: number
  y: number
}

/** One object in one room on the active floor. */
export interface ObjectRef {
  roomId: string
  objectId: string
}

export interface PlayerMenu {
  kind: 'player'
  playerId: string
  x: number
  y: number
}

/** A spell cast from a sheet: whose token it comes from, and the spell's name for the hint. */
export interface AreaCast {
  playerId: string
  name: string
  /** What the area does once down: the spell's name, duration and lingering damage. */
  effects?: Pick<AreaMark, 'name' | 'duration' | 'damage'>
  /** What it does to the creatures in it as it lands (Fireball): their saves, and its damage or healing. */
  onCast?: CastRoll
  /** It is over as soon as it has gone off: its area shows for a moment, then goes. */
  instant?: boolean
  /** A cube that comes out of the caster rather than landing in range. */
  fromCaster?: boolean
}

/** A spell area on the map, right-clicked with the area tool: its settings. */
export interface AreaMenu {
  kind: 'area'
  areaId: string
  x: number
  y: number
}

export type Menu = RoomMenu | OpeningMenu | ObjectMenu | PlayerMenu | AreaMenu

/** `leftInset` keeps the room centred in the area a docked panel is not covering. */
export interface CreaturePicker {
  kind: TemplateKind
  ownerId: string | null
}

export interface FocusRequest {
  roomId?: string
  playerId?: string
  leftInset: number
  nonce: number
}

let focusNonce = 0

interface EditorState {
  camera: Camera
  viewport: { width: number; height: number }
  tool: Tool
  doorStyle: DoorStyle
  stairsDir: StairsDir
  /** Rooms can't be dragged around (this browser's choice), so play can't knock the map out of place. */
  roomsLocked: boolean
  /** The Stairs tool is set to join rooms on this floor rather than lead to another floor. */
  stairsBetween: boolean
  activeFloorId: string | null
  selectedRoomId: string | null
  hoverRoomId: string | null
  selectedPlayerId: string | null
  hoverPlayerId: string | null
  resizeRoomId: string | null
  /** The Link button is set to merge rooms into one rather than link them. */
  linkMerge: boolean
  /** Catalog id of the object the Objects tool places. */
  objectKind: string
  /** How the next placed object is turned. */
  objectTurn: ObjectTurn
  /** Which tileset's objects the picker lists ('all' for every object); null follows the map's tileset. */
  objectGroup: string | null
  /** A placed object clicked with the Objects tool; Delete removes it rather than its room. */
  selectedObject: ObjectRef | null
  /** First room picked with the link or merge tool, waiting for its partner. */
  linkRoomId: string | null
  menu: Menu | null
  focus: FocusRequest | null
  stairsPrompt: StairLanding[] | null
  stairUse: StairUsePrompt | null
  /** A map tileset waiting on whether rooms with their own tileset keep it. */
  tilesetPrompt: string | null
  /**
   * The open Add monster or Add companion picker (saved ones, or a blank one);
   * `ownerId` is who a companion is for when it opens. Null when closed.
   */
  creaturePicker: CreaturePicker | null
  /** The object open in the object editor, as it was when opened; null when the editor is closed. */
  objectEditor: ObjectDef | null
  viewMode: ViewMode
  /** The shape and size the area of effect tool lays down, in feet. */
  aoeShape: AreaShape
  aoeFeet: number
  /** How wide a line is, in feet. */
  aoeWidth: number
  /** An emanation or cube covers its own caster too. */
  aoeIncludeSelf: boolean
  /** Which of the area colours new areas are washed in; null is each caster's token colour. */
  aoeColor: string | null
  /** New areas are hidden from players (the DM's traps); never set for a player. */
  aoeHidden: boolean
  /**
   * A spell being cast from a sheet: the area tool is set to its shape and size,
   * which a drag no longer changes, and a cone, line or cube comes out of the
   * caster. Null when the tool is used freehand.
   */
  aoeCast: AreaCast | null
  /** Token whose character sheet or stat block is open beside its card. */
  sheetPlayerId: string | null
  setCamera: (camera: Camera) => void
  setViewport: (width: number, height: number) => void
  rotateView: (steps: number) => void
  zoomView: (factor: number) => void
  setTool: (tool: Tool) => void
  setDoorStyle: (style: DoorStyle) => void
  setStairsDir: (dir: StairsDir) => void
  setRoomsLocked: (locked: boolean) => void
  setStairsBetween: () => void
  /** Set the Link button to link rooms, or to merge them into one. */
  setLinkMerge: (merge: boolean) => void
  /** Pick the object the Objects tool places, switching to that tool. */
  setObjectKind: (kind: string) => void
  /** Turn the object about to be placed by quarter turns. */
  turnObjectDraft: (steps: number) => void
  setObjectGroup: (group: string | null) => void
  selectObject: (object: ObjectRef | null) => void
  setActiveFloor: (floorId: string) => void
  selectRoom: (roomId: string | null) => void
  setHoverRoom: (roomId: string | null) => void
  selectPlayer: (playerId: string | null) => void
  setHoverPlayer: (playerId: string | null) => void
  setLinkRoom: (roomId: string | null) => void
  openMenu: (menu: Menu) => void
  closeMenu: () => void
  beginResize: (roomId: string) => void
  endResize: () => void
  focusRoom: (floorId: string, roomId: string, leftInset: number) => void
  focusPlayer: (playerId: string, leftInset: number) => void
  promptStairLandings: (landings: StairLanding[]) => void
  closeStairsPrompt: () => void
  promptStairUse: (prompt: StairUsePrompt) => void
  closeStairUse: () => void
  promptTileset: (id: string) => void
  closeTilesetPrompt: () => void
  setCreaturePicker: (picker: CreaturePicker | null) => void
  openObjectEditor: (def: ObjectDef) => void
  closeObjectEditor: () => void
  setViewMode: (mode: ViewMode) => void
  openSheet: (playerId: string | null) => void
  /** Pick the area's shape, switching to the area tool. */
  setAoeShape: (shape: AreaShape) => void
  /** Take up the area tool to lay down a spell's area, for `cast.playerId`'s token. */
  castArea: (cast: AreaCast, area: SpellArea) => void
  setAoeFeet: (feet: number) => void
  setAoeWidth: (feet: number) => void
  setAoeIncludeSelf: (include: boolean) => void
  setAoeColor: (color: string | null) => void
  setAoeHidden: (hidden: boolean) => void
}

const ROOMS_LOCKED_KEY = 'crawler.roomsLocked'

function readRoomsLocked(): boolean {
  try {
    return window.localStorage.getItem(ROOMS_LOCKED_KEY) === 'on'
  } catch {
    return false
  }
}

export const useEditorStore = create<EditorState>((set) => ({
  camera: { x: 0, y: 0, zoom: 1.25, yaw: 0 },
  viewport: { width: 1, height: 1 },
  tool: 'select',
  doorStyle: 'door',
  stairsDir: 'both',
  roomsLocked: readRoomsLocked(),
  stairsBetween: false,
  linkMerge: false,
  objectKind: 'table',
  objectTurn: 0,
  objectGroup: null,
  selectedObject: null,
  activeFloorId: null,
  selectedRoomId: null,
  hoverRoomId: null,
  selectedPlayerId: null,
  hoverPlayerId: null,
  resizeRoomId: null,
  linkRoomId: null,
  menu: null,
  focus: null,
  stairsPrompt: null,
  stairUse: null,
  tilesetPrompt: null,
  creaturePicker: null,
  objectEditor: null,
  viewMode: 'dm',
  aoeShape: 'circle',
  aoeFeet: 20,
  aoeWidth: 5,
  aoeIncludeSelf: false,
  aoeColor: null,
  aoeHidden: false,
  aoeCast: null,
  sheetPlayerId: null,
  setCamera: (camera) => set({ camera }),
  setViewport: (width, height) => set({ viewport: { width, height } }),
  rotateView: (steps) =>
    set((state) => ({
      camera: rotateAt(state.camera, state.viewport.width / 2, state.viewport.height / 2, steps),
    })),
  zoomView: (factor) =>
    set((state) => ({
      camera: zoomAt(state.camera, state.viewport.width / 2, state.viewport.height / 2, factor),
    })),
  // Resize handles belong to the rooms tool, so leaving it ends resize mode.
  // Picking Stairs or Link comes back to whichever kind was last chosen.
  // Picking any tool, the area tool included, ends casting a spell from a sheet.
  setTool: (tool) =>
    set((state) => ({
      aoeCast: null,
      tool:
        tool === 'stairs' && state.stairsBetween
          ? 'ramp'
          : tool === 'link' && state.linkMerge
            ? 'merge'
            : tool,
      menu: null,
      resizeRoomId: null,
      linkRoomId: null,
      selectedObject: tool === 'objects' ? state.selectedObject : null,
    })),
  setDoorStyle: (doorStyle) => set({ doorStyle, tool: 'doors' }),
  setRoomsLocked: (roomsLocked) => {
    try {
      window.localStorage.setItem(ROOMS_LOCKED_KEY, roomsLocked ? 'on' : 'off')
    } catch {
      // Storage blocked: the lock lasts until reload.
    }
    set({ roomsLocked })
  },
  setStairsDir: (stairsDir) => set({ stairsDir, stairsBetween: false, tool: 'stairs' }),
  setStairsBetween: () => set({ stairsBetween: true, tool: 'ramp' }),
  setLinkMerge: (linkMerge) =>
    set({ linkMerge, tool: linkMerge ? 'merge' : 'link', menu: null, resizeRoomId: null, linkRoomId: null }),
  // Selection, hover and resize all point at rooms on the floor being left.
  setObjectKind: (objectKind) => set({ objectKind, tool: 'objects', menu: null, resizeRoomId: null, linkRoomId: null }),
  turnObjectDraft: (steps) => set((state) => ({ objectTurn: nextTurn(state.objectTurn, steps) })),
  setObjectGroup: (objectGroup) => set({ objectGroup }),
  selectObject: (selectedObject) => set({ selectedObject }),
  setActiveFloor: (floorId) =>
    set({
      activeFloorId: floorId,
      selectedRoomId: null,
      hoverRoomId: null,
      hoverPlayerId: null,
      resizeRoomId: null,
      linkRoomId: null,
      selectedObject: null,
      menu: null,
    }),
  selectRoom: (roomId) =>
    set((state) => ({
      selectedRoomId: roomId,
      selectedPlayerId: roomId ? null : state.selectedPlayerId,
      selectedObject: null,
      menu: null,
      resizeRoomId: state.resizeRoomId === roomId ? state.resizeRoomId : null,
    })),
  setHoverRoom: (roomId) => set({ hoverRoomId: roomId }),
  selectPlayer: (playerId) =>
    set((state) => ({
      selectedPlayerId: playerId,
      selectedRoomId: playerId ? null : state.selectedRoomId,
      selectedObject: playerId ? null : state.selectedObject,
      resizeRoomId: playerId ? null : state.resizeRoomId,
      menu: playerId ? null : state.menu,
    })),
  setHoverPlayer: (playerId) => set({ hoverPlayerId: playerId }),
  setLinkRoom: (roomId) => set({ linkRoomId: roomId }),
  openMenu: (menu) =>
    set(
      menu.kind === 'area'
        ? { menu }
        : menu.kind === 'player'
        ? { selectedPlayerId: menu.playerId, selectedRoomId: null, selectedObject: null, resizeRoomId: null, menu }
        : {
            selectedRoomId: menu.roomId,
            selectedPlayerId: null,
            // Delete then takes away what was right-clicked: this object, or else the room.
            selectedObject: menu.kind === 'object' ? { roomId: menu.roomId, objectId: menu.objectId } : null,
            menu,
          },
    ),
  closeMenu: () => set({ menu: null }),
  beginResize: (roomId) => set({ resizeRoomId: roomId, selectedRoomId: roomId, menu: null }),
  endResize: () => set({ resizeRoomId: null }),
  focusRoom: (floorId, roomId, leftInset) =>
    set({
      activeFloorId: floorId,
      selectedRoomId: roomId,
      selectedPlayerId: null,
      resizeRoomId: null,
      linkRoomId: null,
      menu: null,
      focus: { roomId, leftInset, nonce: ++focusNonce },
    }),
  focusPlayer: (playerId, leftInset) =>
    set({
      selectedPlayerId: playerId,
      selectedRoomId: null,
      resizeRoomId: null,
      menu: null,
      focus: { playerId, leftInset, nonce: ++focusNonce },
    }),
  promptStairLandings: (landings) => set({ stairsPrompt: landings.length > 0 ? landings : null }),
  closeStairsPrompt: () => set({ stairsPrompt: null }),
  promptStairUse: (stairUse) => set({ stairUse: stairUse.exits.length > 0 ? stairUse : null }),
  closeStairUse: () => set({ stairUse: null }),
  promptTileset: (tilesetPrompt) => set({ tilesetPrompt }),
  closeTilesetPrompt: () => set({ tilesetPrompt: null }),
  setCreaturePicker: (creaturePicker) => set({ creaturePicker }),
  openObjectEditor: (objectEditor) => set({ objectEditor, menu: null }),
  closeObjectEditor: () => set({ objectEditor: null }),
  setViewMode: (viewMode) =>
    set({ viewMode, menu: null, resizeRoomId: null, linkRoomId: null, hoverRoomId: null }),
  openSheet: (sheetPlayerId) => set({ sheetPlayerId }),
  setAoeShape: (aoeShape) =>
    set({ aoeShape, aoeCast: null, tool: 'aoe', menu: null, resizeRoomId: null, linkRoomId: null }),
  castArea: (aoeCast, area) =>
    set({
      aoeCast,
      aoeShape: area.shape,
      aoeFeet: clampAreaFeet(area.feet),
      aoeWidth: clampLineWidth(area.width),
      tool: 'aoe',
      menu: null,
      resizeRoomId: null,
      linkRoomId: null,
    }),
  setAoeFeet: (feet) => set({ aoeFeet: clampAreaFeet(feet) }),
  setAoeWidth: (feet) => set({ aoeWidth: clampLineWidth(feet) }),
  setAoeIncludeSelf: (aoeIncludeSelf) => set({ aoeIncludeSelf }),
  setAoeColor: (color) => set({ aoeColor: color === null ? null : areaColor(color).id }),
  setAoeHidden: (aoeHidden) => set({ aoeHidden }),
}))
