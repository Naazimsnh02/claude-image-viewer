/** A bottom-up 24 bit BMP of `rgb` (row-major, top row first), as the scripts emit. */
export function bmp(width: number, height: number, rgb: readonly number[]): Uint8Array {
  const stride = ((24 * width + 31) >> 5) << 2
  const bytes = new Uint8Array(54 + stride * height)
  const view = new DataView(bytes.buffer)

  view.setUint16(0, 0x4d42, true)
  view.setUint32(2, bytes.length, true)
  view.setUint32(10, 54, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, width, true)
  view.setInt32(22, height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 24, true)

  for (let y = 0; y < height; y++) {
    const row = 54 + stride * (height - 1 - y)
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 3
      bytes[row + x * 3] = rgb[source + 2] ?? 0
      bytes[row + x * 3 + 1] = rgb[source + 1] ?? 0
      bytes[row + x * 3 + 2] = rgb[source] ?? 0
    }
  }

  return bytes
}
