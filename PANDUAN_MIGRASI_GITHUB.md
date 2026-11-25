# PANDUAN MIGRASI KE GITHUB PRIBADI (andmediaid/jet-billing)

Panduan memindahkan project **Jet Billing** dari repo lama `alijayanet/billing-rtrw`
ke repo pribadi **`https://github.com/andmediaid/jet-billing`** dengan riwayat bersih
(fresh start), lalu **menghapus semua akses GitHub milik alijaya** dari komputer ini,
serta cara install dan update di VPS.

Dokumen ini dipakai bersama script:

| File | Fungsi |
|---|---|
| `scripts/migrate-to-andmediaid.ps1` | Migrasi di PC Windows (arsip .git lama → repo baru → push) |
| `scripts/install-vps.sh` | Install aplikasi dari GitHub di VPS (Ubuntu/Debian/Armbian) |
| `update.sh` (sudah ada) | Update ringan di VPS: git pull → npm install bila perlu → pm2 reload |
| `settings.example.json` | Template konfigurasi (pengganti `settings.json` yang tidak di-commit) |

---

## 0. Kondisi awal yang sudah diperiksa

| Item | Status |
|---|---|
| Remote lama | `origin` → `https://github.com/alijayanet/billing-rtrw.git` (branch `main`) |
| Repo lama | **PUBLIK**, 687 commit, 41 bintang, 49 fork |
| Target baru | `https://github.com/andmediaid/jet-billing` → **belum ada (HTTP 404)**, harus dibuat dulu |
| Commit lokal | Ketinggalan **9 commit** dari repo lama (sysadmin upgrade, soundbox, TR-069) — lihat bagian C.0 |
| `.env` lokal | Sudah mengarah ke `andmediaid/jet-billing`, `GITHUB_TOKEN` masih kosong |
| File sensitif yang IKUT ter-commit di repo lama | `settings.json`, `database.sqlite`, `database/billing.db`, `database/billing1.db`, `data/wa-lid-map.json`, **`data/wireguard-server.json` (private key asli)**, `billing-rtrw.apk`, `billing-rtrw.aab`, `public/downloads/*.apk|aab` |

Artinya file-file di atas **sudah bocor ke publik** dan tetap ada di riwayat repo lama.
Karena itu:

1. Repo baru dibuat **fresh start** (tanpa riwayat lama) supaya tidak membawa kebocoran.
2. Semua password/API key di bawah ini **WAJIB diganti** (bagian H.3).

---

## A. Bebaskan ruang disk C: dulu (WAJIB)

Saat panduan ini dibuat, drive C: punya **0 GB ruang kosong**; `git commit`/`push` akan gagal
dengan error `ENOSPC` bila tidak dibebaskan dulu.

```powershell
# 1) Lihat pemakan disk terbesar
Get-ChildItem C:\BILLING -Recurse -File -ErrorAction SilentlyContinue |
  Sort-Object Length -Descending |
  Select-Object -First 15 FullName, @{n='MB';e={[math]::Round($_.Length/1MB,1)}}

# 2) Bersihkan sampah yang aman dihapus
Remove-Item -Recurse -Force "$env:TEMP\*" -ErrorAction SilentlyContinue
Clear-RecycleBin -Force -ErrorAction SilentlyContinue
Remove-Item -Recurse -Force 'C:\BILLING\billing-rtrw\backups','C:\BILLING\billing-rtrw\logs' -ErrorAction SilentlyContinue

# 3) node_modules boleh dihapus (bisa dipasang ulang kapan saja)
Remove-Item -Recurse -Force 'C:\BILLING\billing-rtrw\node_modules' -ErrorAction SilentlyContinue

# 4) Cek ulang
Get-PSDrive C | Select-Object @{n='FreeGB';e={[math]::Round($_.Free/1GB,2)}}
```

Target minimal: **2 GB kosong**. Jangan hapus `database/`, `settings.json`, dan `auth_info_baileys/`
lokal karena itu data kerja Anda (semuanya tidak akan di-commit).

---

## B. Buat repo baru di GitHub

Sudah dicek: `andmediaid/jet-billing` **masih 404**, jadi harus dibuat lebih dulu.

