import { create } from 'zustand'
import { rotateAt } from '../canvas/camera.ts'
import type { DoorStyle, Tool } from '../model/tools.ts'
import type { StairLanding, StairUsePrompt } from '../model/stairs.ts'
import type { ViewMode } from '../model/visibility.ts'
import type { Camera, StairsDir } from '../model/types.ts'

export interface RoomMenu {
  kind: 'room'
  roomId: string
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

export interface PlayerMenu {
  kind: 'player'
  playerId: string
  x: number
  y: number
}

export type Menu = RoomMenu | OpeningMenu | PlayerMenu

/** `leftInset` keeps the room centred in the area the flyout is not covering. */
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
  activeFloorId: string | null
  selectedRoomId: string | null
  hoverRoomId: string | null
  selectedPlayerId: string | null
  hoverPlayerId: string | null
  resizeRoomId: string | null
  /** First room picked with the link tool, waiting for its partner. */
  linkRoomId: string | null
  menu: Menu | null
  focus: FocusRequest | null
  stairsPrompt: StairLanding[] | null
  stairUse: StairUsePrompt | null
  viewMode: ViewMode
  setCamera: (camera: Camera) => void
  setViewport: (width: number, height: number) => void
  rotateView: (steps: number) => void
  setTool: (tool: Tool) => void
  setDoorStyle: (style: DoorStyle) => void
  setStairsDir: (dir: StairsDir) => void
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
  setViewMode: (mode: ViewMode) => void
}

export const useEditorStore = create<EditorState>((set) => ({
  camera: { x: 0, y: 0, zoom: 1.25, yaw: 0 },
  viewport: { width: 1, height: 1 },
  tool: 'select',
  doorStyle: 'door',
  stairsDir: 'both',
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
  viewMode: 'dm',
  setCamera: (camera) => set({ camera }),
  setViewport: (width, height) => set({ viewport: { width, height } }),
  rotateView: (steps) =>
    set((state) => ({
      camera: rotateAt(state.camera, state.viewport.width / 2, state.viewport.height / 2, steps),
    })),
  // Resize handles belong to the rooms tool, so leaving it ends resize mode.
  setTool: (tool) => set({ tool, menu: null, resizeRoomId: null, linkRoomId: null }),
  setDoorStyle: (doorStyle) => set({ doorStyle, tool: 'doors' }),
  setStairsDir: (stairsDir) => set({ stairsDir, tool: 'stairs' }),
  // Selection, hover and resize all point at rooms on the floor being left.
  setActiveFloor: (floorId) =>
    set({
      activeFloorId: floorId,
      selectedRoomId: null,
      hoverRoomId: null,
      hoverPlayerId: null,
      resizeRoomId: null,
      linkRoomId: null,
      menu: null,
    }),
  selectRoom: (roomId) =>
    set((state) => ({
      selectedRoomId: roomId,
      selectedPlayerId: roomId ? null : state.selectedPlayerId,
      menu: null,
      resizeRoomId: state.resizeRoomId === roomId ? state.resizeRoomId : null,
    })),
  setHoverRoom: (roomId) => set({ hoverRoomId: roomId }),
  selectPlayer: (playerId) =>
    set((state) => ({
      selectedPlayerId: playerId,
      selectedRoomId: playerId ? null : state.selectedRoomId,
      resizeRoomId: playerId ? null : state.resizeRoomId,
      menu: playerId ? null : state.menu,
    })),
  setHoverPlayer: (playerId) => set({ hoverPlayerId: playerId }),
  setLinkRoom: (roomId) => set({ linkRoomId: roomId }),
  openMenu: (menu) =>
    set(
      menu.kind === 'player'
        ? { selectedPlayerId: menu.playerId, selectedRoomId: null, resizeRoomId: null, menu }
        : { selectedRoomId: menu.roomId, selectedPlayerId: null, menu },
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
  setViewMode: (viewMode) =>
    set({ viewMode, menu: null, resizeRoomId: null, linkRoomId: null, hoverRoomId: null }),
}))
