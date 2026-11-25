'use strict';
/**
 * WireGuard Service
 * - Menghubungkan MikroTik (per server/desa) dengan server billing via tunnel WireGuard.
 * - Berguna juga sebagai tunneling untuk meremot Web UI ONU pelanggan dari jarak jauh
 *   (IP ONU/pelanggan dapat diakses lewat jaringan terowongan 10.66.66.x).
 *
 * Modul ini membuat & mengelola kunci serta menghasilkan konfigurasi siap-tempel
 * (MikroTik RouterOS v7 / file .conf). Membuat antarmuka WireGuard di OS di luar cakupan modul ini.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const db = require('../config/database');
const { logger } = require('../config/logger');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SERVER_CONF = path.join(DATA_DIR, 'wireguard-server.json');

function b64raw(buf) { return Buffer.from(buf).toString('base64'); }

/** Generate keypair WireGuard (Curve25519 / x25519) -> base64 32-byte. */
function genKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const priv = privateKey.export({ type: 'pkcs8', format: 'der' }).slice(-32);
  const pub = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
  return { privateKey: b64raw(priv), publicKey: b64raw(pub) };
}

function readServer() {
  try { return JSON.parse(fs.readFileSync(SERVER_CONF, 'utf8')); } catch (e) { return null; }
}

function ensureServer() {
  let s = readServer();
  if (!s || !s.privateKey || !s.publicKey) {
    const kp = genKeypair();
    s = {
      privateKey: kp.privateKey,
      publicKey: kp.publicKey,
      address: (s && s.address) || '10.66.66.1/24',
      listenPort: (s && s.listenPort) || 51820,
      endpoint: (s && s.endpoint) || '',
      createdAt: new Date().toISOString()
    };
    try {
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(SERVER_CONF, JSON.stringify(s, null, 2));
    } catch (e) { logger.warn('[WireGuard] gagal menyimpan konfigurasi server: ' + e.message); }
  }
  return s;
}

function updateServer(patch = {}) {
  const s = ensureServer();
  if (patch.address !== undefined) s.address = String(patch.address).trim();
  if (patch.listenPort !== undefined) s.listenPort = Number(patch.listenPort) || 51820;
  if (patch.endpoint !== undefined) s.endpoint = String(patch.endpoint).trim();
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(SERVER_CONF, JSON.stringify(s, null, 2));
  } catch (e) { /* ignore */ }
  return s;
}

function regenerateServerKeys() {
  const s = ensureServer();
  const kp = genKeypair();
  s.privateKey = kp.privateKey;
  s.publicKey = kp.publicKey;
  s.regeneratedAt = new Date().toISOString();
  try { fs.writeFileSync(SERVER_CONF, JSON.stringify(s, null, 2)); } catch (e) { /* ignore */ }
  return s;
}

function listPeers() {
  return db.prepare('SELECT * FROM wireguard_peers ORDER BY id DESC').all();
}

function getPeer(id) {
  return db.prepare('SELECT * FROM wireguard_peers WHERE id = ?').get(id);
}