1. Login GitHub sebagai **`andmediaid`**.
2. Buka <https://github.com/new>.
3. Isi:
   - **Repository name**: `jet-billing`
   - **Owner**: `andmediaid`
   - **Visibility**: **Private** (disarankan; aplikasi mendukung repo privat via `GITHUB_TOKEN`)
   - **JANGAN** centang *Add a README file*, *Add .gitignore*, atau *Choose a license* (harus kosong agar push pertama tidak bentrok).
4. Klik **Create repository**. Halaman berisi perintah git boleh diabaikan.

> Jika repo sebenarnya sudah ada tetapi private, lewati bagian ini dan lanjut ke C.

---

## C. Migrasi project di PC

### C.0 (Opsional) Ambil dulu 9 commit terbaru dari repo lama

Lokal Anda ketinggalan 9 commit (`dd8b0d1 fix(sysadmin): add fallback pm2 resurrect/start in upgrade script`, dst.)
yang mengubah `app-customer.js`, `routes/adminPortal.js`, `routes/customerAPI.js`, `services/adminAiTools.js`, dll.
Repo lama masih publik dan belum dihapus, jadi 9 commit itu masih bisa diambil kapan saja.
Kalau ingin dibawa ke repo baru, jalankan **sebelum** langkah C.1:

```powershell
cd 'C:\BILLING\billing-rtrw'
git stash push -u -m "wip-lokal-sebelum-migrasi"   # simpan perubahan lokal
git pull --ff-only origin main                      # tarik 9 commit
git stash pop                                       # kembalikan perubahan lokal (bisa konflik)
```

Kalau `git stash pop` konflik, selesaikan per file (`git status` → edit → `git add`).
**Kalau tidak mau repot, lewati C.0** — kode Anda saat ini tetap utuh, dan 9 commit itu
masih tersedia di repo lama selama repo tersebut belum dihapus.

### C.1 Jalankan script migrasi

```powershell
cd 'C:\BILLING\billing-rtrw'
powershell -ExecutionPolicy Bypass -File .\scripts\migrate-to-andmediaid.ps1
```

Yang dilakukan script:

1. Memindahkan folder `.git` lama ke `C:\BILLING\_arsip-git-alijayanet-<tanggal>` (di LUAR project, jadi tidak ikut ter-commit).
2. `git init -b main` + identitas `andmediaid` + `remote origin` → repo baru.
3. `git add -A` mengikuti `.gitignore` baru, lalu **menolak commit** jika masih ada file sensitif
   (`settings.json`, `*.db`, `*.apk`, `*.aab`, `wireguard-server.json`, `.env`, `auth_info_baileys/`).
4. Membuat commit awal `Initial commit - Jet Billing by Andmedia`.

Kirim ke GitHub (setelah bagian B selesai):

```powershell
git push -u origin main
```

Atau sekali jalan:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\migrate-to-andmediaid.ps1 -Push
```

Ingin `.git` lama dihapus permanen tanpa arsip? Tambahkan `-DeleteOldGit`.

### C.2 Setelah push berhasil

1. Buka `https://github.com/andmediaid/jet-billing` → pastikan **`settings.json`, `database/`,
   APK/AAB, dan `data/wireguard-server.json` TIDAK ada** di daftar file.
2. Di VS Code: `Ctrl+Shift+P` → **Developer: Reload Window** agar Source Control memakai repo baru.
3. Verifikasi:

```powershell
git remote -v      # harus menunjuk andmediaid/jet-billing
git log --oneline  # hanya 1 commit "Initial commit - Jet Billing by Andmedia"
```

### C.3 Cara manual (tanpa script)

```powershell
cd 'C:\BILLING\billing-rtrw'
Move-Item .git 'C:\BILLING\_arsip-git-alijayanet'
git init -b main
git config user.name "andmediaid"
git config user.email "andmediaid@users.noreply.github.com"
git remote add origin https://github.com/andmediaid/jet-billing.git
git add -A
git diff --cached --name-only    # PERIKSA: tidak boleh ada settings.json / *.db / *.apk
git commit -m "Initial commit - Jet Billing by Andmedia"
git push -u origin main
```

---

## D. Hapus SEMUA akses GitHub alijaya dari komputer ini

Lakukan berurutan. Bagian D.1–D.4 bisa langsung dijalankan; D.5–D.8 adalah tindakan di web GitHub.

