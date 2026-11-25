/**
 * Service: Manajemen Akses Pengelola Wilayah
 *
 * Super Admin (login via settings admin_username) dapat membuat akun terbatas
 * (Pengelola Wilayah / Teknisi / Kasir) yang:
 *   - terikat ke satu server/wilayah (routers.id)
 *   - hanya menampilkan menu sidebar yang dicentang Admin
 *   - akses khusus per menu (view / create / edit / delete)
 *
 * Semua data disimpan di tabel `admin_users`.
 */
const db = require('../config/database');

const ROLE_LABELS = {
  pengelola: 'Pengelola Wilayah',
  teknisi: 'Teknisi',
  kasir: 'Kasir'
};

const ACTION_LABELS = {
  view: 'Lihat',
  create: 'Tambah',
  edit: 'Ubah',
  delete: 'Hapus'
};

// Katalog menu yang bisa dicentang di halaman Manajemen Akses.
// key harus SAMA dengan key di sidebarMenuService agar sidebar & proteksi sinkron.
const MENU_CATALOG = [
  { key: 'dashboard', label: 'Dashboard', icon: 'bi bi-speedometer2', actions: ['view'] },
  { key: 'customers', label: 'Daftar Pelanggan', icon: 'bi bi-people', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'billing', label: 'Tagihan', icon: 'bi bi-receipt', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'packages', label: 'Paket Internet', icon: 'bi bi-box-seam', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'collector_payments', label: 'Pembayaran / Approval', icon: 'bi bi-check2-square', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'tickets', label: 'Tiket Gangguan', icon: 'bi bi-headset', actions: ['view', 'create', 'edit', 'delete'] },
  { key: 'acs_pro', label: 'Remote ONU / GenieACS', icon: 'bi bi-hdd-network', actions: ['view', 'edit'] },
  { key: 'onu_provision', label: 'ONU Provision', icon: 'bi bi-hdd-network-fill', actions: ['view', 'create', 'edit'] },
  { key: 'cuaca_alert', label: 'Cuaca Alert BMKG', icon: 'bi bi-cloud-lightning-rain', actions: ['view'] },
  { key: 'reports', label: 'Laporan', icon: 'bi bi-bar-chart-line', actions: ['view'] },
  { key: 'settings', label: 'Pengaturan', icon: 'bi bi-gear', actions: ['view', 'edit'] },
  { key: 'mikrotik', label: 'MikroTik / Data Server', icon: 'bi bi-router', actions: ['view', 'edit'] },
  { key: 'onu_stickers', label: 'Stiker ONU', icon: 'bi bi-stickies', actions: ['view', 'create'] },
  { key: 'inventory', label: 'Inventaris', icon: 'bi bi-boxes', actions: ['view', 'create', 'edit', 'delete'] }
];

// Peta path (relatif ke mount '/admin') -> menu key (proteksi URL langsung / backend).
const PATH_TO_MENU = [
  { prefix: '/customers', key: 'customers' },
  { prefix: '/billing', key: 'billing' },
  { prefix: '/packages', key: 'packages' },
  { prefix: '/collector-payments', key: 'collector_payments' },
  { prefix: '/tickets', key: 'tickets' },
  { prefix: '/remote-onu', key: 'acs_pro' },
  { prefix: '/acs', key: 'acs_pro' },
  { prefix: '/onu-provision', key: 'onu_provision' },
  { prefix: '/routers', key: 'mikrotik' },
  { prefix: '/cuaca-alert', key: 'cuaca_alert' },
  { prefix: '/reports', key: 'reports' },
  { prefix: '/settings', key: 'settings' },
  { prefix: '/mikrotik', key: 'mikrotik' },
  { prefix: '/onu-stickers', key: 'onu_stickers' },
  { prefix: '/inventory', key: 'inventory' }
];

function sha256(input) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(String(input || '')).digest('hex');
}

