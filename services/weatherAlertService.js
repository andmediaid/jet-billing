'use strict';
/**
 * Weather Alert Service (BMKG per Desa)
 * - Mengambil prakiraan cuaca BMKG per adm4 (per server/desa, dari tabel `routers`).
 * - Mendeteksi cuaca buruk (hujan lebat / petir / badai / angin kencang, atau kode BMKG 60,61,63,95,97).
 * - Mengirim notifikasi WhatsApp ke pelanggan AKTIF di server/desa tersebut (via WA Gateway Baileys existing).
 * - Anti-spam: jeda minimal 6 jam per server untuk cuaca yang sama.
 *
 * CATATAN: hanya membaca data & mengirim pesan; tidak mengubah data pelanggan.
 */
const axios = require('axios');
const db = require('../config/database');
const { logger } = require('../config/logger');
const { getSetting } = require('../config/settingsManager');

const BMKG_URL = 'https://api.bmkg.go.id/publik/prakiraan-cuaca';
const BAD_CODES = new Set([60, 61, 63, 95, 97]);
const BAD_KEYWORDS = ['hujan lebat', 'hujan petir', 'petir', 'badai', 'angin kencang'];
const LOOKAHEAD_HOURS = 12;
const ANTI_SPAM_HOURS = 6;

function companyName() {
  return getSetting('company_header', getSetting('company_name', 'ISP')) || 'ISP';
}

function isCuacaFeatureEnabled() {
  return String(getSetting('cuaca_alert_enabled', '1')) !== '0';
}

function parseUtc(s) {
  if (!s) return NaN;
  return Date.parse(String(s).replace(' ', 'T') + 'Z');
}

