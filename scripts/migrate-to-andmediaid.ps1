<#
.SYNOPSIS
  Migrasi project Billing RTRW ke repo GitHub pribadi (andmediaid/jet-billing)
  dengan riwayat bersih (fresh start) dan tanpa file sensitif.

.DESCRIPTION
  - Mengarsipkan folder .git lama (jejak alijayanet) ke LUAR folder project
  - Membuat repo git baru dengan 1 commit awal, tanpa settings.json,
    database, APK/AAB, dan private key WireGuard
  - Mengarahkan remote origin ke repo baru
  - Opsional langsung push (-Push)

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\migrate-to-andmediaid.ps1
  powershell -ExecutionPolicy Bypass -File .\scripts\migrate-to-andmediaid.ps1 -Push
  powershell -ExecutionPolicy Bypass -File .\scripts\migrate-to-andmediaid.ps1 -DeleteOldGit
#>
[CmdletBinding()]
param(
  [string]$RepoUrl   = 'https://github.com/andmediaid/jet-billing.git',
  [string]$Branch    = 'main',
  [string]$UserName  = 'andmediaid',
  [string]$UserEmail = 'andmediaid@users.noreply.github.com',
  [string]$Message   = 'Initial commit - Jet Billing by Andmedia',
  [switch]$Push,
  [switch]$DeleteOldGit
)

$ErrorActionPreference = 'Stop'

function Write-Step($t) { Write-Host "`n==> $t" -ForegroundColor Cyan }
function Write-Ok($t)   { Write-Host "    OK   : $t" -ForegroundColor Green }
function Write-Warn($t) { Write-Host "    WARN : $t" -ForegroundColor Yellow }
function Write-Err($t)  { Write-Host "    ERROR: $t" -ForegroundColor Red }

# ------------------------------------------------------------------
# 1. Validasi awal
# ------------------------------------------------------------------
$root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $root 'app-customer.js'))) {
  throw "Folder project tidak dikenali (app-customer.js tidak ada): $root"
}
Set-Location $root
Write-Step "Project: $root"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  throw 'Git tidak ditemukan di PATH. Install Git for Windows dahulu.'
}
Write-Ok ("Git " + (git --version))

$drive  = (Get-Item $root).PSDrive
$freeGB = [math]::Round($drive.Free / 1GB, 2)
if ($freeGB -lt 1) {
  Write-Warn "Sisa ruang disk $($drive.Name): hanya $freeGB GB. Push/commit bisa gagal (ENOSPC)."
  Write-Warn "Kosongkan disk dulu, misal hapus node_modules lama atau file di %TEMP%."
}

# ------------------------------------------------------------------
# 2. Arsipkan .git lama (jejak alijayanet) ke luar folder project
# ------------------------------------------------------------------
$gitDir = Join-Path $root '.git'
if (Test-Path $gitDir) {
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  if ($DeleteOldGit) {
    Write-Step 'Menghapus folder .git lama (tanpa arsip)...'
    Remove-Item -LiteralPath $gitDir -Recurse -Force
    Write-Ok '.git lama dihapus permanen'
  } else {
    Write-Step 'Mengarsipkan folder .git lama...'
    $archive = Join-Path (Split-Path -Parent $root) "_arsip-git-alijayanet-$stamp"
    Move-Item -LiteralPath $gitDir -Destination $archive
    Write-Ok "Arsip .git lama: $archive"
    Write-Warn 'Arsip ini masih memuat history + file sensitif. Hapus manual jika tidak diperlukan.'
  }
} else {
  Write-Warn 'Tidak ada folder .git (mungkin sudah dimigrasi). Lanjut membuat repo baru.'
}

# ------------------------------------------------------------------
# 3. Repo baru + identitas + remote baru
# ------------------------------------------------------------------
Write-Step 'Membuat repo git baru...'
git init -b $Branch | Out-Null
git config user.name  $UserName
git config user.email $UserEmail
git config core.longpaths true
git remote add origin $RepoUrl
Write-Ok "Remote origin = $RepoUrl (branch $Branch)"

if (-not (Test-Path 'settings.example.json')) {
  Write-Warn 'settings.example.json belum ada. Template konfigurasi VPS tidak akan tersedia.'
}

# ------------------------------------------------------------------
# 4. Stage + pengaman file sensitif
# ------------------------------------------------------------------
Write-Step 'Menambahkan file (mengikuti .gitignore baru)...'
git add -A
$staged  = @(git diff --cached --name-only)
$pattern = '(?i)(^|/)\.env$|^settings\.json$|\.(db|sqlite|db-wal|db-shm)$|\.(apk|aab|jks|keystore)$|wireguard-server\.json$|wireguard-clients\.json$|^auth_info_baileys/'
$blocked = @($staged | Where-Object { [regex]::IsMatch($_, $pattern) })

if ($blocked.Count -gt 0) {
  Write-Step 'DIBATALKAN: file sensitif berikut akan ikut ter-commit'
  $blocked | ForEach-Object { Write-Err $_ }
  throw 'Perbaiki .gitignore lebih dulu, lalu jalankan ulang script ini.'
}
Write-Ok "File siap commit: $($staged.Count) file (tanpa rahasia/database/APK)"

# ------------------------------------------------------------------
# 5. Commit awal
# ------------------------------------------------------------------
Write-Step 'Membuat commit awal...'
git commit -m $Message | Out-Null
Write-Ok ("Commit: " + (git rev-parse --short HEAD) + ' ' + $Message)

# ------------------------------------------------------------------
# 6. Push (opsional)
# ------------------------------------------------------------------
if ($Push) {
  Write-Step "Push ke $RepoUrl ..."
  git push -u origin $Branch
  Write-Ok 'Push selesai. Buka repo di GitHub untuk verifikasi.'
} else {
  Write-Step 'Selesai di sisi lokal. Langkah terakhir setelah repo dibuat di GitHub:'
  Write-Host "    git push -u origin $Branch" -ForegroundColor White
}

Write-Host "`nBerikutnya: bersihkan akses GitHub alijaya (PANDUAN_MIGRASI_GITHUB.md bagian D)." -ForegroundColor Yellow
Write-Host "Jangan lupa: reload window VS Code (Ctrl+Shift+P > Reload Window) agar Source Control memakai repo baru.`n" -ForegroundColor Yellow
