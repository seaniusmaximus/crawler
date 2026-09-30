// Tiny pixel toolkit for generating tileset art without dependencies:
// an RGBA float image, seeded randomness and noise, and a PNG encoder.

import { deflateSync } from 'node:zlib'

export function createImage(w, h) {
  return { w, h, data: new Float32Array(w * h * 4) }
}

export function clamp(value, lo = 0, hi = 255) {
  return value < lo ? lo : value > hi ? hi : value
}

/** Straight alpha blend of `rgb` over the pixel at x, y. */
export function blend(img, x, y, rgb, alpha = 1) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h || alpha <= 0) return
  const i = (Math.floor(y) * img.w + Math.floor(x)) * 4
  const a = Math.min(1, alpha)
  const d = img.data
  d[i] = d[i] * (1 - a) + rgb[0] * a
  d[i + 1] = d[i + 1] * (1 - a) + rgb[1] * a
  d[i + 2] = d[i + 2] * (1 - a) + rgb[2] * a
  d[i + 3] = Math.max(d[i + 3], a * 255)
}

export function fillRect(img, x, y, w, h, rgb, alpha = 1) {
  for (let py = Math.max(0, Math.floor(y)); py < Math.min(img.h, Math.ceil(y + h)); py++) {
    for (let px = Math.max(0, Math.floor(x)); px < Math.min(img.w, Math.ceil(x + w)); px++) {
      blend(img, px, py, rgb, alpha)
    }
  }
}

/** Multiply a pixel's brightness; >1 lightens, <1 darkens. */
export function shade(img, x, y, factor) {
  if (x < 0 || y < 0 || x >= img.w || y >= img.h) return
  const i = (Math.floor(y) * img.w + Math.floor(x)) * 4
  img.data[i] = clamp(img.data[i] * factor)
  img.data[i + 1] = clamp(img.data[i + 1] * factor)
  img.data[i + 2] = clamp(img.data[i + 2] * factor)
}

export function blit(target, source, ox, oy) {
  for (let y = 0; y < source.h; y++) {
    for (let x = 0; x < source.w; x++) {
      const s = (y * source.w + x) * 4
      const t = ((oy + y) * target.w + (ox + x)) * 4
      for (let c = 0; c < 4; c++) target.data[t + c] = source.data[s + c]
    }
  }
}

/** mulberry32: small, fast, and repeatable for a given seed. */
export function rng(seed) {
  let a = seed >>> 0
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  next.range = (lo, hi) => lo + next() * (hi - lo)
  next.int = (lo, hi) => Math.floor(next.range(lo, hi + 1))
  next.pick = (items) => items[Math.floor(next() * items.length)]
  return next
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

/** Smooth value noise in 0..1 with features about `scale` pixels wide. */
export function valueNoise(x, y, scale, seed) {
  const gx = x / scale
  const gy = y / scale
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const fx = gx - x0
  const fy = gy - y0
  const sx = fx * fx * (3 - 2 * fx)
  const sy = fy * fy * (3 - 2 * fy)
  const a = hash2(x0, y0, seed)
  const b = hash2(x0 + 1, y0, seed)
  const c = hash2(x0, y0 + 1, seed)
  const d = hash2(x0 + 1, y0 + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** A few octaves of value noise, 0..1. */
export function fbm(x, y, scale, seed, octaves = 3) {
  let total = 0
  let weight = 0
  let amp = 1
  for (let o = 0; o < octaves; o++) {
    total += valueNoise(x, y, scale / 2 ** o, seed + o * 101) * amp
    weight += amp
    amp *= 0.5
  }
  return total / weight
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let c = 0xffffffff
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, body) {
  const out = Buffer.alloc(12 + body.length)
  out.writeUInt32BE(body.length, 0)
  out.write(type, 4, 'ascii')
  body.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length)
  return out
}

/** Encode an image as an 8-bit RGBA PNG. */
export function encodePng(img) {
  const raw = Buffer.alloc(img.h * (img.w * 4 + 1))
  for (let y = 0; y < img.h; y++) {
    raw[y * (img.w * 4 + 1)] = 0
    for (let x = 0; x < img.w * 4; x++) {
      raw[y * (img.w * 4 + 1) + 1 + x] = Math.round(clamp(img.data[y * img.w * 4 + x]))
    }
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(img.w, 0)
  header.writeUInt32BE(img.h, 4)
  header[8] = 8
  header[9] = 6
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  return Buffer.concat([
    signature,
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
