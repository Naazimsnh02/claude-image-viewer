import type { Elements, EngineInterface, Register, RenderElement } from 'claude-code'

import { fit, fromBase64, quadrants } from './lib/cells'
import type { CellBox } from './lib/cells'
import { decodeBmp, pngSize } from './lib/pixels'
import type { Pixels } from './lib/pixels'
import { idsIn, parseThumbnail, pastedPath } from './lib/text'

const PANE = 'image-preview'
const COMMAND = 'image-preview'

/** How often the draft is read, for a paste no `prompt.edit` reported. */
const POLL_MS = 750
/** The longest side, in pixels, of what the scripts hand back. */
const BLOCKS_MAX_PIXELS = 384
const PICTURE_MAX_PIXELS = 512
/** How long a paste is given to reach Claude Code's image cache. */
const CACHE_TRIES = 5
const CACHE_WAIT_MS = 150
/** Previews kept for the transcript and the pane; the oldest go first. */
const KEPT = 40

type Preview = {
  id: number
  /** The pasted image's own size, when the script could read one. */
  original?: { width: number; height: number }
} & (
  | { status: 'loading' }
  | { status: 'missing'; reason: string }
  | { status: 'blocks'; pixels: Pixels }
  | { status: 'picture'; png: string; size: { width: number; height: number } }
)

type Ui = Elements['terminal']

type Settings = {
  thumbnail: CellBox
  showsInTranscript: boolean
  renderer: string
}

type Host = {
  isWindows: boolean
  /** Whether the terminal draws pixels (the kitty graphics protocol). */
  drawsPictures: boolean
}

/** What one load of the module holds; a hot reload starts it over. */
type Session = {
  settings: Settings
  previews: Map<number, Preview>
  /** The image numbers in the draft, in order. */
  draft: readonly number[]
  /** The highest image number seen: numbers only grow, so a higher one is new. */
  highest: number
  isHidden: boolean
  /** The image the pane shows. */
  shown: number | undefined
  host: Promise<Host> | undefined
  /** The folders Claude Code may keep its temporary files in. */
  roots: Promise<string[]> | undefined
  /** The folder holding this session's pasted images, once found. */
  cache: { sessionId: string; directory: string } | undefined
}

function hostOf($: EngineInterface, session: Session): Promise<Host> {
  session.host ??= (async () => {
    const [os, term, program, kitty] = await Promise.all([
      $.env.get('OS'),
      $.env.get('TERM'),
      $.env.get('TERM_PROGRAM'),
      $.env.get('KITTY_WINDOW_ID'),
    ])
    const hasKittyGraphics =
      kitty !== undefined || term === 'xterm-kitty' || term === 'xterm-ghostty' || program === 'ghostty'
    const { renderer } = session.settings

    return {
      isWindows: os === 'Windows_NT',
      drawsPictures: renderer === 'kitty' || (renderer === 'auto' && hasKittyGraphics),
    }
  })()

  return session.host
}

function rootsOf($: EngineInterface, session: Session, isWindows: boolean): Promise<string[]> {
  session.roots ??= (async () => {
    const override = await $.env.get('CLAUDE_CODE_TMPDIR')
    const roots = override === undefined ? [] : [override]

    if (isWindows) {
      const temp = await $.env.get('TEMP')
      for (const base of [override, temp]) {
        if (base !== undefined) roots.push(`${base}\\claude`)
      }
    } else {
      const uid = await $.process.run(['id', '-u']).then(
        result => result.stdout.trim(),
        () => '',
      )
      if (uid !== '') {
        if (override !== undefined) roots.push(`${override}/claude-${uid}`)
        roots.push(`/tmp/claude-${uid}`)
      }
    }

    return roots
  })()

  return session.roots
}

/**
 * The file Claude Code cached a pasted image as:
 * `<tmp>/<project>/<session>/images/<n>.png`. The project folder's name is
 * Claude Code's to choose, so the session's folder is looked for in each.
 */
async function cachedImage(
  $: EngineInterface,
  session: Session,
  id: number,
  isWindows: boolean,
): Promise<string | undefined> {
  const roots = await rootsOf($, session, isWindows)
  if (roots.length === 0) {
    return undefined
  }

  const slash = isWindows ? '\\' : '/'
  const sessionId = await $.session.id()

  for (let attempt = 0; attempt < CACHE_TRIES; attempt++) {
    if (attempt > 0) {
      await $.clock.sleep(CACHE_WAIT_MS)
    }

    if (session.cache?.sessionId !== sessionId) {
      session.cache = undefined
      for (const root of roots) {
        const projects = await $.fs.list(root).catch(() => [])
        for (const project of projects) {
          const directory = [root, project.name, sessionId, 'images'].join(slash)
          if (project.kind === 'dir' && (await $.fs.exists(directory).catch(() => false))) {
            session.cache = { sessionId, directory }
            break
          }
        }
        if (session.cache !== undefined) break
      }
    }
    if (session.cache === undefined) continue

    const { directory } = session.cache
    const files = await $.fs.list(directory).catch(() => [])
    const file = files.find(one => one.kind === 'file' && one.name.replace(/\.[^.]+$/, '') === String(id))
    if (file !== undefined) {
      return `${directory}${slash}${file.name}`
    }
  }

  return undefined
}