function parsePermissions(raw) {
  try {
    const obj = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {});
    return obj && typeof obj === 'object' ? obj : {};
  } catch (_) {
    return {};
  }
}

function serializePermissions(perm) {
  try {
    return JSON.stringify(perm && typeof perm === 'object' ? perm : {});
  } catch (_) {
    return '{}';
  }
}

/** Ambil semua akun terbatas */
function getAllUsers() {
  const rows = db.prepare('SELECT * FROM admin_users ORDER BY created_at DESC').all();
  return rows.map((r) => ({ ...r, permissions: parsePermissions(r.permissions) }));
}

function getUserById(id) {
  const r = db.prepare('SELECT * FROM admin_users WHERE id = ?').get(id);
  if (!r) return null;
  return { ...r, permissions: parsePermissions(r.permissions) };
}

function getUserByUsername(username) {
  return db.prepare('SELECT * FROM admin_users WHERE username = ?').get(String(username || '').trim()) || null;
}

/** Autentikasi akun terbatas */
function authenticate(username, password) {
  const user = getUserByUsername(username);
  if (!user || Number(user.is_active) !== 1) return null;
  const inputHash = sha256(password);
  if (inputHash === user.password || String(password) === String(user.password)) {
    try {
      db.prepare('UPDATE admin_users SET last_login_at = (NOW_LOCAL()) WHERE id = ?').run(user.id);
    } catch (_) {}
    return { ...user, permissions: parsePermissions(user.permissions) };
  }
  return null;
}

function createUser(data) {
  const name = String(data.name || '').trim();
  const username = String(data.username || '').trim();
  const password = String(data.password || '');
  if (!name) throw new Error('Nama wajib diisi.');
  if (!username) throw new Error('Username wajib diisi.');
  if (password.length < 4) throw new Error('Password minimal 4 karakter.');
  if (getUserByUsername(username)) throw new Error('Username sudah dipakai.');

  const role = ROLE_LABELS[data.role] ? data.role : 'pengelola';
  const routerId = data.router_id != null && data.router_id !== '' ? Number(data.router_id) : null;

  const stmt = db.prepare(`
    INSERT INTO admin_users (name, username, password, role, router_id, permissions, is_active)
    VALUES (?, ?, ?, ?, ?, ?, 1)
  `);
  const res = stmt.run(name, username, sha256(password), role, routerId, serializePermissions(data.permissions));
  return res.lastInsertRowid;
}

function updateUser(id, data) {
  const existing = getUserById(id);
  if (!existing) throw new Error('Akun tidak ditemukan.');
  const name = String(data.name || existing.name).trim();
  const username = String(data.username || existing.username).trim();
  const role = ROLE_LABELS[data.role] ? data.role : existing.role;
  const routerId = data.router_id != null && data.router_id !== '' ? Number(data.router_id) : null;
  const isActive = data.is_active != null ? (data.is_active ? 1 : 0) : existing.is_active;
  const permissions = data.permissions != null ? serializePermissions(data.permissions) : serializePermissions(existing.permissions);

  db.prepare(`
    UPDATE admin_users
    SET name = ?, username = ?, role = ?, router_id = ?, permissions = ?, is_active = ?, updated_at = (NOW_LOCAL())
    WHERE id = ?
  `).run(name, username, role, routerId, permissions, isActive, id);
  return true;
}

function resetPassword(id, newPassword) {
  if (String(newPassword || '').length < 4) throw new Error('Password minimal 4 karakter.');
  db.prepare('UPDATE admin_users SET password = ?, updated_at = (NOW_LOCAL()) WHERE id = ?').run(sha256(newPassword), id);
  return true;
}

function setActive(id, active) {
  db.prepare('UPDATE admin_users SET is_active = ?, updated_at = (NOW_LOCAL()) WHERE id = ?').run(active ? 1 : 0, id);
  return true;
}

function deleteUser(id) {
  db.prepare('DELETE FROM admin_users WHERE id = ?').run(id);
  return true;
}

