import { ball, box, cone, flat, lit, round, type ObjectDef, type ObjectPart } from '../parts.ts'
import {
  ARCANE,
  ARCANE_GLOW,
  BLOOD,
  DARK,
  EMBER,
  FLAME,
  IRON,
  IRON_TOP,
  OAK,
  OAK_DARK,
  OAK_TOP,
  PIT,
  ROPE,
  STEEL,
  STONE,
  STONE_TOP,
} from './palette.ts'

/** A grid of `n` by `n` spikes across the middle of a cell. */
function spikeGrid(n: number, from: number, to: number, h: number, color: string, tip?: string): ObjectPart[] {
  const parts: ObjectPart[] = []
  const gap = (to - from) / n
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) parts.push(cone(from + gap * (i + 0.5), from + gap * (j + 0.5), gap * 0.32, 0, h, color, tip))
  }
  return parts
}

/** Pits, spikes, triggers and the machinery that works them. */
export const TRAPS: ObjectDef[] = [
  {
    id: 'spikes',
    name: 'Floor spikes',
    w: 1,
    d: 1,
    parts: [box(0.1, 0.1, 0.8, 0.8, 0, 1, IRON, IRON_TOP), ...spikeGrid(4, 0.12, 0.88, 9, STEEL)],
  },
  {
    id: 'spike-pit',
    name: 'Spike pit',
    w: 1,
    d: 1,
    parts: [flat(0.04, 0.04, 0.92, 0.92, PIT, '#3a3530'), ...spikeGrid(3, 0.16, 0.84, 10, '#6e7078'), flat(0.42, 0.44, 0.14, 0.12, BLOOD)],
  },
  {
    id: 'pit',
    name: 'Open pit',
    w: 1,
    d: 1,
    parts: [flat(0.04, 0.04, 0.92, 0.92, '#1a1714', '#3a3530'), flat(0.2, 0.2, 0.6, 0.6, PIT)],
  },
  {
    id: 'trap-door',
    name: 'Trap door',
    w: 1,
    d: 1,
    parts: [
      flat(0.12, 0.12, 0.76, 0.76, '#5a3a20', '#2e1d10'),
      flat(0.37, 0.19, 0.02, 0.62, '#3e2814'),
      flat(0.61, 0.19, 0.02, 0.62, '#3e2814'),
      flat(0.2, 0.3, 0.6, 0.05, IRON),
      flat(0.2, 0.66, 0.6, 0.05, IRON),
      round(0.5, 0.5, 0.06, 0, 0.8, IRON, '#1c1c22', 0.06),
    ],
  },
  {
    id: 'pressure-plate',
    name: 'Pressure plate',
    w: 1,
    d: 1,
    parts: [flat(0.22, 0.22, 0.56, 0.56, '#2a2a30'), box(0.25, 0.25, 0.5, 0.5, 0, 1, '#77777d', '#8d8d93')],
  },
  {
    id: 'arrow-trap',
    name: 'Arrow trap',
    w: 1,
    d: 1,
    parts: [
      box(0.12, 0, 0.76, 0.12, 0, 20, STONE, STONE_TOP),
      box(0.22, 0.12, 0.08, 0.01, 11, 3, DARK),
      box(0.46, 0.12, 0.08, 0.01, 11, 3, DARK),
      box(0.7, 0.12, 0.08, 0.01, 11, 3, DARK),
      box(0.49, 0.3, 0.02, 0.36, 12, 1, '#6a4a2a'),
      cone(0.5, 0.68, 0.025, 11.5, 2, STEEL),
      box(0.47, 0.28, 0.06, 0.06, 12, 1, '#d9d2bd'),
      flat(0.66, 0.7, 0.03, 0.18, '#6a4a2a'),
    ],
  },
  {
    id: 'fire-trap',
    name: 'Fire vent',
    w: 1,
    d: 1,
    parts: [
      flat(0.14, 0.14, 0.72, 0.72, '#191513', '#2e2420'),
      flat(0.22, 0.3, 0.56, 0.04, IRON),
      flat(0.22, 0.48, 0.56, 0.04, IRON),
      flat(0.22, 0.66, 0.56, 0.04, IRON),
      cone(0.36, 0.42, 0.1, 0, 22, EMBER, FLAME),
      cone(0.6, 0.38, 0.09, 0, 18, EMBER, FLAME),
      lit(cone(0.5, 0.62, 0.12, 0, 26, EMBER, FLAME)),
    ],
  },
  {
    id: 'bear-trap',
    name: 'Bear trap',
    w: 1,
    d: 1,
    parts: [
      round(0.5, 0.5, 0.24, 0, 1, IRON, '#25262b'),
      round(0.5, 0.5, 0.06, 1, 1, IRON, IRON_TOP),
      ...Array.from({ length: 12 }, (_, i) => {
        const angle = (i / 12) * Math.PI * 2
        return cone(0.5 + Math.cos(angle) * 0.2, 0.5 + Math.sin(angle) * 0.2, 0.03, 1, 3, STEEL)
      }),
      box(0.72, 0.49, 0.18, 0.02, 0, 0.8, IRON),
    ],
  },
  {
    id: 'pendulum-blade',
    name: 'Pendulum blade',
    w: 1,
    d: 1,
    parts: [
      box(0.06, 0.44, 0.08, 0.12, 0, 42, OAK_DARK),
      box(0.86, 0.44, 0.08, 0.12, 0, 42, OAK_DARK),
      box(0.06, 0.44, 0.88, 0.12, 42, 4, OAK_DARK, OAK),
      box(0.485, 0.485, 0.03, 0.03, 18, 24, IRON),
      box(0.2, 0.485, 0.6, 0.03, 10, 8, STEEL, '#e2e5ea'),
      box(0.25, 0.48, 0.5, 0.04, 16, 2, IRON),
      flat(0.1, 0.46, 0.8, 0.08, '#2a2522'),
    ],
  },
  {
    id: 'rune-circle',
    name: 'Rune circle',
    w: 1,
    d: 1,
    parts: [
      lit(round(0.5, 0.5, 0.42, 0, 0.4, ARCANE, ARCANE_GLOW)),
      round(0.5, 0.5, 0.36, 0, 0.6, '#1b1626', '#241c33'),
      round(0.5, 0.5, 0.2, 0, 0.8, ARCANE, ARCANE_GLOW),
      round(0.5, 0.5, 0.15, 0, 1, '#1b1626', '#241c33'),
      ...Array.from({ length: 6 }, (_, i) => {
        const angle = (i / 6) * Math.PI * 2
        return box(0.5 + Math.cos(angle) * 0.28 - 0.025, 0.5 + Math.sin(angle) * 0.28 - 0.025, 0.05, 0.05, 0, 0.9, ARCANE_GLOW)
      }),
    ],
  },
  {
    id: 'lever',
    name: 'Floor lever',
    w: 1,
    d: 1,
    parts: [
      box(0.36, 0.36, 0.28, 0.28, 0, 4, STONE, STONE_TOP),
      box(0.47, 0.4, 0.06, 0.2, 4, 0.3, DARK),
      box(0.48, 0.44, 0.04, 0.04, 4, 14, IRON, IRON_TOP),
      ...ball(0.5, 0.46, 0.05, 17, '#8a2a2a', '#b04040'),
    ],
  },
  {
    id: 'wall-lever',
    name: 'Wall lever',
    w: 1,
    d: 1,
    parts: [
      box(0.38, 0, 0.24, 0.04, 8, 14, IRON, IRON_TOP),
      box(0.47, 0.04, 0.06, 0.04, 14, 2, IRON),
      box(0.48, 0.08, 0.04, 0.04, 14, 10, IRON, IRON_TOP),
      ...ball(0.5, 0.1, 0.04, 23, '#8a2a2a', '#b04040'),
    ],
  },
  {
    id: 'pulley',
    name: 'Pulley & bucket',
    w: 1,
    d: 1,
    parts: [
      box(0.12, 0.44, 0.08, 0.12, 0, 32, OAK_DARK, OAK),
      box(0.8, 0.44, 0.08, 0.12, 0, 32, OAK_DARK, OAK),
      box(0.12, 0.44, 0.76, 0.12, 32, 4, OAK, OAK_TOP),
      box(0.44, 0.47, 0.12, 0.06, 25, 7, IRON, IRON_TOP),
      box(0.49, 0.49, 0.02, 0.02, 7, 18, ROPE),
      box(0.58, 0.49, 0.02, 0.02, 14, 11, ROPE),
      round(0.5, 0.5, 0.115, 3, 1, IRON),
      round(0.5, 0.5, 0.09, 0, 7, OAK, '#2a2a30', 0.11),
      box(0.42, 0.49, 0.16, 0.02, 7, 3, IRON),
    ],
  },
  {
    id: 'winch',
    name: 'Winch',
    w: 1,
    d: 1,
    parts: [
      box(0.18, 0.38, 0.1, 0.24, 0, 16, OAK_DARK, OAK),
      box(0.72, 0.38, 0.1, 0.24, 0, 16, OAK_DARK, OAK),
      box(0.28, 0.42, 0.44, 0.16, 8, 7, OAK, OAK_TOP),
      box(0.34, 0.415, 0.04, 0.17, 7.5, 8, ROPE),
      box(0.46, 0.415, 0.04, 0.17, 7.5, 8, ROPE),
      box(0.58, 0.415, 0.04, 0.17, 7.5, 8, ROPE),
      box(0.82, 0.48, 0.1, 0.04, 11, 2, IRON),
      box(0.88, 0.48, 0.04, 0.04, 6, 7, IRON),
      box(0.49, 0.58, 0.02, 0.4, 8, 1, ROPE),
    ],
  },
  {
    id: 'tripwire',
    name: 'Tripwire',
    w: 1,
    d: 1,
    parts: [
      box(0.08, 0.47, 0.06, 0.06, 0, 5, OAK_DARK),
      box(0.86, 0.47, 0.06, 0.06, 0, 5, OAK_DARK),
      box(0.14, 0.495, 0.72, 0.01, 3, 0.5, '#c8c2b0'),
      box(0.9, 0.42, 0.06, 0.04, 4, 2, '#b8a24a'),
    ],
  },
  {
    id: 'acid-pool',
    name: 'Acid pool',
    w: 1,
    d: 1,
    parts: [
      flat(0.1, 0.16, 0.78, 0.66, '#3a6a1a', '#26401a'),
      lit(flat(0.24, 0.3, 0.44, 0.34, '#6fb52a')),
      ...ball(0.4, 0.42, 0.04, 0, '#8fd84a', '#c4f27a'),
      ...ball(0.6, 0.56, 0.03, 0, '#8fd84a', '#c4f27a'),
      ...ball(0.5, 0.36, 0.025, 0, '#8fd84a', '#c4f27a'),
    ],
  },
]
