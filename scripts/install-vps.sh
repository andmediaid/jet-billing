#!/usr/bin/env bash
# ============================================================
#  INSTALL JET BILLING DI VPS (Ubuntu / Debian / Armbian)
#  Sumber kode: repo GitHub pribadi (andmediaid/jet-billing)
#
#  Pemakaian:
#    bash install-vps.sh
#    bash install-vps.sh https://github.com/andmediaid/jet-billing.git /opt/jet-billing main
#
#  Repo PRIVAT: set token dulu
#    export GITHUB_TOKEN=ghp_xxxxxxxx
#    bash install-vps.sh
# ============================================================
set -euo pipefail

REPO_URL="${1:-https://github.com/andmediaid/jet-billing.git}"
TARGET_DIR="${2:-/opt/jet-billing}"
BRANCH="${3:-main}"
APP_NAME="${PM2_APP:-billing}"
TOKEN="${GITHUB_TOKEN:-}"

RED='\033[0;31m'; GREEN='\033[0;32m'; BLUE='\033[0;34m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
fail()  { echo -e "${RED}[ERROR]${NC} $*"; exit 1; }

if [ "$(id -u)" -eq 0 ]; then SUDO=""; else SUDO="sudo"; fi

echo -e "${BOLD}=== Install Jet Billing ===${NC}"
echo "  Repo   : $REPO_URL"
echo "  Branch : $BRANCH"
echo "  Target : $TARGET_DIR"
echo "  PM2    : $APP_NAME"
echo ""

# ------------------------------------------------------------
# 1. Paket dasar & Node.js >= 20
# ------------------------------------------------------------
info "Memeriksa paket dasar (git, curl, build tools)..."
if command -v apt-get >/dev/null 2>&1; then
  $SUDO apt-get update -qq
  $SUDO apt-get install -y -qq git curl ca-certificates build-essential python3 >/dev/null
fi
command -v git >/dev/null 2>&1 || fail "git tidak tersedia"

NODE_OK=false
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR="$(node -v | sed 's/^v//' | cut -d. -f1)"
  [ "${NODE_MAJOR:-0}" -ge 20 ] && NODE_OK=true
fi

if [ "$NODE_OK" != true ]; then
  info "Node.js >= 20 belum ada. Memasang Node.js 20 LTS (NodeSource)..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO -E bash -
  $SUDO apt-get install -y -qq nodejs >/dev/null
fi
ok "Node $(node -v) | npm $(npm -v)"

# ------------------------------------------------------------
# 2. Ambil kode dari GitHub
# ------------------------------------------------------------
if [ -n "$TOKEN" ]; then
  CLONE_URL="$(echo "$REPO_URL" | sed -E "s#https://#https://${TOKEN}@#")"
else
  CLONE_URL="$REPO_URL"
fi

if [ -d "$TARGET_DIR/.git" ]; then
  info "Folder sudah ada, menarik update terbaru..."
  cd "$TARGET_DIR"
  git remote set-url origin "$REPO_URL"
  git fetch --prune origin "$BRANCH"
  git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH" "origin/$BRANCH"
  git pull --ff-only origin "$BRANCH" || warn "git pull gagal (mungkin ada perubahan lokal). Lanjutkan manual."
  ok "Kode diperbarui"
else
  info "Meng-clone repo..."
  $SUDO mkdir -p "$(dirname "$TARGET_DIR")"
  $SUDO chown -R "$(id -un):$(id -gn)" "$(dirname "$TARGET_DIR")" 2>/dev/null || true
  git clone --branch "$BRANCH" "$CLONE_URL" "$TARGET_DIR"
  cd "$TARGET_DIR"
  git remote set-url origin "$REPO_URL"   # jangan simpan token di .git/config
  ok "Clone selesai"
fi
cd "$TARGET_DIR"

# ------------------------------------------------------------
# 3. File konfigurasi (tidak ikut repo demi keamanan)
# ------------------------------------------------------------
if [ ! -f .env ] && [ -f env-example.txt ]; then
  cp env-example.txt .env
  sed -i "s#^GITHUB_REPO_URL=.*#GITHUB_REPO_URL=$REPO_URL#" .env
  sed -i "s#^GITHUB_BRANCH=.*#GITHUB_BRANCH=$BRANCH#" .env
  [ -n "$TOKEN" ] && sed -i "s#^GITHUB_TOKEN=.*#GITHUB_TOKEN=$TOKEN#" .env
  ok "File .env dibuat dari env-example.txt"
fi

if [ ! -f settings.json ]; then
  if [ -f settings.example.json ]; then
    cp settings.example.json settings.json
    chmod 600 settings.json
    warn "settings.json dibuat dari template. WAJIB diisi: kredensial MikroTik/GenieACS,"
    warn "admin_password, session_secret, admin_api_key, dan server_host/server_port."
  else
    fail "settings.example.json tidak ditemukan di repo."
  fi
fi

# ------------------------------------------------------------
# 4. Dependensi
# ------------------------------------------------------------
if [ -f package-lock.json ]; then
  info "Memasang dependensi (npm ci)..."
  UV_THREADPOOL_SIZE=2 npm ci --omit=dev --no-audit --no-fund || npm install --omit=dev --no-audit --no-fund
else
  info "Memasang dependensi (npm install)..."
  UV_THREADPOOL_SIZE=2 npm install --omit=dev --no-audit --no-fund
fi
ok "Dependensi terpasang"

# ------------------------------------------------------------
# 5. PM2
# ------------------------------------------------------------
command -v pm2 >/dev/null 2>&1 || { info "Memasang PM2..."; $SUDO npm install -g pm2; }

info "Menjalankan aplikasi via PM2 ($APP_NAME)..."
if pm2 describe "$APP_NAME" >/dev/null 2>&1; then
  pm2 reload "$APP_NAME"
else
  pm2 start app-customer.js --name "$APP_NAME" --time
fi
pm2 save
ok "Aplikasi berjalan"

echo ""
ok "Instalasi selesai."
echo "  Cek status : pm2 status"
echo "  Lihat log  : pm2 logs $APP_NAME"
echo "  Restart    : pm2 restart $APP_NAME"
echo "  Auto-start setelah reboot (jalankan sekali): pm2 startup && pm2 save"
echo ""
warn "Jangan lupa: buka firewall/port sesuai settings.json (default 3001)."
