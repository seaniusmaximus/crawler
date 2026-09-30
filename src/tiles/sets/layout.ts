import { cells, type Tileset } from '../tileset.ts'

// Every sheet painted by tools/tilesets (`npm run tiles`) shares one layout,
// written by writeSheet in tools/tilesets/common.mjs; keep the two in step.
// Eight cells per row.
const TOP = 128
const FACE_W = 128
const FACE_H = 72
const FACES_Y = TOP * 4

const wallTops = [...cells(TOP * 2, TOP, TOP, 8), ...cells(TOP * 3, TOP, TOP, 4)]
const [doorLeaf, windowShutters, windowBars] = cells(FACES_Y + FACE_H * 2, FACE_W, FACE_H, 3)

/** A tileset laid out like every generated sheet. */
export function standardTileset(id: string, name: string, sheet: string, shade: Tileset['shade']): Tileset {
  return {
    id,
    name,
    sheet,
    tops: {
      floor: [...cells(0, TOP, TOP, 8), ...cells(TOP, TOP, TOP, 8)],
      wall: wallTops,
      // Doorways and windows are drawn from their faces alone; these slots are never shown.
      'door-h': wallTops,
      'door-v': wallTops,
      'window-h': wallTops,
      'window-v': wallTops,
      stairs: cells(TOP * 3, TOP, TOP, 1, 4),
    },
    faces: {
      wall: [...cells(FACES_Y, FACE_W, FACE_H, 8), ...cells(FACES_Y + FACE_H, FACE_W, FACE_H, 8)],
      door: [doorLeaf!],
      window: [windowShutters!],
      'window-open': [windowBars!],
      foundation: cells(FACES_Y + FACE_H * 2, FACE_W, FACE_H, 4, 3),
    },
    shade,
  }
}
