import { box, cone, flat, lit, round, type ObjectDef, type ObjectPart } from '../parts.ts'
import { BRASS, CANDLE, EMBER, FLAME, IRON, IRON_TOP, OAK_DARK, ROCK, ROCK_TOP, STONE, STONE_TOP } from './palette.ts'

/** A candle standing on `z` with its flame. */
function candle(x: number, y: number, z: number, h: number, r = 0.025, glow = false): ObjectPart[] {
  const flame = cone(x, y, r * 0.8, z + h, 3, FLAME, '#fff3c4')
  return [round(x, y, r, z, h, CANDLE, FLAME), glow ? lit(flame) : flame]
}

/** Fire, torches and candles. Wall-mounted ones hang off their back edge (y = 0). */
export const LIGHTS: ObjectDef[] = [
  {
    id: 'torch-stand',
    name: 'Standing torch',
    w: 1,
    d: 1,
    parts: [
      round(0.5, 0.5, 0.14, 0, 2, IRON, IRON_TOP),
      round(0.5, 0.5, 0.03, 2, 26, IRON),
      round(0.5, 0.5, 0.05, 28, 3, IRON, '#2a1a12', 0.08),
      lit(cone(0.5, 0.5, 0.07, 31, 9, EMBER, FLAME)),
    ],
  },
  {
    id: 'wall-torch',
    name: 'Wall torch',
    w: 1,
    d: 1,
    parts: [
      box(0.44, 0, 0.12, 0.04, 14, 10, IRON, IRON_TOP),
      box(0.47, 0.04, 0.06, 0.14, 17, 2, IRON, IRON_TOP),
      round(0.5, 0.2, 0.03, 14, 12, OAK_DARK),
      lit(cone(0.5, 0.2, 0.06, 26, 8, EMBER, FLAME)),
    ],
  },
  {
    id: 'sconce',
    name: 'Candle sconce',
    w: 1,
    d: 1,
    parts: [
      box(0.42, 0, 0.16, 0.03, 13, 12, BRASS, '#d1ae5c'),
      box(0.47, 0.03, 0.06, 0.13, 16, 2, BRASS, '#d1ae5c'),
      round(0.5, 0.18, 0.06, 17, 1.5, BRASS, '#d1ae5c'),
      ...candle(0.5, 0.18, 18.5, 5, 0.025, true),
    ],
  },
  {
    id: 'candles',
    name: 'Candles',
    w: 1,
    d: 1,
    parts: [
      flat(0.3, 0.38, 0.4, 0.3, '#e9e1c8'),
      ...candle(0.4, 0.48, 0, 7, 0.035),
      ...candle(0.55, 0.42, 0, 10, 0.035, true),
      ...candle(0.6, 0.58, 0, 4, 0.04),
      ...candle(0.36, 0.62, 0, 3, 0.03),
    ],
  },
  {
    id: 'lantern',
    name: 'Lantern',
    w: 1,
    d: 1,
    parts: [
      box(0.4, 0.4, 0.2, 0.2, 0, 1.5, IRON, IRON_TOP),
      lit(box(0.42, 0.42, 0.16, 0.16, 1.5, 7, '#ffc85a', '#ffe7a8')),
      box(0.4, 0.4, 0.03, 0.03, 1.5, 7, IRON),
      box(0.57, 0.4, 0.03, 0.03, 1.5, 7, IRON),
      box(0.4, 0.57, 0.03, 0.03, 1.5, 7, IRON),
      box(0.57, 0.57, 0.03, 0.03, 1.5, 7, IRON),
      cone(0.5, 0.5, 0.14, 8.5, 4, IRON, IRON_TOP),
      round(0.5, 0.5, 0.02, 12.5, 2, IRON),
    ],
  },
  {
    id: 'hanging-lantern',
    name: 'Hanging lantern',
    w: 1,
    d: 1,
    parts: [
      box(0.42, 0.42, 0.16, 0.16, 30, 1.5, IRON, IRON_TOP),
      lit(box(0.435, 0.435, 0.13, 0.13, 31.5, 7, '#ffc85a', '#ffe7a8')),
      cone(0.5, 0.5, 0.12, 38.5, 4, IRON, IRON_TOP),
      round(0.5, 0.5, 0.012, 42.5, 14, IRON),
    ],
  },
  {
    id: 'chandelier',
    name: 'Chandelier',
    w: 1,
    d: 1,
    parts: [
      round(0.5, 0.5, 0.012, 44, 12, BRASS),
      round(0.5, 0.5, 0.05, 38, 6, BRASS, '#d1ae5c', 0.02),
      round(0.5, 0.5, 0.34, 36, 2, BRASS, '#d1ae5c', 0.3),
      ...[0, 1, 2, 3, 4, 5].flatMap((i) => {
        const angle = (i / 6) * Math.PI * 2
        return candle(0.5 + Math.cos(angle) * 0.26, 0.5 + Math.sin(angle) * 0.26, 38, 4, 0.025, i % 2 === 0)
      }),
    ],
  },
  {
    id: 'tall-brazier',
    name: 'Tall brazier',
    w: 1,
    d: 1,
    parts: [
      box(0.34, 0.36, 0.05, 0.05, 0, 22, IRON),
      box(0.61, 0.36, 0.05, 0.05, 0, 22, IRON),
      box(0.475, 0.62, 0.05, 0.05, 0, 22, IRON),
      round(0.5, 0.5, 0.16, 20, 6, IRON, '#2a1a12', 0.3),
      round(0.5, 0.5, 0.26, 26, 1, EMBER, '#ff6a1a'),
      lit(cone(0.5, 0.5, 0.2, 27, 14, EMBER, FLAME)),
    ],
  },
  {
    id: 'fire-pit',
    name: 'Fire pit',
    w: 1,
    d: 1,
    parts: [
      flat(0.16, 0.16, 0.68, 0.68, '#231c18', '#3a302a'),
      ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => {
        const angle = (i / 10) * Math.PI * 2
        return round(0.5 + Math.cos(angle) * 0.36, 0.5 + Math.sin(angle) * 0.36, 0.08, 0, 4, i % 2 ? ROCK : STONE, i % 2 ? ROCK_TOP : STONE_TOP, 0.06)
      }),
      box(0.3, 0.46, 0.4, 0.08, 0, 3, OAK_DARK),
      box(0.46, 0.3, 0.08, 0.4, 3, 3, OAK_DARK),
      lit(cone(0.5, 0.5, 0.17, 5, 13, EMBER, FLAME)),
    ],
  },
]
