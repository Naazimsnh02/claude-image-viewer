import { resize } from './pixels'
import type { Pixels } from './pixels'

/** A box of terminal cells. */
export type CellBox = {
  columns: number
  rows: number
}

/** A `Raster`'s props, less its key. */
export type CellGrid = CellBox & {
  cells: string
}

const UPPER_HALF_BLOCK = 0x2580

/**
 * The largest box of cells within `limit` that keeps the picture's shape,
 * never larger than the picture itself.
 *
 * A cell is about twice as tall as it is wide, so a row counts as two pixels:
 * the two halves of a half block, or the same height of a drawn picture.
 */
export function fit(
  size: { width: number; height: number },
  limit: CellBox,
  options: { canGrow?: boolean } = {},
): CellBox {
  const scale = Math.min(
    limit.columns / size.width,
    (limit.rows * 2) / size.height,
    options.canGrow ? Infinity : 1,
  )
  const columns = Math.max(1, Math.min(limit.columns, Math.round(size.width * scale)))
  const halfRows = Math.max(1, Math.round(size.height * scale))

  return { columns, rows: Math.max(1, Math.min(limit.rows, Math.ceil(halfRows / 2))) }
}

/**
 * The block glyph that inks each set of a cell's quarters: bit 0 is the upper
 * left, bit 1 the upper right, bit 2 the lower left, bit 3 the lower right.
 */
const QUADRANTS = [
  0x20, 0x2598, 0x259d, UPPER_HALF_BLOCK, 0x2596, 0x258c, 0x259e, 0x259b, 0x2597, 0x259a, 0x2590, 0x259c,
  0x2584, 0x2599, 0x259f, 0x2588,
] as const

/** Every way to split four quarters in two, the upper left always inked. */
const SPLITS = [15, 1, 3, 5, 7, 9, 11, 13] as const

/**
 * Packs a picture into a `Raster`'s cells, four pixels a cell: a cell holds
 * two colors, so its quarters are split into the two groups that lose least,
 * the glyph inking one group and the background filling the other.
 */
export function quadrants(source: Pixels, box: CellBox): CellGrid {
  const { columns, rows } = box
  const width = columns * 2
  const scaled = resize(source, width, rows * 2)
  const words = new Uint32Array(columns * rows * 3)
  const quarters = new Float64Array(12)
  const ink = new Float64Array(3)
  const paper = new Float64Array(3)

  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      for (let quarter = 0; quarter < 4; quarter++) {
        const at = ((row * 2 + (quarter >> 1)) * width + column * 2 + (quarter & 1)) * 3
        for (let channel = 0; channel < 3; channel++) {
          quarters[quarter * 3 + channel] = scaled.rgb[at + channel] ?? 0
        }
      }

      let best = { loss: Infinity, split: 15, foreground: 0, background: 0 }
      for (const split of SPLITS) {
        ink.fill(0)
        paper.fill(0)
        let inked = 0
        for (let quarter = 0; quarter < 4; quarter++) {
          const isInked = (split >> quarter) & 1
          inked += isInked
          for (let channel = 0; channel < 3; channel++) {
            const value = quarters[quarter * 3 + channel] ?? 0
            if (isInked) {
              ink[channel] = (ink[channel] ?? 0) + value
            } else {
              paper[channel] = (paper[channel] ?? 0) + value
            }
          }
        }
        for (let channel = 0; channel < 3; channel++) {
          ink[channel] = Math.round((ink[channel] ?? 0) / inked)
          paper[channel] = inked === 4 ? (ink[channel] ?? 0) : Math.round((paper[channel] ?? 0) / (4 - inked))
        }

        let loss = 0
        for (let quarter = 0; quarter < 4; quarter++) {
          const mean = (split >> quarter) & 1 ? ink : paper
          for (let channel = 0; channel < 3; channel++) {
            loss += ((quarters[quarter * 3 + channel] ?? 0) - (mean[channel] ?? 0)) ** 2
          }
        }
        if (loss < best.loss) {
          best = {
            loss,
            split,
            foreground: ((ink[0] ?? 0) << 16) | ((ink[1] ?? 0) << 8) | (ink[2] ?? 0),
            background: ((paper[0] ?? 0) << 16) | ((paper[1] ?? 0) << 8) | (paper[2] ?? 0),
          }
        }
      }

      const at = (row * columns + column) * 3
      words[at] = QUADRANTS[best.split] ?? UPPER_HALF_BLOCK
      words[at + 1] = best.foreground
      words[at + 2] = best.background
    }
  }

  return { columns, rows, cells: toBase64(new Uint8Array(words.buffer)) }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard padded base64. */
export function toBase64(bytes: Uint8Array): string {
  let text = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0
    const b = bytes[i + 1] ?? 0
    const c = bytes[i + 2] ?? 0
    text += ALPHABET[a >> 2]
    text += ALPHABET[((a & 3) << 4) | (b >> 4)]
    text += i + 1 < bytes.length ? ALPHABET[((b & 15) << 2) | (c >> 6)] : '='
    text += i + 2 < bytes.length ? ALPHABET[c & 63] : '='
  }

  return text
}

/** Decodes standard base64, padded or not. */
export function fromBase64(text: string): Uint8Array {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }

  return bytes
}
