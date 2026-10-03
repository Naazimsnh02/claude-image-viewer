#!/bin/sh
# Prints a small thumbnail of the clipboard's image (or of a file) on one line:
#   OK <format> <original width> <original height> <base64>
#   NONE <reason>
# Usage: thumb.sh <max pixels> <bmp|png> [path]
# macOS: osascript + sips. Linux: wl-paste or xclip, and ImageMagick.

max="${1:-384}"
format="${2:-bmp}"
path="${3:-}"

work="$(mktemp -d 2>/dev/null || mktemp -d -t image-preview)" || {
  echo "NONE cannot create a temporary directory"
  exit 0
}
trap 'rm -rf "$work"' EXIT

source="$work/source.png"
thumb="$work/thumb.$format"

has() { command -v "$1" >/dev/null 2>&1; }

one_line_base64() { base64 < "$1" | tr -d '\n'; }

if [ -n "$path" ]; then
  [ -f "$path" ] || { echo "NONE no such file"; exit 0; }
  source="$path"
fi

case "$(uname -s)" in
  Darwin)
    if [ -z "$path" ]; then
      osascript >/dev/null 2>&1 <<EOF
set target to POSIX file "$source"
set handle to open for access target with write permission
try
  write (the clipboard as «class PNGf») to handle
  close access handle
on error
  close access handle
  error "no image"
end try
EOF
      [ -s "$source" ] || { echo "NONE no image found"; exit 0; }
    fi
    width="$(sips -g pixelWidth "$source" 2>/dev/null | awk '/pixelWidth/ { print $2 }')"
    height="$(sips -g pixelHeight "$source" 2>/dev/null | awk '/pixelHeight/ { print $2 }')"
    [ -n "$width" ] && [ -n "$height" ] || { echo "NONE not an image"; exit 0; }
    longest="$width"
    [ "$height" -gt "$longest" ] && longest="$height"
    if [ "$longest" -gt "$max" ]; then
      sips -s format "$format" -Z "$max" "$source" --out "$thumb" >/dev/null 2>&1
    else
      sips -s format "$format" "$source" --out "$thumb" >/dev/null 2>&1
    fi
    ;;
  *)
    if [ -z "$path" ]; then
      if [ -n "$WAYLAND_DISPLAY" ] && has wl-paste; then
        wl-paste --type image/png > "$source" 2>/dev/null
      elif has xclip; then
        xclip -selection clipboard -t image/png -o > "$source" 2>/dev/null
      else
        echo "NONE install wl-clipboard or xclip to read the clipboard"
        exit 0
      fi
      [ -s "$source" ] || { echo "NONE no image found"; exit 0; }
    fi
    if has magick; then
      convert="magick"
      identify="magick identify"
    elif has convert && has identify; then
      convert="convert"
      identify="identify"
    else
      echo "NONE install ImageMagick to draw previews"
      exit 0
    fi
    size="$($identify -format '%w %h' "${source}[0]" 2>/dev/null)"
    width="${size% *}"
    height="${size#* }"
    [ -n "$width" ] && [ -n "$height" ] || { echo "NONE not an image"; exit 0; }
    if [ "$format" = "png" ]; then
      $convert "${source}[0]" -resize "${max}x${max}>" "png:$thumb" 2>/dev/null
    else
      $convert "${source}[0]" -resize "${max}x${max}>" -background '#1e1e1e' \
        -alpha remove -alpha off "bmp3:$thumb" 2>/dev/null
    fi
    ;;
esac

[ -s "$thumb" ] || { echo "NONE could not make a thumbnail"; exit 0; }
printf 'OK %s %s %s %s\n' "$format" "$width" "$height" "$(one_line_base64 "$thumb")"
