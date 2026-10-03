# image-preview

A [Claude Code mod](https://code.claude.com/docs/en/plugins/mods/overview) that shows a thumbnail of every image you paste, instead of only `[Image #1]`.

```text
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀▀▀
▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀▀   ▀▀▀▀▀▀▀▀▀▀▀▀
Image #1 1920×1080      Image #2 800×800
╭──────────────────────────────────────────╮
│ > what changed between [Image #1] and    │
│   [Image #2]?                            │
╰──────────────────────────────────────────╯
```

(The blocks above are colored in a real terminal: each cell is four pixels of the image.)

## What it does

- **Above the prompt**: as soon as you paste an image, its thumbnail appears above the prompt box, labeled with its number and original size. Delete the `[Image #N]` placeholder and the thumbnail goes with it.
- **In the transcript**: once you send the message, the thumbnail stays under it.
- **Larger view**: `/image-preview 2` opens Image #2 in a pane, as large as the pane allows.
- **Works in every terminal**: thumbnails are drawn with colored quadrant-block characters, four pixels a cell, so they need no graphics protocol. In kitty and Ghostty the mod draws real pixels instead.

## Requirements

- Claude Code v2.1.287 or later (`claude --version`).
- A terminal with 24-bit color.
- One of:

| Platform | Needs | Status |
| :-- | :-- | :-- |
| Windows | Windows PowerShell 5.1 (ships with Windows) | Tested |
| macOS | `sips` (ships with macOS) | Implemented, not yet tested |
| Linux | ImageMagick | Implemented, not yet tested |

## Install

Add this repository as a marketplace, then install the plugin from it:

```text
/plugin marketplace add naazimsnh02/claude-image-viewer
/plugin install image-preview@claude-image-viewer
```

Or try it for one session from a clone, without installing:

```bash
git clone https://github.com/Naazimsnh02/claude-image-viewer
claude --plugin-dir ./claude-image-viewer
```

Run `/plugin` to confirm it loaded: the line under the tabs names `image-preview` among the active mods.

## Use

Paste an image as you always do (`Ctrl+V`, or `Alt+V` on Windows). The thumbnail appears above the prompt within about a second.

| Command | What it does |
| :-- | :-- |
| `/image-preview` | Hides the previews, or shows them again |
| `/image-preview on` / `off` | Shows or hides them |
| `/image-preview 2` | Opens Image #2 larger, in a pane (`Esc` closes it) |

## Options

Set these from `/plugin` → **Installed** → `image-preview`, or under `pluginConfigs` in `settings.json`.

| Option | Default | Meaning |
| :-- | :-- | :-- |
| `rows` | `10` | Terminal rows a thumbnail may take (2 to 24) |
| `maxColumns` | `48` | Terminal columns a thumbnail may take (8 to 160) |
| `showInTranscript` | `true` | Keep the thumbnail under the message once it is sent |
| `renderer` | `auto` | `blocks` (quadrant blocks, any terminal), `kitty` (real pixels in kitty and Ghostty), or `auto` |

## How it works

Claude Code hands a mod the text of the prompt, where a pasted image is only the placeholder `[Image #N]`; the image's bytes are not part of that. So the mod reads them from where Claude Code put them:

1. A `prompt.edit` hook (and a slow poll of the draft, as a safety net) notices a new `[Image #N]`.
2. Claude Code caches each pasted image for the session as `<tmp>/<project>/<session>/images/<N>.png`. A small script in [`scripts/`](scripts) reads that file, shrinks it to at most 384 pixels a side, and prints it as base64 on standard output. Nothing is written to disk on Windows; macOS and Linux use a temporary directory that is removed at once.
3. The mod decodes the thumbnail and packs it into a `Raster` of quadrant-block cells (`▚`, `▌`, `▀` and the rest), four pixels a cell in the two colors that fit them best, drawn by `ui.render` hooks above the prompt and under the sent message.

If the cached file cannot be found, the mod falls back to the file you dragged onto the terminal, or to the image still on the clipboard (which on Linux needs `wl-clipboard` or `xclip`).

## Limitations

- **A preview is taken at paste time.** Images in a resumed session, or pasted before the mod loaded, have no preview.
- **The terminal and nowhere else.** The Desktop app's Code tab, the VS Code panel and Remote Control draw nothing; the mod stays out of their way.
- **Blocks are coarse**: a cell holds four pixels in two colors, so a 10-row thumbnail is about 96×20 pixels and small text in a screenshot is not readable. Raise `rows` and `maxColumns`, or open the image in the pane. Real pixels need the kitty graphics protocol, which Windows Terminal does not have.
- WebP files dragged onto a Windows terminal are not previewed (GDI+ does not read them).

## What it can reach

A mod runs with your permissions. This one asks Claude Code for the following, which you can check yourself with `claude plugin validate .` before installing:

```text
hooks: session.start, session.end, prompt.edit, prompt.submit, command.run{command=image-preview},
       ui.render{component=AbovePrompt}, ui.render{component=UserMessage}, ui.render{component=Pane}
calls: $.clock.every, $.clock.sleep, $.command.register, $.env.get, $.fs.exists, $.fs.list,
       $.process.run, $.prompt.read, $.session.id, $.ui.invalidate, $.ui.log, $.ui.open, $.ui.resolve
env reads: CLAUDE_CODE_TMPDIR, KITTY_WINDOW_ID, OS, TEMP, TERM, TERM_PROGRAM
```

`$.process.run` starts only the two scripts in `scripts/`, and `id -u` once on macOS and Linux to find Claude Code's temporary folder. `$.fs` only lists that folder to find the session's image cache. The mod reads your draft to find `[Image #N]`; it never changes a prompt, makes no network request and stores nothing.

## Develop

```bash
claude --plugin-dir .        # load from disk; saving a file reloads the mod
claude plugin validate .     # what the engine would refuse, and what the mod hooks and calls
claude plugin test .         # the tests in tests/
```

Once Claude Code has loaded the folder it lays its type declarations in `.claude-plugin/types/` (git-ignored), and `npx tsc -p .` type-checks the mod against them.

```text
.claude-plugin/   plugin.json (the manifest and options), marketplace.json
hooks/            register.tsx (the hooks), lib/ (BMP decoding, scaling, cell packing)
scripts/          thumb.ps1 (Windows), thumb.sh (macOS, Linux)
tests/            unit tests for lib/, and the hooks run against the engine
```

Reports from macOS, Linux, kitty and Ghostty are especially welcome, since those paths have not been run yet.

## License

[MIT](LICENSE)