/** Cek apakah session punya akses ke sebuah menu (super admin selalu true) */
function sessionHasMenu(session, menuKey) {
  if (!session) return false;
  if (session.isAdmin) return true; // Super Admin
  if (!session.isStaff) return false;
  if (menuKey === 'dashboard') return true; // Dashboard selalu boleh (halaman utama, hindari redirect loop)
  const perms = session.adminPermissions || {};
  return Object.prototype.hasOwnProperty.call(perms, menuKey);
}

/** Cek aksi tertentu pada menu (view/create/edit/delete) */
function sessionHasAction(session, menuKey, action) {
  if (!session) return false;
  if (session.isAdmin) return true;
  if (!session.isStaff) return false;
  const perms = session.adminPermissions || {};
  const list = Array.isArray(perms[menuKey]) ? perms[menuKey] : [];
  return list.indexOf(action) !== -1;
}

/** Router/wilayah yang boleh diakses session. Super admin = null (semua). */
function getScopedRouterId(session) {
  if (!session) return null;
  if (session.isAdmin) return null; // semua wilayah
  if (session.isStaff && session.adminRouterId != null) return Number(session.adminRouterId);
  return null;
}

/** Tentukan menu key dari path URL (router admin di-mount pada '/admin'). */
function resolveMenuKeyFromPath(pathname) {
  let p = String(pathname || '');
  // Normalisasi: buang prefix '/admin' bila ada (req.path di dalam router sudah relatif)
  if (p === '/admin') p = '/';
  else if (p.startsWith('/admin/')) p = p.slice('/admin'.length);
  if (p === '' || p === '/' || p === '/?') return 'dashboard';
  // Buang query string
  const qIdx = p.indexOf('?');
  if (qIdx !== -1) p = p.slice(0, qIdx);
  for (const entry of PATH_TO_MENU) {
    if (p === entry.prefix || p.startsWith(entry.prefix + '/')) {
      return entry.key;
    }
  }
  return null;
}

/**
 * Middleware: menolak (403) bila akun terbatas membuka menu yang tidak diizinkan.
 * Super Admin & halaman non-menu dilewatkan.
 */
function requireMenuAccess() {
  return (req, res, next) => {
    if (!req.session) return next();
    if (req.session.isAdmin) return next(); // Super Admin bebas
    if (!req.session.isStaff) return next(); // cashier lama / belum login -> biarkan gate lain
    const menuKey = resolveMenuKeyFromPath(req.path);
    if (!menuKey) return next(); // bukan rute menu yang diproteksi
    if (sessionHasMenu(req.session, menuKey)) return next();

    if (req.path.startsWith('/admin/api') || req.xhr || (req.get('accept') || '').includes('application/json')) {
      return res.status(403).json({ ok: false, error: 'Akses ditolak. Menu ini tidak diizinkan untuk akun Anda.' });
    }
    req.session._msg = { type: 'error', text: 'Akses ditolak. Anda tidak memiliki izin membuka menu tersebut.' };
    return res.status(403).redirect('/admin');
  };
}

/** Middleware: kunci wilayah untuk akun terbatas (tidak bisa pindah server) */
function enforceWilayahScope() {
  return (req, res, next) => {
    if (!req.session || !req.session.isStaff || req.session.isAdmin) return next();
    const scoped = getScopedRouterId(req.session);
    if (scoped != null) {
      req.session.selected_router_id = scoped; // paksa ke wilayahnya sendiri
      req.selectedRouterId = scoped;
    }
    next();
  };
}

module.exports = {
  ROLE_LABELS,
  ACTION_LABELS,
  MENU_CATALOG,
  getAllUsers,
  getUserById,
  getUserByUsername,
  authenticate,
  createUser,
  updateUser,
  resetPassword,
  setActive,
  deleteUser,
  sessionHasMenu,
  sessionHasAction,
  getScopedRouterId,
  resolveMenuKeyFromPath,
  requireMenuAccess,
  enforceWilayahScope,
  sha256
};
