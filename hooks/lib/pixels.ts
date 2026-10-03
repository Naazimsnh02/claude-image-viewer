/** A decoded picture: `width * height` pixels, 3 bytes each, row-major. */
export type Pixels = {
  width: number
  height: number
  rgb: Uint8Array
}

/** What transparent pixels are laid over; the scripts use the same backdrop. */
const BACKDROP = [30, 30, 30] as const

/**
 * Decodes an uncompressed 24 or 32 bit BMP, the format the thumbnail scripts
 * emit: every platform can write one and it needs no inflate to read.
 */
export function decodeBmp(bytes: Uint8Array): Pixels {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 54 || view.getUint16(0, true) !== 0x4d42) {
    throw new Error('not a BMP')
  }

  const dataOffset = view.getUint32(10, true)
  const width = view.getInt32(18, true)
  const signedHeight = view.getInt32(22, true)
  const height = Math.abs(signedHeight)
  const bitsPerPixel = view.getUint16(28, true)
  const compression = view.getUint32(30, true)

  // 0 is BI_RGB; 3 is BI_BITFIELDS, which writers of 32 bit BMPs use for BGRA.
  if (compression !== 0 && !(compression === 3 && bitsPerPixel === 32)) {
    throw new Error(`unsupported BMP compression ${compression}`)
  }
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) {
    throw new Error(`unsupported BMP depth ${bitsPerPixel}`)
  }
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) {
    throw new Error('unsupported BMP size')
  }

  const bytesPerPixel = bitsPerPixel / 8
  const stride = ((bitsPerPixel * width + 31) >> 5) << 2
  if (dataOffset + stride * height > bytes.length) {
    throw new Error('truncated BMP')
  }

  // Some writers leave the fourth byte zero throughout: that is "no alpha".
  let hasAlpha = false
  if (bytesPerPixel === 4) {
    for (let i = dataOffset + 3; i < dataOffset + stride * height; i += 4) {
      if (bytes[i] !== 0) {
        hasAlpha = true
        break
      }
    }
  }

  const rgb = new Uint8Array(width * height * 3)
  const isBottomUp = signedHeight > 0
  for (let y = 0; y < height; y++) {
    const row = dataOffset + stride * (isBottomUp ? height - 1 - y : y)
    for (let x = 0; x < width; x++) {
      const source = row + x * bytesPerPixel
      const target = (y * width + x) * 3
      const alpha = hasAlpha ? (bytes[source + 3] ?? 255) / 255 : 1
      for (let channel = 0; channel < 3; channel++) {
        // BMP stores blue first.
        const value = bytes[source + 2 - channel] ?? 0
        const backdrop = BACKDROP[channel] ?? 0
        rgb[target + channel] = Math.round(value * alpha + backdrop * (1 - alpha))
      }
    }
  }

  return { width, height, rgb }
}

/** Reads a PNG's pixel size from its IHDR chunk, without decoding it. */
export function pngSize(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 24 || view.getUint32(0) !== 0x89504e47) {
    throw new Error('not a PNG')
  }

  return { width: view.getUint32(16), height: view.getUint32(20) }
}

/** Scales a picture by area averaging, which keeps small thumbnails smooth. */
export function resize(source: Pixels, width: number, height: number): Pixels {
  if (width === source.width && height === source.height) {
    return source
  }

  const rgb = new Uint8Array(width * height * 3)
  const scaleX = source.width / width
  const scaleY = source.height / height

  for (let y = 0; y < height; y++) {
    const top = Math.floor(y * scaleY)
    const bottom = Math.max(top + 1, Math.min(source.height, Math.ceil((y + 1) * scaleY)))
    for (let x = 0; x < width; x++) {
      const left = Math.floor(x * scaleX)
      const right = Math.max(left + 1, Math.min(source.width, Math.ceil((x + 1) * scaleX)))
      let red = 0
      let green = 0
      let blue = 0
      for (let sy = top; sy < bottom; sy++) {
        for (let sx = left; sx < right; sx++) {
          const at = (sy * source.width + sx) * 3
          red += source.rgb[at] ?? 0
          green += source.rgb[at + 1] ?? 0
          blue += source.rgb[at + 2] ?? 0
        }
      }
      const count = (bottom - top) * (right - left)
      const target = (y * width + x) * 3
      rgb[target] = Math.round(red / count)
      rgb[target + 1] = Math.round(green / count)
      rgb[target + 2] = Math.round(blue / count)
    }
  }

  return { width, height, rgb }
}
