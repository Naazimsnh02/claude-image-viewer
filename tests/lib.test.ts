import { describe, expect, test } from 'claude-code/testing'

import { fit, fromBase64, quadrants, toBase64 } from '../hooks/lib/cells'
import { decodeBmp, pngSize, resize } from '../hooks/lib/pixels'
import { idsIn, parseThumbnail, pastedPath } from '../hooks/lib/text'
import { bmp } from './fixtures'

describe('text', () => {
  test('finds each image number once, in order', () => {
    expect(idsIn('see [Image #2] and [Image #10], again [Image #2]')).toEqual([2, 10])
    expect(idsIn('no images, [Image] or [Image #x]')).toEqual([])
  })

  test('takes a lone image path as a dropped file', () => {
    expect(pastedPath('"C:\\Users\\me\\My Shots\\a.PNG"')).toBe('C:\\Users\\me\\My Shots\\a.PNG')
    expect(pastedPath('/Users/me/My\\ Shots/a.jpeg ')).toBe('/Users/me/My Shots/a.jpeg')
    expect(pastedPath('look at a.png please')).toBeUndefined()
    expect(pastedPath('notes.txt')).toBeUndefined()
    expect(pastedPath('a.png\nb.png')).toBeUndefined()
  })

  test('reads the scripts answer', () => {
    expect(parseThumbnail('')).toEqual({
      isFound: false,
      reason: 'the thumbnail script printed nothing',
    })
    expect(parseThumbnail('\uFEFFOK bmp 1920 1080 QUJD\r\n')).toEqual({
      isFound: true,
      format: 'bmp',
      original: { width: 1920, height: 1080 },
      base64: 'QUJD',
    })
    expect(parseThumbnail('NONE no image found\n')).toEqual({ isFound: false, reason: 'no image found' })
    expect(parseThumbnail('OK tiff 1 1 QUJD')).toMatchObject({ isFound: false })
  })
})

describe('pixels', () => {
  test('decodes a bottom-up 24 bit BMP', () => {
    const pixels = decodeBmp(bmp(2, 2, [255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))

    expect(pixels.width).toBe(2)
    expect(pixels.height).toBe(2)
    expect([...pixels.rgb]).toEqual([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255])
  })

  test('refuses what is not a BMP', () => {
    expect(() => decodeBmp(new Uint8Array(64))).toThrow('not a BMP')
  })

  test('reads a PNG size from its header', () => {
    const png = fromBase64(
      'iVBORw0KGgoAAAANSUhEUgAAAEAAAAArCAYAAADIWo5HAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQ=',
    )

    expect(pngSize(png)).toEqual({ width: 64, height: 43 })
  })

  test('averages when it shrinks', () => {
    const source = { width: 2, height: 2, rgb: Uint8Array.from([0, 0, 0, 100, 100, 100, 100, 100, 100, 200, 200, 200]) }

    expect([...resize(source, 1, 1).rgb]).toEqual([100, 100, 100])
  })
})

describe('cells', () => {
  test('keeps the shape within the limit and does not grow', () => {
    expect(fit({ width: 192, height: 108 }, { columns: 32, rows: 6 })).toEqual({ columns: 21, rows: 6 })
    expect(fit({ width: 192, height: 20 }, { columns: 32, rows: 6 })).toEqual({ columns: 32, rows: 2 })
    expect(fit({ width: 8, height: 8 }, { columns: 32, rows: 6 })).toEqual({ columns: 8, rows: 4 })
    expect(fit({ width: 8, height: 8 }, { columns: 32, rows: 6 }, { canGrow: true })).toEqual({
      columns: 12,
      rows: 6,
    })
  })

  test('packs four pixels a cell as quadrant blocks', () => {
    const source = { width: 1, height: 2, rgb: Uint8Array.from([255, 136, 0, 0, 0, 255]) }
    const grid = quadrants(source, { columns: 1, rows: 1 })
    const words = new Uint32Array(fromBase64(grid.cells).buffer)

    expect([...words]).toEqual([0x2580, 0xff8800, 0x0000ff])
  })

  test('round-trips base64', () => {
    for (const length of [0, 1, 2, 3, 4, 5]) {
      const bytes = Uint8Array.from({ length }, (_, i) => i * 50)

      expect([...fromBase64(toBase64(bytes))]).toEqual([...bytes])
    }
  })
})