### D.1 Hapus remote lama (kalau masih ada)

```powershell
cd 'C:\BILLING\billing-rtrw'
git remote -v
git remote remove origin 2>$null      # abaikan bila error
git remote add origin https://github.com/andmediaid/jet-billing.git
git remote -v                          # pastikan hanya andmediaid
```

Cap "URL yang tertanam token" ala lama (jika ada) bisa dibersihkan dengan:

```powershell
git config --local --unset-all credential.helper 2>$null
Select-String -Path .git\config -Pattern 'alijaya'   # hasil kosong = bersih
Select-String -Path .git\config -Pattern 'ghp_|github_pat_'   # hasil kosong = tidak ada token tersimpan
```

### D.2 Hapus arsip `.git` lama dan jejak alijayanet

```powershell
# arsip .git lama (dibuat script migrasi) sudah tidak dipakai:
Remove-Item -Recurse -Force 'C:\BILLING\_arsip-git-alijayanet*' -ErrorAction SilentlyContinue

# cari sisa jejak di seluruh project (kecuali node_modules)
Get-ChildItem 'C:\BILLING\billing-rtrw' -Recurse -File -Exclude *.log |
  Where-Object { $_.FullName -notmatch 'node_modules' } |
  Select-String -Pattern 'alijayanet' -List | Select-Object Path
```

Jika muncul hasil, hapus baris/URL alijayanet tersebut lalu commit perbaikannya.

### D.3 Hapus kredensial GitHub yang tersimpan di Windows

```powershell
# lihat daftar credential GitHub
cmdkey /list | Select-String -Pattern 'github'

# hapus credential git GitHub (nama target umum)
cmdkey /delete:git:https://github.com
cmdkey /delete:LegacyGeneric:target=git:https://github.com

# cara alternatif via Git Credential Manager (jika cmdkey tidak menemukan apa pun)
"protocol=https`nhost=github.com`n`n" | git credential reject
"protocol=https`nhost=github.com`n`n" | git credential-manager erase
```

Setelah ini, Git akan meminta login **akun baru (andmediaid)** saat push pertama.

### D.4 Keluarkan akun lama dari VS Code

1. Klik ikon **Accounts** (kiri bawah VS Code) → akun GitHub `alijayanet` → **Sign Out**.
2. Kalau ada lebih dari satu akun: **Accounts** → *Manage Trusted Extensions / Sign in with GitHub* → tambahkan akun `andmediaid`.
3. Cek sisa jejak di pengaturan VS Code (opsional): cari `github` di `Ctrl+,` dan di file
   `%APPDATA%\Code\User\settings.json`, lalu bersihkan entri akun lama.
4. Reload window: `Ctrl+Shift+P` → **Developer: Reload Window**.

### D.5 Cabut token akses (Personal Access Token) milik alijaya

1. Login GitHub → **Settings** → **Developer settings** → **Personal access tokens**
   (Tokens classic & Fine-grained).
2. Hapus/`Revoke` semua token yang pernah dibuat untuk project ini.
3. Cek **Applications → Authorized OAuth Apps** → hapus aplikasi yang terkait alijayanet.
4. Cek **Settings → Applications → GitHub Apps / SSH and GPG keys** → hapus yang tidak dipakai.

### D.6 Lepas kaitan di repo lama `alijayanet/billing-rtrw`

Repo lama **masih publik** dan masih memuat data sensitif, jadi pilih salah satu:

- **Disarankan — hapus repo**: buka `https://github.com/alijayanet/billing-rtrw/settings` →
  scroll ke *Danger Zone* → **Delete this repository**.
- **Alternatif — jadikan private**: *Danger Zone* → **Change repository visibility** → Private.
- **Alternatif — transfer** ke akun `andmediaid`: *Danger Zone* → **Transfer ownership**.

Sebelum menghapus, pastikan:
- Semua kode yang dibutuhkan sudah ada di repo baru (sudah di-push dan diverifikasi di bagian C.2).
- Kalau butuh 9 commit tambahan dari repo lama, sudah diambil lewat langkah C.0.
- Anda tidak lagi memakai URL repo lama di VPS (dicek di bagian E).

Di repo lama, bersihkan juga: **Settings → Collaborators and teams** (hapus kolaborator `andmediaid`
bila ada), dan **Settings → Branches** (hapus aturan proteksi yang menunjuk alijayanet).