function createPeer(data = {}) {
  const kp = genKeypair();
  const info = db.prepare(`INSERT INTO wireguard_peers
    (router_id, name, public_key, private_key, address, allowed_ips, endpoint, listen_port, persistent_keepalive, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    data.router_id ? Number(data.router_id) : null,
    String(data.name || 'MikroTik').trim(),
    kp.publicKey,
    kp.privateKey,
    String(data.address || '').trim(),
    String(data.allowed_ips || '').trim(),
    String(data.endpoint || '').trim(),
    Number(data.listen_port) || 51820,
    Number(data.persistent_keepalive) || 25,
    String(data.note || '').trim()
  );
  return getPeer(info.lastInsertRowid);
}

function deletePeer(id) {
  return db.prepare('DELETE FROM wireguard_peers WHERE id = ?').run(id);
}

function updatePeer(id, data = {}) {
  const p = getPeer(id);
  if (!p) return null;
  const pick = (v, old) => (v === undefined || v === null) ? old : String(v).trim();
  db.prepare(`UPDATE wireguard_peers SET name=?, address=?, allowed_ips=?, endpoint=?, listen_port=?, persistent_keepalive=?, enabled=?, note=? WHERE id=?`).run(
    pick(data.name, p.name), pick(data.address, p.address), pick(data.allowed_ips, p.allowed_ips),
    pick(data.endpoint, p.endpoint), Number(data.listen_port) || p.listen_port,
    Number(data.persistent_keepalive) || p.persistent_keepalive,
    (data.enabled === undefined ? p.enabled : (data.enabled ? 1 : 0)),
    pick(data.note, p.note), id
  );
  return getPeer(id);
}

/** Konfigurasi siap-tempel untuk MikroTik RouterOS v7. */
function mikrotikScript(peer) {
  const s = ensureServer();
  const endpointHost = hostOf(s.endpoint);
  const serverIp = s.address.split('/')[0];
  return [
    `# === WireGuard tunnel MikroTik -> Billing (${peer.name}) ===`,
    `# Tempel di Terminal MikroTik (RouterOS v7). Ganti endpoint bila perlu.`,
    `/interface/wireguard/add name=wg-billing listen-port=${peer.listen_port || 51820} private-key="${peer.private_key}"`,
    `/interface/wireguard/peers/add interface=wg-billing public-key="${s.publicKey}" `
      + `endpoint-address=${endpointHost} endpoint-port=${s.listenPort} `
      + `allowed-address=${serverIp}/32 persistent-keepalive=${peer.persistent_keepalive || 25}s`,
    `/ip/address/add address=${peer.address || (serverIp.replace(/\.\d+$/, '.2') + '/24')} interface=wg-billing`,
    `# Rute agar billing dapat mengakses subnet pelanggan/ONU di desa ini (remote ONU):`,
    `# /ip/route/add dst-address=10.66.66.0/24 gateway=wg-billing`,
    `# /ip/firewall/filter/add chain=input action=accept protocol=udp dst-port=${peer.listen_port || 51820} comment="WireGuard-Billing"`
  ].join('\n');
}

/** Konfigurasi sisi billing (file .conf) untuk semua peer. */
function billingConf() {
  const s = ensureServer();
  const peers = listPeers().filter((p) => p.enabled);
  const out = [
    '[Interface]',
    `Address = ${s.address}`,
    `ListenPort = ${s.listenPort}`,
    `PrivateKey = ${s.privateKey}`,
    ''
  ];
  peers.forEach((p) => {
    out.push(`# ${p.name}${p.router_id ? ' (router_id ' + p.router_id + ')' : ''}`);
    out.push('[Peer]');
    out.push(`PublicKey = ${p.public_key}`);
    out.push(`AllowedIPs = ${p.allowed_ips || (p.address ? p.address.split('/')[0] + '/32' : '10.66.66.0/24')}`);
    if (p.endpoint) out.push(`Endpoint = ${p.endpoint}`);
    out.push(`PersistentKeepalive = ${p.persistent_keepalive || 25}`);
    out.push('');
  });
  return out.join('\n');
}

function getStatus() {
  const s = ensureServer();
  const peers = listPeers();
  return {
    serverPublicKey: s.publicKey,
    address: s.address,
    listenPort: s.listenPort,
    endpoint: s.endpoint,
    peerCount: peers.length,
    enabledPeers: peers.filter((p) => p.enabled).length,
    confExists: fs.existsSync(SERVER_CONF)
  };
}

module.exports = {
  genKeypair, ensureServer, updateServer, regenerateServerKeys,
  listPeers, getPeer, createPeer, updatePeer, deletePeer,
  mikrotikScript, billingConf, getStatus, hostOf
};

function hostOf(endpoint) {
  return String(endpoint || '').replace(/^https?:\/\//i, '').replace(/:\d+.*$/, '').replace(/\/.*$/, '').trim() || 'GANTI-IP-BILLING';
}