function keep(session: Session, preview: Preview): void {
  const { previews } = session
  previews.delete(preview.id)
  previews.set(preview.id, preview)
  for (const id of previews.keys()) {
    if (previews.size <= KEPT) break
    previews.delete(id)
  }
}

/**
 * Asks the host for a thumbnail of image `id`: of the file Claude Code cached
 * it as, else of `fallback.path`, else of the clipboard's image.
 */
async function capture(
  $: EngineInterface,
  session: Session,
  id: number,
  fallback: { path?: string; canUseClipboard: boolean },
): Promise<void> {
  let preview: Preview
  try {
    const { isWindows, drawsPictures } = await hostOf($, session)
    const cached = await cachedImage($, session, id, isWindows).catch(() => undefined)
    const path = cached ?? fallback.path
    if (path === undefined && !fallback.canUseClipboard) {
      throw new Error('pasted with others, and not in the image cache')
    }
    const format = drawsPictures ? 'png' : 'bmp'
    const max = String(drawsPictures ? PICTURE_MAX_PIXELS : BLOCKS_MAX_PIXELS)
    const argv = isWindows
      ? [
          'powershell.exe',
          '-NoProfile',
          '-NonInteractive',
          '-STA',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          `${$.plugin.root}\\scripts\\thumb.ps1`,
          '-Max',
          max,
          '-Format',
          format,
          ...(path === undefined ? [] : ['-Path', path]),
        ]
      : ['sh', `${$.plugin.root}/scripts/thumb.sh`, max, format, ...(path === undefined ? [] : [path])]
    const { stdout } = await $.process.run(argv, { timeoutMs: 15_000 })
    const answer = parseThumbnail(stdout)

    if (!answer.isFound) {
      preview = { id, status: 'missing', reason: answer.reason }
    } else if (answer.format === 'png') {
      const size = pngSize(fromBase64(answer.base64))
      preview = { id, status: 'picture', png: answer.base64, size, original: answer.original }
    } else {
      const pixels = decodeBmp(fromBase64(answer.base64))
      preview = { id, status: 'blocks', pixels, original: answer.original }
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    preview = { id, status: 'missing', reason }
    $.ui.log(`image-preview: no preview for Image #${id}: ${reason}`, { to: 'debug' })
  }

  keep(session, preview)
  $.ui.invalidate('ui.render')
}

/**
 * Takes the draft as it now stands: an `[Image #N]` with a number never seen
 * before is a fresh paste.
 */
function sync($: EngineInterface, session: Session, text: string, path?: string): void {
  const ids = idsIn(text)
  const isChanged = ids.join() !== session.draft.join()
  session.draft = ids

  const fresh = ids.filter(id => id > session.highest)
  const newest = fresh.at(-1)
  if (newest !== undefined) {
    session.highest = newest
    for (const id of fresh) {
      keep(session, { id, status: 'loading' })
      // One clipboard holds one image: of several at once, the last is it.
      void capture($, session, id, id === newest ? { path, canUseClipboard: true } : { canUseClipboard: false })
    }
  }

  if (isChanged) {
    $.ui.invalidate('ui.render')
  }
}

function label(preview: Preview): string {
  return preview.original === undefined
    ? `Image #${preview.id}`
    : `Image #${preview.id} ${preview.original.width}×${preview.original.height}`
}

/** One preview drawn within `limit`, and how many columns it takes. */
function tile(
  ui: Ui,
  preview: Preview,
  limit: CellBox,
  canGrow = false,
): { columns: number; node: RenderElement } {
  const { Box, Image, Raster, Text } = ui
  const caption = label(preview)

  if (preview.status === 'loading') {
    return { columns: caption.length + 2, node: <Text dimColor>{caption} …</Text> }
  }
  if (preview.status === 'missing') {
    return { columns: caption.length + 13, node: <Text dimColor>{caption} (no preview)</Text> }
  }

  const size = preview.status === 'blocks' ? preview.pixels : preview.size
  const box = fit(size, limit, { canGrow })
  const node = (
    <Box flexDirection="column">
      {preview.status === 'blocks' ? (
        <Raster key={`image-${preview.id}`} {...quadrants(preview.pixels, box)} />
      ) : (
        <Image
          key={`image-${preview.id}`}
          source={{ png: preview.png }}
          columns={box.columns}
          rows={box.rows}
          alt={caption}
        />
      )}
      <Text dimColor>{caption}</Text>
    </Box>
  )

  return { columns: Math.max(box.columns, caption.length), node }
}

/** As many previews side by side as `columns` holds, then a count of the rest. */
function strip(
  ui: Ui,
  session: Session,
  ids: readonly number[],
  columns: number,
): RenderElement | undefined {
  const { Box, Text } = ui
  const { thumbnail } = session.settings
  const nodes: RenderElement[] = []
  let used = 0
  let left = 0

  for (const id of ids) {
    const preview = session.previews.get(id)
    if (preview === undefined) continue
    const drawn = tile(ui, preview, { ...thumbnail, columns: Math.min(thumbnail.columns, columns) })
    const needed = drawn.columns + (nodes.length === 0 ? 0 : 2)
    if (nodes.length > 0 && used + needed > columns) {
      left += 1
      continue
    }
    used += needed
    nodes.push(drawn.node)
  }

  if (nodes.length === 0) {
    return undefined
  }

  return (
    <Box flexDirection="row" gap={2} alignItems="flex-end">
      {nodes}
      {left > 0 && <Text dimColor>+{left} more</Text>}
    </Box>
  )
}

function clamp(value: number, low: number, high: number): number {
  return Number.isFinite(value) ? Math.max(low, Math.min(high, Math.round(value))) : low
}

export const register: Register = (on, options) => {
  const session: Session = {
    settings: {
      thumbnail: {
        rows: clamp(Number(options.rows ?? 10), 2, 24),
        columns: clamp(Number(options.maxColumns ?? 48), 8, 160),
      },
      showsInTranscript: options.showInTranscript !== false,
      renderer: String(options.renderer ?? 'auto'),
    },
    previews: new Map(),
    draft: [],
    highest: 0,
    isHidden: false,
    shown: undefined,
    host: undefined,
    roots: undefined,
    cache: undefined,
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: COMMAND,
      description: 'Show or hide pasted-image previews, or open one larger',
      argumentHint: '[on|off|<image number>]',
      immediate: true,
    })
    $.clock.every(POLL_MS, () => {
      void $.prompt.read().then(box => sync($, session, box.text))
    })

    return next(e)
  })

  on('session.end', ($, e, next) => {
    if (e.reason === 'clear') {
      session.previews.clear()
      session.draft = []
      session.highest = 0
    }

    return next(e)
  })

  on('prompt.edit', async ($, e, next) => {
    const box = await next(e)
    sync($, session, box.text, pastedPath(e.inputText))

    return box
  })

  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind !== 'composer') {
      return next(e)
    }

    // A paste sent before the draft was read is still caught here.
    sync($, session, e.text)
    const submitted = await next(e)
    const box = await $.prompt.read()
    sync($, session, box.text)

    return submitted
  })

  on('command.run', { command: COMMAND }, async ($, e) => {
    const argument = e.args.trim().toLowerCase().replace(/^#/, '')

    if (argument === 'on' || argument === 'off' || argument === '') {
      session.isHidden = argument === '' ? !session.isHidden : argument === 'off'
      $.ui.invalidate('ui.render')

      return { text: `Image previews ${session.isHidden ? 'hidden' : 'shown'}.` }
    }

    const id = Number(argument)
    const preview = session.previews.get(id)
    if (!Number.isInteger(id) || preview === undefined) {
      const known = [...session.previews.keys()].map(one => `#${one}`).join(', ')

      return {
        text: known === '' ? 'No pasted images yet.' : `No preview for that image. Have: ${known}.`,
      }
    }

    session.shown = id
    const opened = await $.ui.open({ id: PANE, title: `Image #${id}`, closeOnEscape: true })
    $.ui.invalidate('ui.render')

    return {
      text: opened.isPlaced ? `Image #${id} opened.` : `Image #${id}: widen the terminal to see it.`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const isQuiet = session.isHidden || e.props.hasSurvey || session.draft.length === 0
    if (e.surface !== 'terminal' || isQuiet) {
      return below
    }

    const ui = $.ui.resolve(e)
    const previewed = strip(ui, session, session.draft, e.props.bodyColumns)
    if (previewed === undefined) {
      return below
    }

    return (
      <ui.Box flexDirection="column">
        {below}
        {previewed}
      </ui.Box>
    )
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const below = await next(e)
    const isOurs =
      session.settings.showsInTranscript && !session.isHidden && e.props.origin.kind === 'composer'
    if (e.surface !== 'terminal' || !isOurs) {
      return below
    }

    const ui = $.ui.resolve(e)
    const columns = Math.max(8, (e.viewport?.columns ?? 80) - 4)
    const previewed = strip(ui, session, idsIn(e.props.text), columns)
    if (previewed === undefined) {
      return below
    }

    return (
      <ui.Box flexDirection="column">
        {below}
        <ui.Box marginLeft={2}>{previewed}</ui.Box>
      </ui.Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e, next) => {
    if (e.surface !== 'terminal') {
      return next(e)
    }

    const ui = $.ui.resolve(e)
    const preview = session.shown === undefined ? undefined : session.previews.get(session.shown)
    if (preview === undefined) {
      return <ui.Text dimColor>No image to show. Run /{COMMAND} with an image number.</ui.Text>
    }

    const rows = e.viewport?.rows ?? 30
    const spare = e.props.placement === 'dock' ? rows - 6 : Math.floor(rows / 3)
    const limit = { columns: Math.max(8, e.props.bodyColumns), rows: clamp(spare, 4, 120) }

    return tile(ui, preview, limit, true).node
  })
}