### D.7 Jika akun `alijayanet` punya akses ke repo baru

Pastikan `andmediaid/jet-billing` → **Settings → Collaborators and teams** hanya berisi akun Anda
sendiri. Hapus `alijayanet` bila muncul.

### D.8 Bersihkan konfigurasi gitglobal (bila ada)

```powershell
git config --global --list | Select-String -Pattern 'alijaya|billing-rtrw'
# jika ada hasil:
git config --global --unset <nama.key>
```

---

## E. Arahkan aplikasi & fitur update ke repo baru

Tiga tempat berikut menentukan dari mana fitur "Update" menarik kode:

**1. `settings.json`** (di PC dan di VPS) — nilai saat ini sudah benar:

```json
"github_repo_url": "https://github.com/andmediaid/jet-billing.git",
"github_branch": "main"
```

Bisa juga diubah dari UI: **Panel Admin → Settings → Update**.

**2. `.env`** (tidak di-commit):

```env
GITHUB_REPO_URL=https://github.com/andmediaid/jet-billing.git
GITHUB_BRANCH=main
GITHUB_TOKEN=            # isi Personal Access Token bila repo dijadikan PRIVATE
```

Kalau repo **private**, buat token: GitHub → **Settings → Developer settings → Personal access tokens
→ Fine-grained tokens → Generate new token**, pilih repo `andmediaid/jet-billing`, izin
**Contents: Read-only**. Tempel ke `GITHUB_TOKEN`. Token ini juga dipakai `scripts/install-vps.sh`
(`export GITHUB_TOKEN=...`).

**3. Docker/hosting lain**: pastikan tidak ada lagi URL `alijayanet` di konfigurasi VPS
(cek bagian F.3).

Referensi kode: `routes/adminPortal.js` (fungsi `getUpdateRepoConfig`, tombol Update) dan
`services/cronService.js` (pemeriksa versi otomatis).

---

## F. Install di VPS (langsung dari repo baru)

### F.1 Cara cepat (pakai script)

Di VPS, login sebagai user yang punya sudo:

```bash
# repo publik
curl -fsSL https://raw.githubusercontent.com/andmediaid/jet-billing/main/scripts/install-vps.sh -o install-vps.sh
bash install-vps.sh

# repo privat (butuh token)
export GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxx
curl -H "Authorization: token $GITHUB_TOKEN" -fsSL \
  https://raw.githubusercontent.com/andmediaid/jet-billing/main/scripts/install-vps.sh -o install-vps.sh
bash install-vps.sh https://github.com/andmediaid/jet-billing.git /opt/jet-billing main
```

Jika repo sudah ada di VPS (misalnya folder lama), script tetap aman dijalankan: ia akan
`git pull` alih-alih clone ulang, dan **tidak menimpa** `settings.json` yang sudah ada.

Setelah itu:

```bash
cd /opt/jet-billing
nano settings.json      # isi kredensial + server_host/server_port
pm2 restart billing
pm2 logs billing
sudo pm2 startup && pm2 save     # sekali saja, agar auto-start saat reboot
```

### F.2 Cara manual (setara)

```bash
sudo apt update && sudo apt install -y git curl build-essential python3
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

git clone https://github.com/andmediaid/jet-billing.git /opt/jet-billing
cd /opt/jet-billing
cp env-example.txt .env
cp settings.example.json settings.json
chmod 600 settings.json
nano .env               # GITHUB_REPO_URL + GITHUB_BRANCH
nano settings.json      # kredensial MikroTik/GenieACS, admin, session_secret, port

npm ci --omit=dev || npm install --omit=dev
sudo npm install -g pm2
pm2 start app-customer.js --name billing --time
pm2 save && sudo pm2 startup
```

### F.3 Migrasi VPS yang masih menunjuk repo lama

```bash
cd /opt/billing-rtrw          # sesuaikan nama folder
cp settings.json ~/settings.json.bak      # WAJIB: simpan konfigurasi
cp -r database ~/database.bak              # WAJIB: simpan database
git remote -v                              # pastikan masih alijayanet
git remote set-url origin https://github.com/andmediaid/jet-billing.git
git remote -v                              # harus andmediaid
```

