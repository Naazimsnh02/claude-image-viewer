# Prints a small thumbnail of the clipboard's image (or of -Path) on one line:
#   OK <format> <original width> <original height> <base64>
#   NONE <reason>
# The mod reads that line; nothing is written to disk.
param(
  [int]$Max = 384,
  [ValidateSet('bmp', 'png')][string]$Format = 'bmp',
  [string]$Path = ''
)

$ErrorActionPreference = 'Stop'
$extensions = '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.tif', '.tiff'

function Open-ImageFile([string]$file) {
  if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { return $null }
  if ($extensions -notcontains [System.IO.Path]::GetExtension($file).ToLowerInvariant()) { return $null }
  # Copied through a stream so the file is not left locked.
  $bytes = [System.IO.File]::ReadAllBytes($file)
  return [System.Drawing.Image]::FromStream((New-Object System.IO.MemoryStream(, $bytes)))
}

try {
  Add-Type -AssemblyName System.Drawing
  Add-Type -AssemblyName System.Windows.Forms

  $image = $null
  if ($Path) {
    $image = Open-ImageFile $Path
  } else {
    $image = [System.Windows.Forms.Clipboard]::GetImage()
    if (-not $image) {
      foreach ($file in [System.Windows.Forms.Clipboard]::GetFileDropList()) {
        $image = Open-ImageFile $file
        if ($image) { break }
      }
    }
  }

  if (-not $image) {
    Write-Output 'NONE no image found'
    exit 0
  }

  $scale = [Math]::Min(1.0, $Max / [Math]::Max($image.Width, $image.Height))
  $width = [Math]::Max(1, [int][Math]::Round($image.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($image.Height * $scale))

  if ($Format -eq 'png') {
    $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format32bppArgb
    $imageFormat = [System.Drawing.Imaging.ImageFormat]::Png
  } else {
    $pixelFormat = [System.Drawing.Imaging.PixelFormat]::Format24bppRgb
    $imageFormat = [System.Drawing.Imaging.ImageFormat]::Bmp
  }

  $thumb = New-Object System.Drawing.Bitmap($width, $height, $pixelFormat)
  $graphics = [System.Drawing.Graphics]::FromImage($thumb)
  if ($Format -eq 'bmp') {
    # A BMP has no alpha: transparent pixels land on a neutral dark backdrop.
    $graphics.Clear([System.Drawing.Color]::FromArgb(30, 30, 30))
  }
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $attributes = New-Object System.Drawing.Imaging.ImageAttributes
  $attributes.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY)
  $target = New-Object System.Drawing.Rectangle(0, 0, $width, $height)
  $graphics.DrawImage($image, $target, 0, 0, $image.Width, $image.Height, [System.Drawing.GraphicsUnit]::Pixel, $attributes)

  $stream = New-Object System.IO.MemoryStream
  $thumb.Save($stream, $imageFormat)
  Write-Output ("OK $Format $($image.Width) $($image.Height) " + [Convert]::ToBase64String($stream.ToArray()))
} catch {
  Write-Output ('NONE ' + ($_.Exception.Message -replace '\s+', ' '))
}
