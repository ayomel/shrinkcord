param([string]$OutputDirectory = (Join-Path $env:TEMP 'shrinkcord-e2e-qa'))
$ErrorActionPreference = 'Stop'
$ffmpeg = (Get-Command ffmpeg -ErrorAction Stop).Source
New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
function Invoke-FixtureEncode([string[]]$Arguments) {
  & $ffmpeg -hide_banner -loglevel error @Arguments
  if ($LASTEXITCODE -ne 0) { throw 'FFmpeg fixture generation failed.' }
}
Invoke-FixtureEncode -Arguments @('-f', 'lavfi', '-i', 'testsrc2=size=160x120:rate=5', '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', (Join-Path $OutputDirectory 'clip.mp4'))
Invoke-FixtureEncode -Arguments @('-f', 'lavfi', '-i', 'color=red:size=64x64', '-frames:v', '1', '-y', (Join-Path $OutputDirectory 'small.png'))
Invoke-FixtureEncode -Arguments @('-f', 'lavfi', '-i', 'testsrc2=size=3000x3000', '-vf', 'noise=alls=100:allf=t', '-frames:v', '1', '-y', (Join-Path $OutputDirectory 'oversized.png'))
Invoke-FixtureEncode -Arguments @('-f', 'lavfi', '-i', 'color=red:size=3000x3000', '-frames:v', '1', '-compression_level', '0', '-y', (Join-Path $OutputDirectory 'compressible.png'))
Invoke-FixtureEncode -Arguments @('-f', 'lavfi', '-i', 'color=black:size=16x16:rate=1', '-t', '601', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', (Join-Path $OutputDirectory 'tooLong.mp4'))
[System.IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'empty.png'), [byte[]]@())
[System.IO.File]::WriteAllBytes((Join-Path $OutputDirectory 'empty.mp4'), [byte[]]@())
Set-Content -LiteralPath (Join-Path $OutputDirectory 'unsupported.txt') -Value 'QA unsupported file'
Get-ChildItem -LiteralPath $OutputDirectory | Select-Object Name, Length