> **PENTING:** repo baru memakai **riwayat baru (1 commit)**, berbeda total dari riwayat repo lama.
> Jadi `git pull` setelah `set-url` akan gagal dengan
> `refusing to merge unrelated histories`. Jangan dipaksa merge — gunakan cara aman di F.4.

### F.4 Cara aman memindahkan instalasi VPS ke repo baru (disarankan)

```bash
# 1. Backup konfigurasi & data dari instalasi lama
cd /opt/billing-rtrw
cp settings.json ~/settings.json.bak
cp -r database ~/database.bak
tar czf ~/auth_info_baileys.tar.gz auth_info_baileys 2>/dev/null || true
cp .env ~/env.bak 2>/dev/null || true

# 2. Pasang dari repo baru di folder baru
export GITHUB_TOKEN=ghp_xxxxxxxx     # hanya jika repo dibuat PRIVATE
git clone https://github.com/andmediaid/jet-billing.git /opt/jet-billing
cd /opt/jet-billing

# 3. Kembalikan konfigurasi & data
cp ~/settings.json.bak settings.json
mkdir -p database && cp -r ~/database.bak/. database/
tar xzf ~/auth_info_baileys.tar.gz 2>/dev/null || true
[ -f ~/env.bak ] && cp ~/env.bak .env || cp env-example.txt .env
chmod 600 settings.json

# 4. Pasang dependensi & jalankan
npm ci --omit=dev || npm install --omit=dev
pm2 delete billing 2>/dev/null || true
pm2 start app-customer.js --name billing --time
pm2 save

# 5. Uji dulu (login panel, cek MikroTik/GenieACS, cek data pelanggan)
```

Setelah yakin, matikan instalasi lama:

```bash
pm2 delete <nama-app-lama> 2>/dev/null || true
mv /opt/billing-rtrw /opt/billing-rtrw.old     # hapus setelah beberapa hari bila aman
```

---

## G. Alur update harian: VS Code → GitHub → VPS

### G.1 Kirim perubahan dari VS Code

1. Edit kode di VS Code.
2. `Ctrl+Shift+G` (Source Control) → tulis pesan commit → **Commit**.
3. Klik **Sync Changes** (ikon ⟳ di status bar) atau jalankan `git push origin main`.
4. Naikkan versi rilis di `version.txt` (mis. `B 4.8.1-R24` → `B 4.8.2`) agar pemeriksa versi
   di panel admin/cron mendeteksi ada update.

### G.2 Terapkan di VPS

```bash
cd /opt/jet-billing
bash update.sh
```

`update.sh` melakukan: backup `settings.json` + folder `database` → `git pull origin main` →
`npm install` **hanya bila `package.json` berubah** → `pm2 reload billing`.

Atau lewat UI: **Panel Admin → Update → Cek Versi → Update Sekarang**
(endpoint di `routes/adminPortal.js` menjalankan `update.sh` pada Linux).

### G.3 Update otomatis terjadwal (opsional)

`services/cronService.js` sudah memeriksa `version.txt` repo vs lokal dan bisa menjalankan
`git pull`. Pastikan `github_repo_url` (bagian E) menunjuk ke repo Anda, karena bila masih
menunjuk repo orang lain, aplikasi bisa menarik kode yang salah.

### G.4 Ringkasan perintah cepat

| Sisi | Perintah |
|---|---|
| PC (VS Code) | `git add -A ; git commit -m "pesan" ; git push origin main` |
| VPS | `cd /opt/jet-billing && bash update.sh` |
| VPS cek status | `pm2 status ; pm2 logs billing --lines 50` |

---

## H. Checklist & catatan penting

### H.1 Checklist migrasi

- [ ] Ruang disk C: minimal 2 GB
- [ ] Repo `andmediaid/jet-billing` sudah dibuat di GitHub
- [ ] `scripts/migrate-to-andmediaid.ps1` selesai (1 commit, tanpa file sensitif)
- [ ] `git push -u origin main` berhasil
- [ ] Di GitHub **tidak ada** `settings.json`, `database/`, `*.apk`, `*.aab`, `data/wireguard-server.json`
- [ ] `git remote -v` hanya menunjuk `andmediaid/jet-billing`
- [ ] Credential GitHub lama terhapus + akun alijaya sign out dari VS Code
- [ ] Token/PAT alijaya dicabut (bagian D.5)
- [ ] Repo lama `alijayanet/billing-rtrw` dihapus/di-private/transfer (bagian D.6)
- [ ] VPS sudah pindah ke repo baru dan aplikasi berjalan (bagian F.4)
- [ ] `github_repo_url` + `GITHUB_TOKEN` benar di PC & VPS
- [ ] Semua kredensial di H.3 sudah diganti

