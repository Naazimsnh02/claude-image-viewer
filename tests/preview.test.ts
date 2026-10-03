import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { toBase64 } from '../hooks/lib/cells'
import { bmp } from './fixtures'

const PLUGIN = 'image-preview'
const RED_AND_BLUE = toBase64(bmp(2, 2, [255, 0, 0, 255, 0, 0, 0, 0, 255, 0, 0, 255]))
const COMPOSER = { kind: 'composer' } as const
const TYPED = { origin: COMPOSER, presentation: { isFullscreen: false, columns: 100 } } as const

const MESSAGE = {
  plugin: PLUGIN,
  surface: 'terminal',
  component: 'UserMessage',
  props: { text: 'what is this? [Image #1]', origin: COMPOSER, isExpanded: false },
  viewport: { columns: 100, rows: 30 },
} as const

/** Stands for the host: a clipboard holding one image, or none. */
function host(on: On, stdout: string, env: Record<string, string> = {}): { argv: string[][] } {
  const seen = { argv: [] as string[][] }
  mock.env(on, { OS: 'Windows_NT', ...env })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])

    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  return seen
}

test('a pasted image is drawn under the message it was sent with', async ($, on) => {
  const seen = host(on, `OK bmp 1920 1080 ${RED_AND_BLUE}\n`)

  await $.prompt.submit({ text: 'what is this? [Image #1]', origin: COMPOSER, wait: false })
  const ui = await $.ui.mount(MESSAGE)

  const raster = await ui.find({ type: 'Raster', key: 'image-1' })
  expect(raster?.props).toMatchObject({ columns: 2, rows: 1 })
  expect(await ui.find({ type: 'Text', text: 'Image #1 1920×1080' })).toBeDefined()
  expect(seen.argv).toHaveLength(1)
  expect(seen.argv[0]?.[0]).toBe('powershell.exe')
  await ui.unmount()
})

test('an image it has no pixels for says so, and only once asks the host', async ($, on) => {
  const seen = host(on, 'NONE no image found\n')

  await $.prompt.submit({ text: '[Image #1]', origin: COMPOSER, wait: false })
  await $.prompt.submit({ text: '[Image #1] again', origin: COMPOSER, wait: false })
  const ui = await $.ui.mount(MESSAGE)

  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Image #1 (no preview)' })).toBeDefined()
  expect(seen.argv).toHaveLength(1)
  await ui.unmount()
})

test('a message with no image keeps the engine drawing', async ($, on) => {
  host(on, 'NONE no image found\n')

  const ui = await $.ui.mount({ ...MESSAGE, props: { ...MESSAGE.props, text: 'hello' } })

  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Image #/ })).toBeUndefined()
  await ui.unmount()
})

test('the command hides the previews and shows them again', async ($, on) => {
  host(on, `OK bmp 4 4 ${RED_AND_BLUE}\n`)
  await $.prompt.submit({ text: '[Image #1]', origin: COMPOSER, wait: false })

  const hidden = await $.command.run({ command: PLUGIN, args: 'off', ...TYPED })
  expect(hidden.text).toBe('Image previews hidden.')
  const quiet = await $.ui.mount(MESSAGE)
  expect(await quiet.find({ type: 'Raster' })).toBeUndefined()
  await quiet.unmount()

  const shown = await $.command.run({ command: PLUGIN, args: 'on', ...TYPED })
  expect(shown.text).toBe('Image previews shown.')
  const ui = await $.ui.mount(MESSAGE)
  expect(await ui.find({ type: 'Raster' })).toBeDefined()
  await ui.unmount()

  const unknown = await $.command.run({ command: PLUGIN, args: '7', ...TYPED })
  expect(unknown.text).toBe('No preview for that image. Have: #1.')
})

test('images pasted together are each read from the image cache', async ($, on) => {
  const seen = host(on, `OK bmp 4 4 ${RED_AND_BLUE}\n`, { TEMP: 'C:\\Temp' })
  const images = 'C:\\Temp\\claude\\C--work\\sess-1\\images'
  const entry = { size: 0, mtimeMs: 0, isLink: false }
  on('session.id', () => ({ value: 'sess-1' }))
  on('fs.exists', (_$, e) => ({ value: e.path === images }))
  on('fs.list', (_$, e) => ({
    value:
      e.path === images
        ? [
            { name: '1.png', kind: 'file', ...entry },
            { name: '2.png', kind: 'file', ...entry },
          ]
        : [{ name: 'C--work', kind: 'dir', ...entry }],
  }))

  await $.prompt.submit({ text: '[Image #1] [Image #2]', origin: COMPOSER, wait: false })
  const ui = await $.ui.mount({ ...MESSAGE, props: { ...MESSAGE.props, text: '[Image #1] [Image #2]' } })

  expect(await ui.find({ type: 'Raster', key: 'image-1' })).toBeDefined()
  expect(await ui.find({ type: 'Raster', key: 'image-2' })).toBeDefined()
  expect(seen.argv.map(argv => argv.at(-1)).sort()).toEqual([`${images}\\1.png`, `${images}\\2.png`])
  await ui.unmount()
})

test('a terminal with the kitty graphics protocol is handed the picture itself', async ($, on) => {
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAAArCAYAAADIWo5HAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQ='
  const seen = { argv: [] as string[][] }
  mock.env(on, { TERM: 'xterm-kitty' })
  on('process.run', (_$, e) => {
    seen.argv.push([...e.argv])
    const stdout = e.argv[0] === 'id' ? '' : `OK png 1920 1290 ${png}\n`

    return {
      value: { exitCode: 0, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.prompt.submit({ text: 'what is this? [Image #1]', origin: COMPOSER, wait: false })
  const ui = await $.ui.mount(MESSAGE)

  const image = await ui.find({ type: 'Image', key: 'image-1' })
  expect(image?.props).toMatchObject({ source: { png }, alt: 'Image #1 1920×1290' })
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()
  expect(seen.argv.find(argv => argv[0] === 'sh')?.slice(2, 4)).toEqual(['512', 'png'])
  await ui.unmount()
})
