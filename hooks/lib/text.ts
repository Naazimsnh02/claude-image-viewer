/** What the thumbnail scripts answer, read off their one line of output. */
export type Thumbnail =
  | { isFound: false; reason: string }
  | {
      isFound: true
      format: 'bmp' | 'png'
      original: { width: number; height: number }
      base64: string
    }

/** The numbers of the `[Image #N]` placeholders in a draft, in order, once each. */
export function idsIn(text: string): number[] {
  const ids: number[] = []
  for (const match of text.matchAll(/\[Image #(\d+)\]/g)) {
    const id = Number(match[1])
    if (!ids.includes(id)) {
      ids.push(id)
    }
  }

  return ids
}

/**
 * The image file a pasted text names, when it is nothing but one path (a file
 * dragged onto the terminal); the clipboard holds no pixels for those.
 */
export function pastedPath(text: string): string | undefined {
  const trimmed = text.trim()
  if (trimmed === '' || /[\r\n]/.test(trimmed)) {
    return undefined
  }

  const unquoted = trimmed.replace(/^(['"])(.*)\1$/, '$2')
  if (!/\.(png|jpe?g|gif|bmp|tiff?|webp)$/i.test(unquoted)) {
    return undefined
  }

  // A POSIX terminal escapes the spaces of a dropped path; Windows quotes it.
  return /^[A-Za-z]:[\\/]/.test(unquoted) ? unquoted : unquoted.replace(/\\(.)/g, '$1')
}

/** Reads `OK <format> <width> <height> <base64>` or `NONE <reason>`. */
export function parseThumbnail(stdout: string): Thumbnail {
  const lines = stdout.split(/\r?\n/).map(line => line.trim())
  const ok = lines.find(line => line.startsWith('OK '))
  if (ok === undefined) {
    const none = lines.find(line => line.startsWith('NONE '))

    return { isFound: false, reason: none?.slice(5) ?? 'the thumbnail script printed nothing' }
  }

  const [, format, width, height, base64] = ok.split(' ')
  if ((format !== 'bmp' && format !== 'png') || base64 === undefined || base64 === '') {
    return { isFound: false, reason: 'the thumbnail script printed an unknown answer' }
  }

  return {
    isFound: true,
    format,
    original: { width: Number(width), height: Number(height) },
    base64,
  }
}
