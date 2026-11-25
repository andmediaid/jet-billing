/**
 * Service: Monitoring Bandwidth Realtime (per Server / MikroTik)
 *
 * Memakai koneksi MikroTik yang SUDAH ADA (mikrotikService.getConnection),
 * bukan koneksi baru. Aman: jika router offline / error, kembalikan status
 * offline dengan angka 0 (tidak melempar error ke UI).
 */
const mikrotikService = require('./mikrotikService');

function numField(obj, keys) {
  if (!obj) return 0;
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') {
      const n = Number(obj[k]);
      if (Number.isFinite(n)) return n;
    }
  }
  return 0;
}

function strField(obj, keys) {
  if (!obj) return '';
  for (const k of keys) {
    if (obj[k] !== undefined && obj[k] !== null && obj[k] !== '') return String(obj[k]);
  }
  return '';
}

async function invokeMenuCommand(menu, command, args) {
  if (!menu) return null;
  if (typeof menu.call === 'function') {
    try { return await menu.call(command, args); } catch (_) { return null; }
  }
  if (typeof menu.write === 'function') {
    try {
      if (args && args.interface) menu.write('interface=' + args.interface);
      if (args && 'once' in args) menu.write('once=');
      return await menu.read();
    } catch (_) { return null; }
  }
  return null;
}

/** Cari interface WAN (uplink) sebuah router */
async function findWanInterface(client) {
  try {
    const routes = await client.menu('/ip/route').get();
    const def = (Array.isArray(routes) ? routes : []).find((r) => {
      const dst = strField(r, ['dst-address', 'dstAddress']);
      return dst === '0.0.0.0/0' || dst === '0.0.0.0';
    });
    if (def) {
      const gwIface = strField(def, ['gateway-interface', 'gatewayInterface']) ||
        (strField(def, ['gateway']) && !strField(def, ['gateway']).includes('.') ? strField(def, ['gateway']) : '');
      if (gwIface) return gwIface;
    }
  } catch (_) {}
  // Fallback: interface running pertama (non-loopback)
  try {
    const ifaces = await client.menu('/interface').get();
    const running = (Array.isArray(ifaces) ? ifaces : []).find((i) => {
      const running = strField(i, ['running']) === 'true' || i.running === true;
      const name = strField(i, ['name']);
      return running && name && !name.toLowerCase().startsWith('loopback');
    });
    if (running) return strField(running, ['name']);
  } catch (_) {}
  return null;
}

/** Ambil jumlah pelanggan online (PPPoE + Hotspot aktif) */
async function countOnline(client) {
  let online = 0;
  try {
    const ppp = await client.menu('/ppp/active').get();
    online += Array.isArray(ppp) ? ppp.length : 0;
  } catch (_) {}
  try {
    const hs = await client.menu('/ip/hotspot/active').get();
    online += Array.isArray(hs) ? hs.length : 0;
  } catch (_) {}
  return online;
}

/**
 * Sampel bandwidth satu router.
 * @returns {Promise<{routerId, name, online:boolean, rxMbps:number, txMbps:number, onlineCount:number, error?:string}>}
 */
async function sampleRouter(router) {
  const base = {
    routerId: router && router.id != null ? router.id : null,
    name: router && router.name ? router.name : 'Server',
    online: false,
    rxMbps: 0,
    txMbps: 0,
    onlineCount: 0
  };
  let conn = null;
  try {
    conn = await mikrotikService.getConnection(base.routerId);
    if (!conn || !conn.client) throw new Error('Tidak dapat terhubung ke router');

    const iface = await findWanInterface(conn.client);
    if (iface) {
      const ifMenu = conn.client.menu('/interface');
      const mtRaw = await invokeMenuCommand(ifMenu, 'monitor-traffic', { interface: iface, once: '' });
      const mt = Array.isArray(mtRaw) ? mtRaw[0] : mtRaw;
      const rxBps = numField(mt, ['rxBitsPerSecond', 'rx-bits-per-second', 'rx-bits-per-second']);
      const txBps = numField(mt, ['txBitsPerSecond', 'tx-bits-per-second', 'tx-bits-per-second']);
      base.rxMbps = Math.max(0, (Number(rxBps) || 0) / 1e6);
      base.txMbps = Math.max(0, (Number(txBps) || 0) / 1e6);
    }
    base.onlineCount = await countOnline(conn.client);
    base.online = true;
    return base;
  } catch (e) {
    base.online = false;
    base.error = e && e.message ? e.message : String(e);
    return base;
  } finally {
    try { if (conn && typeof conn.close === 'function') conn.close(); } catch (_) {}
  }
}

/** Sampel beberapa router secara paralel (defensif) */
async function sampleRouters(routers) {
  const list = Array.isArray(routers) ? routers : [];
  const results = await Promise.all(list.map((r) => sampleRouter(r).catch(() => ({
    routerId: r && r.id != null ? r.id : null,
    name: r && r.name ? r.name : 'Server',
    online: false, rxMbps: 0, txMbps: 0, onlineCount: 0, error: 'error'
  }))));
  return results;
}

module.exports = { sampleRouter, sampleRouters };