### H.2 File yang sekarang TIDAK lagi di-commit

| File | Pengganti / penanganan |
|---|---|
| `settings.json` | template `settings.example.json`; isi kredensial langsung di server |
| `database/`, `database.sqlite` | backup terpisah (rsync/zip), bukan lewat GitHub |
| `*.apk`, `*.aab`, `public/downloads/*.apk|aab` | upload manual ke web server/hosting rilis |
| `data/wireguard-server.json` | dibuat otomatis oleh aplikasi (`services/wireguardService.js`) |
| `.env` | dibuat di server dari `env-example.txt` |
| `auth_info_baileys/`, `logs/`, `backups/` | tetap lokal di server |

`.gitignore` dan `settings.example.json` sudah diperbarui pada migrasi ini.

### H.3 WAJIB ganti kredensial (nilai lama sudah bocor di repo publik)

Ganti satu per satu, lalu simpan hanya di `settings.json` server (jangan di repo):

- Password **MikroTik** (`mikrotik_password`) + user admin router
- Password **GenieACS** (`genieacs_password`)
- `admin_password`, `admin_api_key`, `session_secret`, `webhook_secret`, `radius_secret`
- API key pembayaran: Tripay, Midtrans, Xendit, Duitku, Digiflazz
- `telegram_bot_token`, `fonnte_token`, serta API key AI (Gemini/OpenAI/DeepSeek/Groq/OpenRouter)
- `qris_static_payload` → generate ulang QRIS statik di aplikasi merchant
- WireGuard: hapus `data/wireguard-server.json` di server, aplikasi akan membuat keypair baru
- Sesi WhatsApp: jika ingin benar-benar bersih, logout lalu scan QR ulang

Membuat `session_secret` baru yang kuat:

```powershell
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### H.4 Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| `ENOSPC: no space left on device` | disk penuh | jalankan bagian A, lalu ulangi |
| `! [rejected] main -> main (fetch first)` | repo baru sudah punya commit (mis. centang README) | hapus commit itu di GitHub, atau `git push -u origin main --force` (aman karena repo baru) |
| `refusing to merge unrelated histories` | VPS menarik repo baru padahal history-nya beda | gunakan cara F.4 (folder baru) |
| `Authentication failed` saat push | credential masih milik alijaya | bagian D.3, lalu push dan login `andmediaid` |
| `src refspec main does not match any` | belum ada commit | `git add -A ; git commit -m "Initial commit"` |
| VS Code masih menampilkan alijaya | cache Source Control | Developer: Reload Window + cek `git remote -v` |
| `fatal: not a git repository` | `.git` sudah diarsipkan | jalankan ulang script / bagian C.3 |

### H.5 Catatan akhir

1. Arsip `C:\BILLING\_arsip-git-alijayanet-*` masih memuat history + database + `settings.json` lama.
   Setelah migrasi diverifikasi, hapus (bagian D.2).
2. Fresh start berarti **history lama tidak dibawa**. Pastikan bagian C.0 sudah dipertimbangkan
   sebelum repo lama dihapus, karena setelah dihapus 9 commit itu tidak bisa diambil lagi.
3. Disarankan repo **Private** + aktifkan 2FA pada akun `andmediaid`.
4. Jangan pernah lagi menjalankan `git add -f settings.json` atau meng-commit folder `database/`.
5. File panduan ini menyebut nama repo lama. Jika repo baru dibuat **publik**, pertimbangkan
   menghapus `PANDUAN_MIGRASI_GITHUB.md` dari repo (`git rm --cached PANDUAN_MIGRASI_GITHUB.md`)
   atau cukup buat repo **Private**.
6. Line ending sudah dinormalkan: semua `*.sh` dipaksa **LF** lewat `.gitattributes`
   (penting agar `update.sh`/`install-vps.sh` tidak error di VPS).