function hhmm(localDateTime) {
  const m = String(localDateTime || '').match(/(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '';
}

function addHour(localDateTime) {
  const s = String(localDateTime || '');
  const m = s.match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
  d.setUTCHours(d.getUTCHours() + 1);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Ambil prakiraan BMKG berdasarkan kode adm4. Return { lokasi, slots[] }. */
async function fetchForecast(adm4) {
  const code = String(adm4 || '').trim();
  if (!code) throw new Error('Kode BMKG (adm4) belum diisi');
  const res = await axios.get(BMKG_URL, { params: { adm4: code }, timeout: 15000 });
  const data = (res && res.data) || {};
  const groups = (data.data && data.data[0] && data.data[0].cuaca) || [];
  const slots = [];
  (Array.isArray(groups) ? groups : [groups]).forEach((g) => {
    (Array.isArray(g) ? g : [g]).forEach((s) => { if (s) slots.push(s); });
  });
  return { lokasi: data.lokasi || {}, slots };
}

/**
 * Deteksi cuaca buruk dalam window jam ke depan.
 * Return null jika aman, atau { code, desc, jam1, jam2, key, slotsCount, startUtc, endUtc }.
 */
function findBadWeather(slots, hoursAhead = LOOKAHEAD_HOURS) {
  const now = Date.now();
  const limit = now + hoursAhead * 3600 * 1000;
  const bad = [];
  for (const s of slots || []) {
    const t = parseUtc(s.utc_datetime);
    if (isNaN(t)) continue;
    if (t < now - 3600 * 1000) continue;
    if (t > limit) continue;
    const code = Number(s.weather);
    const desc = String(s.weather_desc || '').toLowerCase();
    const kw = BAD_KEYWORDS.some((k) => desc.includes(k));
    if (BAD_CODES.has(code) || kw) {
      bad.push({ t, code, desc: s.weather_desc || '', local: s.local_datetime || '' });
    }
  }
  if (!bad.length) return null;
  bad.sort((a, b) => a.t - b.t);
  const first = bad[0];
  const last = bad[bad.length - 1];
  return {
    code: first.code,
    desc: first.desc,
    jam1: hhmm(first.local),
    jam2: addHour(last.local),
    key: `${first.code}|${String(first.local).slice(0, 13)}`,
    slotsCount: bad.length,
    startUtc: first.t,
    endUtc: last.t
  };
}

/** Ringkasan prakiraan 24 jam ke depan (untuk halaman admin). */
function summarizeToday(slots) {
  const now = Date.now();
  const end = now + 24 * 3600 * 1000;
  const out = [];
  for (const s of slots || []) {
    const t = parseUtc(s.utc_datetime);
    if (isNaN(t) || t < now - 3600 * 1000 || t > end) continue;
    out.push({ time: hhmm(s.local_datetime), desc: s.weather_desc || '', code: Number(s.weather), icon: s.image || '' });
  }
  return out;
}

/** Status koneksi WA Gateway (Baileys) yang sudah ada. */
async function getWaStatus() {
  const gatewayType = getSetting('wa_gateway_type', 'baileys');
  if (gatewayType !== 'baileys') {
    return { connected: true, gateway: gatewayType, message: `Gateway ${gatewayType} dikonfigurasi.` };
  }
  try {
    const { whatsappStatus } = await import('./whatsappBot.mjs');
    const conn = whatsappStatus && whatsappStatus.connection;
    return { connected: conn === 'open', gateway: 'baileys', connection: conn || 'close' };
  } catch (e) {
    return { connected: false, gateway: 'baileys', connection: 'close', error: e.message };
  }
}

/** Susun isi pesan peringatan cuaca. */
function buildMessage(customerName, bad) {
  return `Halo ${customerName} 🙏
Info cuaca dari BMKG, di tempat mu diprediksi akan ${bad.desc} pada ${bad.jam1} - ${bad.jam2}.

HIMBAUAN: Mohon MATIKAN MODEM / ONU & ROUTER dan cabut adaptor + kabel LAN untuk sementara agar terhindar dari KORSLETING atau SAMBARAN PETIR yang bisa merusak perangkat.

Nyalakan kembali setelah hujan reda / petir mereda. Jika setelah dinyalakan internet belum nyala, hubungi kami.
Terima kasih - ${companyName()}`;
}

/** Pelanggan aktif yang ikut server/desa tertentu (via router_id / mikrotik_id). */
function getActiveCustomersForRouter(router) {
  const multi = getSetting('multi_router_mode', 'disabled') === 'active';
  if (multi) {
    return db.prepare("SELECT id, name, phone FROM customers WHERE status='active' AND router_id = ?").all(router.id);
  }
  return db.prepare("SELECT id, name, phone FROM customers WHERE status='active' AND (router_id = ? OR router_id IS NULL OR router_id = 0)").all(router.id);
}

function logAlert(row) {
  try {
    db.prepare(`INSERT INTO cuaca_alert_logs
      (router_id, nama_server, nama_desa, kode_bmkg_adm4, cuaca, periode, terdeteksi_at, sent_count, failed_count, total_target, status, note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      row.router_id || null, row.nama_server || '', row.nama_desa || '', row.kode_bmkg_adm4 || '',
      row.cuaca || '', row.periode || '', row.terdeteksi_at || null,
      row.sent_count || 0, row.failed_count || 0, row.total_target || 0, row.status || 'sent', row.note || ''
    );
  } catch (e) {
    logger.warn('[CuacaAlert] gagal menulis log: ' + e.message);
  }
}


/**
 * Cek cuaca & kirim notifikasi untuk 1 server/desa.
 * opts.force = true -> abaikan anti-spam (dipakai tombol Test Kirim).
 * opts.testPhone = nomor tujuan uji (hanya kirim ke 1 nomor tsb).
 */
async function sendRouterWeatherAlerts(router, opts = {}) {
  const result = {
    router_id: router.id, server: router.name, desa: router.nama_desa || '',
    sent: 0, failed: 0, skipped: false, reason: '', bad: null, total: 0
  };
  const adm4 = String(router.kode_bmkg_adm4 || '').trim();
  if (!adm4) { result.reason = 'Kode BMKG belum diisi'; return result; }

  let forecast;
  try { forecast = await fetchForecast(adm4); }
  catch (e) { result.reason = 'Gagal ambil data BMKG: ' + e.message; return result; }

  let bad = findBadWeather(forecast.slots);
  if (!bad && opts.testPhone) {
    // Mode test: tetap kirim contoh pesan agar admin bisa verifikasi pengiriman WA.
    bad = { code: 0, desc: 'Cuaca Buruk (CONTOH TEST)', jam1: '16:00', jam2: '18:00', key: 'test', slotsCount: 0 };
  }
  result.bad = bad;
  if (!bad) { result.reason = 'Tidak ada cuaca buruk 6-12 jam ke depan (aman)'; return result; }

  if (!opts.force && !opts.testPhone) {
    const lastAt = router.cuaca_last_sent_at ? parseUtc(router.cuaca_last_sent_at) : NaN;
    const sameKey = String(router.cuaca_last_key || '') === bad.key;
    if (sameKey && !isNaN(lastAt) && (Date.now() - lastAt) < ANTI_SPAM_HOURS * 3600 * 1000) {
      result.skipped = true;
      result.reason = 'Anti-spam: sudah dikirim < 6 jam untuk cuaca yang sama';
      return result;
    }
  }

  const wa = await getWaStatus();
  if (!wa.connected) {
    result.skipped = true;
    result.reason = 'WA Gateway belum terkoneksi, silahkan pairing dulu';
    logAlert({
      router_id: router.id, nama_server: router.name, nama_desa: router.nama_desa,
      kode_bmkg_adm4: adm4, cuaca: bad.desc, periode: `${bad.jam1}-${bad.jam2}`,
      status: 'wa_offline', note: result.reason
    });
    return result;
  }

  const waSvc = require('./whatsappService');
  const targets = opts.testPhone
    ? [{ id: null, name: 'Test', phone: String(opts.testPhone).trim() }]
    : getActiveCustomersForRouter(router);

  result.total = targets.length;
  for (const c of targets) {
    const phone = String(c.phone || '').trim();
    if (!phone) { result.failed++; continue; }
    try {
      await waSvc.sendWhatsAppMessage(phone, buildMessage(c.name || 'Pelanggan', bad));
      result.sent++;
    } catch (e) {
      result.failed++;
      logger.warn(`[CuacaAlert] gagal kirim ke ${phone}: ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 3000 + Math.floor(Math.random() * 3000)));
  }

  if (!opts.testPhone) {
    try {
      db.prepare('UPDATE routers SET cuaca_last_sent_at = (NOW_LOCAL()), cuaca_last_key = ? WHERE id = ?').run(bad.key, router.id);
    } catch (e) { /* ignore */ }
  }

  logAlert({
    router_id: router.id, nama_server: router.name, nama_desa: router.nama_desa,
    kode_bmkg_adm4: adm4, cuaca: bad.desc, periode: `${bad.jam1}-${bad.jam2}`,
    sent_count: result.sent, failed_count: result.failed, total_target: result.total,
    status: opts.testPhone ? 'test' : 'sent'
  });
  return result;
}


/** Loop semua server aktif & ter-enable. Dipakai scheduler cron tiap 3 jam. */
async function runWeatherScan(opts = {}) {
  if (!opts.force && !isCuacaFeatureEnabled()) {
    logger.info('[CuacaAlert] Fitur dimatikan global (setting cuaca_alert_enabled=0).');
    return { skippedAll: true, results: [] };
  }
  const routers = db.prepare(
    "SELECT * FROM routers WHERE is_active = 1 AND cuaca_alert_enabled = 1 AND kode_bmkg_adm4 IS NOT NULL AND trim(kode_bmkg_adm4) <> ''"
  ).all();
  const results = [];
  for (const r of routers) {
    try { results.push(await sendRouterWeatherAlerts(r, opts)); }
    catch (e) { results.push({ router_id: r.id, server: r.name, reason: e.message }); }
  }
  logger.info(`[CuacaAlert] Scan selesai: ${results.length} server diproses.`);
  return { results };
}

/** Data untuk halaman admin: daftar server + prakiraan + status WA. */
async function getOverview() {
  const routers = db.prepare('SELECT * FROM routers ORDER BY name ASC').all();
  const wa = await getWaStatus();
  const servers = [];
  for (const r of routers) {
    const adm4 = String(r.kode_bmkg_adm4 || '').trim();
    let weather = null;
    let error = null;
    if (adm4) {
      try {
        const f = await fetchForecast(adm4);
        weather = { lokasi: f.lokasi, today: summarizeToday(f.slots), bad: findBadWeather(f.slots) };
      } catch (e) { error = e.message; }
    }
    servers.push(Object.assign({}, r, { hasAdm4: !!adm4, weather, error }));
  }
  return { wa, servers };
}

function getRecentLogs(routerId, limit = 20) {
  try {
    if (routerId) {
      return db.prepare('SELECT * FROM cuaca_alert_logs WHERE router_id = ? ORDER BY id DESC LIMIT ?').all(routerId, Number(limit) || 20);
    }
    return db.prepare('SELECT * FROM cuaca_alert_logs ORDER BY id DESC LIMIT ?').all(Number(limit) || 20);
  } catch (e) { return []; }
}

module.exports = {
  fetchForecast,
  findBadWeather,
  summarizeToday,
  getWaStatus,
  buildMessage,
  getActiveCustomersForRouter,
  sendRouterWeatherAlerts,
  runWeatherScan,
  getOverview,
  getRecentLogs,
  companyName,
  isCuacaFeatureEnabled,
  BAD_CODES,
  BAD_KEYWORDS
};

