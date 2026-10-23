/* Hochsitze · Jagdgemeinschaft Thuine
 * Eigenständige Test-App, später Teil von „Jagd Thuine“.
 * Daten: data/hochsitze.json im GitHub-Repo (mit dem Passwort der Jagdgemeinschaft verschlüsselt, AES-GCM).
 * Fotos: data/fotos/*.bin (verschlüsselt, Format „SBE1“ wie die Dokumente in Jagd Thuine).
 * Lesen: öffentlich (GitHub-API bzw. Pages-Datei). Schreiben: nur mit GitHub-Token (Einstellungen).
 * Änderungen ohne Netz landen in einer Warteschlange (IndexedDB) und werden später hochgeladen.
 */
'use strict';

const APP_VERSION = '1.0.0';
const LS_CFG = 'hs.cfg.v1';
const LS_DATA = 'hs.data.v1';
const LS_PW = 'hs.pw.v1';
const LS_VIEW = 'hs.view.v1';
const LS_SALT = 'hs.salt.v1';
const DATA_PATH = 'data/hochsitze.json';
const FOTO_DIR = 'data/fotos';
const THUINE = [52.5028, 7.4836];
const NEAR_M = 30; // so nah dran → „Diesen Sitz umstellen?“

const ARTEN = {
  kanzel: { name: 'Kanzel (geschlossen)', short: 'Kanzel', color: '#1f4a24', icon: '<path d="M4 10 12 4.5l8 5.5v4H4Z"/><path d="M6.5 14v7M17.5 14v7M6.5 18h11"/>' },
  leiter: { name: 'Leiter / offener Sitz', short: 'Leiter', color: '#7a5a1e', icon: '<path d="M7.5 21 10 4M16.5 21 14 4M8.6 15h6.8M9.4 10h5.2M7 4h10"/>' },
  drueckjagd: { name: 'Drückjagdbock', short: 'Drückjagdbock', color: '#9a4b1c', icon: '<path d="M5 8h14v4H5ZM7.5 12 5.5 21M16.5 12l2 9M7 17h10"/>' },
  erdsitz: { name: 'Erdsitz / Bodensitz', short: 'Erdsitz', color: '#4d6a2a', icon: '<path d="M3 20h18M5 20v-7l7-4.5 7 4.5v7M9.5 14.5h5"/>' },
  sonst: { name: 'Sonstiges', short: 'Sonstiges', color: '#555b66', icon: '<circle cx="12" cy="12" r="4.5"/>' },
};
const ZUSTAND = { gut: 'In Ordnung', maengel: 'Mängel', gesperrt: 'Gesperrt' };
const DIRS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];
const LAYERS = {
  luftbild: { name: 'Luftbild', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opt: { maxNativeZoom: 19, maxZoom: 20, crossOrigin: 'anonymous', attribution: 'Luftbild © Esri, Maxar, Earthstar Geographics' } },
  karte: { name: 'Topografische Karte', url: 'https://sgx.geodatenzentrum.de/wmts_topplus_open/tile/1.0.0/web/default/WEBMERCATOR/{z}/{y}/{x}.png', opt: { maxNativeZoom: 18, maxZoom: 20, attribution: '© BKG (TopPlusOpen)' } },
  osm: { name: 'OpenStreetMap', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opt: { maxNativeZoom: 19, maxZoom: 20, crossOrigin: 'anonymous', attribution: '© OpenStreetMap-Mitwirkende' } },
};

/* ================= Hilfsfunktionen ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function lsGet(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; } }
function lsSet(key, val) { try { val === undefined ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(val)); } catch { /* egal */ } }
function todayISO() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function dateDE(iso) {
  if (!iso) return '–';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}
const dtDE = iso => iso ? new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' }) : '–';
function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), ms);
}
function distM(a, b) {
  const R = 6371000, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const distTxt = m => m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0).replace('.', ',')} km`;
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b.lng - a.lng) * r) * Math.cos(b.lat * r);
  const x = Math.cos(a.lat * r) * Math.sin(b.lat * r) - Math.sin(a.lat * r) * Math.cos(b.lat * r) * Math.cos((b.lng - a.lng) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const dirName = deg => DIRS[Math.round(((deg % 360) + 360) % 360 / 45) % 8];
const dirTxt = deg => deg == null ? 'nicht angegeben' : `${Math.round(deg)}° ${dirName(deg)}`;
const coordTxt = s => `${s.lat.toFixed(6)}, ${s.lng.toFixed(6)}`;
const artOf = s => ARTEN[s.art] || ARTEN.sonst;
const artIcon = (art, cls = '') => `<svg viewBox="0 0 24 24" class="${cls}" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${(ARTEN[art] || ARTEN.sonst).icon}</svg>`;

/* ================= Verschlüsselung (identisch zu Jagd Thuine) ================= */
class NeedPassword extends Error {}
const bytesToB64 = bytes => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const b64ToBytes = b64 => Uint8Array.from(atob(b64.replace(/\s/g, '')), c => c.charCodeAt(0));
const b64encodeUtf8 = str => bytesToB64(new TextEncoder().encode(str));
const keyCache = new Map();
async function deriveKey(pw, salt, iter = 150000) {
  const id = pw + '|' + iter + '|' + bytesToB64(salt);
  if (keyCache.has(id)) return keyCache.get(id);
  const p = (async () => {
    const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  })();
  keyCache.set(id, p);
  p.catch(() => keyCache.delete(id));
  return p;
}
async function encryptJSON(obj, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 150000;
  const key = await deriveKey(pw, salt, iter);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  return { enc: 'aes-gcm-v1', hinweis: 'Verschlüsselte Daten', iter, salt: bytesToB64(salt), iv: bytesToB64(iv), data: bytesToB64(ct) };
}
async function decryptJSON(env, pw) {
  const key = await deriveKey(pw, b64ToBytes(env.salt), env.iter || 150000);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64ToBytes(env.iv) }, key, b64ToBytes(env.data));
  return JSON.parse(new TextDecoder().decode(pt));
}
const MAGIC = [83, 66, 69, 49]; // "SBE1"
/** Fotos: ein fester Salt pro Gerät → der Schlüssel wird nur einmal abgeleitet (schnell bei vielen Bildern) */
function fotoSalt() {
  let s = lsGet(LS_SALT, '');
  if (!s) { s = bytesToB64(crypto.getRandomValues(new Uint8Array(16))); lsSet(LS_SALT, s); }
  return b64ToBytes(s);
}
async function encryptBytes(bytes, pw) {
  const salt = fotoSalt(), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(pw, salt);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  const out = new Uint8Array(32 + ct.length);
  out.set(MAGIC, 0); out.set(salt, 4); out.set(iv, 20); out.set(ct, 32);
  return out;
}
const isEnc = b => b.length > 32 && MAGIC.every((v, i) => b[i] === v);
async function decryptBytes(b, pws = [state.pw]) {
  if (!isEnc(b)) return b;
  for (const pw of pws.filter(Boolean)) {
    try { const key = await deriveKey(pw, b.slice(4, 20)); return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b.slice(20, 32) }, key, b.slice(32))); } catch { /* nächstes */ }
  }
  throw new Error('Foto lässt sich nicht entschlüsseln (Passwort geändert?).');
}

/* ================= Kleiner Speicher auf dem Gerät (IndexedDB) ================= */
let dbP = null;
function db() {
  if (!dbP) dbP = new Promise((res, rej) => {
    const r = indexedDB.open('hochsitze', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbP;
}
async function idb(mode, fn) {
  try {
    const d = await db();
    return await new Promise((res, rej) => {
      const tx = d.transaction('kv', mode), st = tx.objectStore('kv');
      const req = fn(st);
      tx.oncomplete = () => res(req?.result);
      tx.onerror = () => rej(tx.error);
    });
  } catch { return undefined; }
}
const idbGet = k => idb('readonly', st => st.get(k));
const idbSet = (k, v) => idb('readwrite', st => st.put(v, k));
const idbDel = k => idb('readwrite', st => st.delete(k));
const idbKeys = () => idb('readonly', st => st.getAllKeys());

/* ================= Zustand ================= */
function defaultCfg() {
  let owner = '', repo = '';
  if (location.hostname.endsWith('.github.io')) {
    owner = location.hostname.split('.')[0];
    repo = location.pathname.split('/').filter(Boolean)[0] || `${owner}.github.io`;
  }
  return { owner, repo, branch: 'main', token: '', mode: '' };
}
const state = {
  cfg: Object.assign(defaultCfg(), lsGet(LS_CFG, {})),
  pw: lsGet(LS_PW, ''),
  remote: null,          // Stand auf GitHub (entschlüsselt)
  remoteEnc: false,      // liegt die Datei verschlüsselt vor?
  remoteExists: false,
  data: { version: 1, sitze: [] }, // remote + eigene, noch nicht hochgeladene Änderungen
  queue: [],
  view: Object.assign({ layer: 'luftbild', hist: false, tab: 'karte', sort: 'name' }, lsGet(LS_VIEW, {})),
  me: null,              // {lat, lng, acc}
  loaded: false,
};
if (state.cfg.mode !== 'voll' && location.hostname.endsWith('.github.io')) {
  const d = defaultCfg(); Object.assign(state.cfg, { owner: d.owner, repo: d.repo });
}
const isAdmin = () => !!(state.cfg.mode === 'voll' && state.cfg.token && state.cfg.owner && state.cfg.repo);
const saveCfg = () => lsSet(LS_CFG, state.cfg);
const saveView = () => lsSet(LS_VIEW, state.view);
const sitzById = id => state.data.sitze.find(s => s.id === id);
const pendingIds = () => new Set(state.queue.map(o => o.sitzId));

function normalize(d) {
  d = d && typeof d === 'object' ? d : {};
  d.version ||= 1;
  d.sitze = Array.isArray(d.sitze) ? d.sitze : [];
  d.sitze.forEach(s => { s.verlauf ||= []; s.zustand ||= 'gut'; s.art ||= 'sonst'; s.bemerkung ||= ''; if (s.richtung === undefined) s.richtung = null; });
  return d;
}
function applyOps(data, ops) {
  const d = normalize(clone(data || {}));
  for (const op of ops) {
    const i = d.sitze.findIndex(s => s.id === op.sitzId);
    if (op.t === 'put') { if (i >= 0) d.sitze[i] = clone(op.sitz); else d.sitze.push(clone(op.sitz)); }
    if (op.t === 'del' && i >= 0) d.sitze.splice(i, 1);
  }
  d.sitze.sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  return d;
}
function rebuild() {
  state.data = applyOps(state.remote || {}, state.queue);
  lsSet(LS_DATA, state.remote ? { enc: state.remoteEnc, data: state.remote } : undefined);
}

/* ================= GitHub ================= */
function ghHeaders(auth, raw = false) {
  const h = { Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' };
  if (auth && state.cfg.token) h.Authorization = `Bearer ${state.cfg.token}`;
  return h;
}
function ghUrl(path, ref = true) {
  const { owner, repo, branch } = state.cfg;
  return `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}` + (ref ? `?ref=${encodeURIComponent(branch || 'main')}` : '');
}
/** Liest die Datendatei. Ergebnis: {raw} (null = Datei gibt es noch nicht) – wirft bei Netzfehler. */
async function fetchRemoteRaw() {
  const { owner, repo } = state.cfg;
  if (owner && repo) {
    try {
      const r = await fetch(ghUrl(DATA_PATH) + `&t=${Date.now()}`, { headers: ghHeaders(true, true), cache: 'no-store' });
      if (r.ok) return { raw: JSON.parse(await r.text()) };
      if (r.status === 404) return { raw: null };
      if (r.status === 401) toast('GitHub-Token ungültig – bitte in den Einstellungen prüfen.', 5000);
    } catch { /* weiter mit Pages */ }
  }
  const r = await fetch(`${DATA_PATH}?t=${Date.now()}`, { cache: 'no-store' });
  if (r.status === 404) return { raw: null };
  if (!r.ok) throw new Error('Daten nicht erreichbar');
  return { raw: await r.json() };
}
async function openRaw(raw) {
  if (!raw) return { data: { version: 1, sitze: [] }, enc: false };
  if (!raw.enc) return { data: raw, enc: false };
  if (!state.pw) throw new NeedPassword('fehlt');
  try { return { data: await decryptJSON(raw, state.pw), enc: true }; } catch { throw new NeedPassword('falsch'); }
}
async function getSha(path) {
  const r = await fetch(ghUrl(path) + `&t=${Date.now()}`, { headers: ghHeaders(true), cache: 'no-store' });
  if (r.ok) return (await r.json()).sha;
  if (r.status === 404) return undefined;
  if (r.status === 401 || r.status === 403) throw new Error('Keine Rechte – Token prüfen');
  throw new Error(`GitHub ${r.status}`);
}
async function putFile(path, b64, message, sha) {
  const body = { message, content: b64, branch: state.cfg.branch || 'main' };
  if (sha) body.sha = sha;
  const r = await fetch(ghUrl(path, false), { method: 'PUT', headers: { ...ghHeaders(true), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r;
}
async function deleteFile(path, message) {
  try {
    const sha = await getSha(path); if (!sha) return;
    await fetch(ghUrl(path, false), { method: 'DELETE', headers: { ...ghHeaders(true), 'Content-Type': 'application/json' }, body: JSON.stringify({ message, sha, branch: state.cfg.branch || 'main' }) });
  } catch { /* egal – die Datei ist ohnehin nicht mehr verlinkt */ }
}

/* ================= Laden ================= */
async function load({ quiet = false } = {}) {
  const btn = $('#refreshBtn'); btn.classList.add('spin');
  try {
    const { raw } = await fetchRemoteRaw();
    state.remoteExists = !!raw;
    const { data, enc } = await openRaw(raw);
    state.remote = normalize(data); state.remoteEnc = enc;
    $('#lock').hidden = true;
    rebuild(); state.loaded = true; render();
    if (state.queue.length && isAdmin()) flush();
  } catch (e) {
    if (e instanceof NeedPassword) { showLock(e.message); return; }
    if (!quiet) toast(state.loaded ? 'Offline – zeige zuletzt geladenen Stand.' : 'Keine Verbindung – zeige gespeicherten Stand.', 3500);
  } finally { btn.classList.remove('spin'); }
}
async function loadCached() {
  state.queue = (await idbGet('queue')) || [];
  const c = lsGet(LS_DATA, null);
  if (c && c.data && (!c.enc || state.pw)) { state.remote = normalize(c.data); state.remoteEnc = c.enc; }
  rebuild(); render();
}

/* ================= Speichern (Warteschlange) ================= */
const saveQueue = () => idbSet('queue', state.queue);
async function enqueue(op) {
  op.id = uid(); op.zeit = new Date().toISOString(); op.files ||= []; op.done = [];
  state.queue.push(op);
  await saveQueue();
  rebuild(); render();
  flush();
}
let flushing = false;
async function flush() {
  if (flushing || !state.queue.length) { updateBanner(); return; }
  if (!isAdmin()) { updateBanner(); return; }
  if (!state.pw) { updateBanner(); return; }
  flushing = true; updateBanner('Speichere …');
  const batch = [...state.queue];
  try {
    // 1) Fotos hochladen
    let n = 0; const total = batch.reduce((a, o) => a + o.files.length - o.done.length, 0);
    for (const op of batch) {
      for (const p of op.files) {
        if (op.done.includes(p)) continue;
        const bin = await idbGet('bin:' + p);
        if (bin) {
          updateBanner(`Lade Fotos hoch … ${++n}/${total}`);
          const r = await putFile(p, bytesToB64(bin), `Foto ${op.sitzName || ''}`.trim());
          if (!r.ok && r.status !== 422) throw new Error(r.status === 401 || r.status === 403 ? 'Keine Schreibrechte (Token prüfen)' : `Foto-Upload fehlgeschlagen (GitHub ${r.status})`);
        }
        op.done.push(p); await saveQueue();
      }
    }
    // 2) Daten: neuesten Stand holen, eigene Änderungen anwenden, speichern
    updateBanner('Speichere …');
    let ok = false, fresh;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      const { raw } = await fetchRemoteRaw();
      const opened = await openRaw(raw);
      fresh = applyOps(opened.data, batch);
      fresh.stand = new Date().toISOString();
      const sha = await getSha(DATA_PATH);
      const body = JSON.stringify(await encryptJSON(fresh, state.pw), null, 1) + '\n';
      const msg = batch.length === 1 ? batch[0].msg : `${batch.length} Änderungen an Hochsitzen`;
      const r = await putFile(DATA_PATH, b64encodeUtf8(body), msg, sha);
      if (r.ok) ok = true;
      else if (r.status === 409 || r.status === 422) continue;
      else throw new Error(r.status === 401 || r.status === 403 ? 'Keine Schreibrechte (Token prüfen)' : `GitHub ${r.status}`);
    }
    if (!ok) throw new Error('Konflikt beim Speichern');
    // 3) Aufräumen
    const ids = new Set(batch.map(o => o.id));
    state.queue = state.queue.filter(o => !ids.has(o.id));
    await saveQueue();
    state.remote = normalize(fresh); state.remoteEnc = true; state.remoteExists = true;
    rebuild(); render();
    toast('Gespeichert ✓ – für alle sichtbar.');
    for (const op of batch) for (const p of op.delFiles || []) deleteFile(p, 'Foto entfernt');
  } catch (e) {
    if (e instanceof NeedPassword) { updateBanner(null, 'Passwort passt nicht zur Datei auf GitHub – bitte in den Einstellungen prüfen.'); return; }
    updateBanner(null, navigator.onLine === false ? 'Kein Netz' : e.message);
    return;
  } finally { flushing = false; }
  updateBanner();
  if (state.queue.length) flush();
}
function updateBanner(busy, err) {
  const b = $('#banner');
  const n = state.queue.length;
  if (busy) { b.className = 'banner'; b.innerHTML = `<span>⏳ ${esc(busy)}</span>`; b.hidden = false; return; }
  if (!n) { b.hidden = true; return; }
  const why = !isAdmin() ? 'Kein Schreibzugang auf diesem Gerät' : !state.pw ? 'Passwort fehlt' : err || 'Wartet auf Netz';
  b.className = 'banner' + (err ? ' err' : '');
  b.innerHTML = `<span>📤 ${n} ${n === 1 ? 'Änderung' : 'Änderungen'} noch nicht hochgeladen · ${esc(why)}</span><button class="btn small" id="retryBtn">Jetzt senden</button>`;
  b.hidden = false;
  $('#retryBtn').onclick = () => { if (!state.pw && isAdmin()) openPwSheet(); else flush(); };
}

/* ================= Fotos ================= */
const imgUrlCache = new Map();
/** Verschlüsselte Bytes eines Fotos: Gerät → GitHub Pages → API (Admin, sofort aktuell) → raw */
async function fetchBin(path) {
  const cached = await idbGet('bin:' + path);
  if (cached) return cached;
  const { owner, repo, branch } = state.cfg;
  const tries = [() => fetch(path, { cache: 'force-cache' })];
  if (isAdmin()) tries.push(() => fetch(ghUrl(path) + `&t=${Date.now()}`, { headers: ghHeaders(true, true), cache: 'no-store' }));
  if (owner && repo) tries.push(() => fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch || 'main'}/${path}`));
  for (const t of tries) {
    try {
      const r = await t();
      if (r.ok) { const b = new Uint8Array(await r.arrayBuffer()); if (b.length) { idbSet('bin:' + path, b); return b; } }
    } catch { /* nächster Weg */ }
  }
  throw new Error('Foto nicht erreichbar');
}
async function imgUrl(path) {
  if (!path) return '';
  if (imgUrlCache.has(path)) return imgUrlCache.get(path);
  const p = (async () => URL.createObjectURL(new Blob([await decryptBytes(await fetchBin(path))], { type: 'image/jpeg' })))();
  imgUrlCache.set(path, p);
  p.catch(() => imgUrlCache.delete(path));
  return p;
}
/** Bilder mit data-img="pfad" nachladen */
function hydrateImages(root = document) {
  $$('[data-img]', root).forEach(async el => {
    const p = el.dataset.img; el.removeAttribute('data-img');
    try {
      const u = await imgUrl(p);
      if (el.tagName === 'IMG') el.src = u; else el.style.backgroundImage = `url("${u}")`;
    } catch { el.classList.add('img-fail'); }
  });
}
function loadImage(file) {
  return new Promise((res, rej) => {
    const u = URL.createObjectURL(file), img = new Image();
    img.onload = () => res({ img, done: () => URL.revokeObjectURL(u) });
    img.onerror = () => { URL.revokeObjectURL(u); rej(new Error('Bild konnte nicht gelesen werden')); };
    img.src = u;
  });
}
function toJpeg(img, w, h, q = 0.82) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const ctx = c.getContext('2d'); ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise((res, rej) => c.toBlob(b => {
    c.width = c.height = 0;
    b ? b.arrayBuffer().then(a => res(new Uint8Array(a))) : rej(new Error('Bild zu groß für dieses Gerät'));
  }, 'image/jpeg', q));
}
/** Foto verkleinern: normal 1600 px lange Seite, Panorama 1200 px hoch (max. 9000 px breit) + Vorschaubild */
async function prepPhoto(file, kind) {
  const { img, done } = await loadImage(file);
  try {
    const W = img.naturalWidth, H = img.naturalHeight;
    let s;
    if (kind === 'pano') s = Math.min(1, 1200 / H, 9000 / W);
    else s = Math.min(1, 1600 / Math.max(W, H));
    const w = Math.round(W * s), h = Math.round(H * s);
    const full = await toJpeg(img, w, h, 0.82);
    const ts = kind === 'pano' ? 180 / H : 260 / Math.max(W, H);
    const thumb = await toJpeg(img, Math.max(1, Math.round(W * Math.min(1, ts))), Math.max(1, Math.round(H * Math.min(1, ts))), 0.75);
    return { full, thumb, w, h };
  } finally { done(); }
}

/* ================= Karte ================= */
let map, baseLayer, sitzLayer, histLayer, meMarker, meCircle;
function initMap() {
  map = L.map('map', { zoomControl: false, attributionControl: true, center: THUINE, zoom: 14, tap: true });
  L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
  map.attributionControl.setPrefix(false);
  setLayer(state.view.layer, true);
  sitzLayer = L.layerGroup().addTo(map);
  histLayer = L.layerGroup();
  if (state.view.hist) histLayer.addTo(map);
  $('#histBtn').classList.toggle('on', state.view.hist);
  map.on('zoomend', labelZoom); labelZoom();
  $('#layerBtn').onclick = () => {
    const keys = Object.keys(LAYERS);
    setLayer(keys[(keys.indexOf(state.view.layer) + 1) % keys.length]);
  };
  $('#histBtn').onclick = () => toggleHist();
  $('#fitBtn').onclick = () => fitAll(true);
  $('#locBtn').onclick = () => locate();
  $('#addBtn').onclick = () => openCapture('neu');
}
function makeTiles(key) { const l = LAYERS[key] || LAYERS.luftbild; return L.tileLayer(l.url, l.opt); }
function setLayer(key, silent) {
  if (!LAYERS[key]) key = 'luftbild';
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = makeTiles(key).addTo(map);
  state.view.layer = key; saveView();
  if (!silent) {
    const n = $('#layerName'); n.textContent = LAYERS[key].name; n.hidden = false;
    clearTimeout(setLayer._t); setLayer._t = setTimeout(() => (n.hidden = true), 1400);
  }
}
function labelZoom() { $('#map').classList.toggle('z-lo', map.getZoom() < 15); }
function toggleHist(on = !state.view.hist) {
  state.view.hist = on; saveView();
  $('#histBtn').classList.toggle('on', on);
  if (on) histLayer.addTo(map); else map.removeLayer(histLayer);
  toast(on ? 'Alte Standorte werden angezeigt' : 'Alte Standorte ausgeblendet', 1600);
}
function coneSvg(deg) {
  if (deg == null) return '';
  return `<svg class="hs-cone" viewBox="0 0 46 46" style="transform:rotate(${Math.round(deg)}deg)" aria-hidden="true"><path d="M23 23 L12 3.95 A22 22 0 0 1 34 3.95 Z" fill="rgba(255,214,90,.55)" stroke="rgba(120,90,10,.8)" stroke-width="1"/></svg>`;
}
function sitzIcon(s, pending) {
  const a = artOf(s);
  const ring = s.zustand === 'gesperrt' ? '#c0281a' : s.zustand === 'maengel' ? '#e0a000' : '#fff';
  return L.divIcon({
    className: 'hs-ico', iconSize: [46, 46], iconAnchor: [23, 23], tooltipAnchor: [0, 16],
    html: `<div class="hs-wrap">${coneSvg(s.richtung)}<div class="hs-pin${pending ? ' pending' : ''}" style="background:${a.color};border-color:${ring}">${artIcon(s.art)}</div></div>`,
  });
}
function renderMap() {
  if (!map) return;
  sitzLayer.clearLayers(); histLayer.clearLayers();
  const pend = pendingIds();
  for (const s of state.data.sitze) {
    const m = L.marker([s.lat, s.lng], { icon: sitzIcon(s, pend.has(s.id)), keyboard: true, title: s.name, riseOnHover: true });
    m.bindTooltip(esc(s.name), { permanent: true, direction: 'bottom', className: 'hs-label', offset: [0, 4] });
    m.on('click', () => openDetail(s.id));
    sitzLayer.addLayer(m);
    let prev = [s.lat, s.lng];
    for (const v of s.verlauf) {
      const p = [v.lat, v.lng];
      histLayer.addLayer(L.polyline([prev, p], { color: '#333', weight: 2, dashArray: '5 6', opacity: .75, interactive: false }));
      const om = L.marker(p, { icon: L.divIcon({ className: 'hs-old', iconSize: [12, 12], iconAnchor: [6, 6], html: '<i></i>' }) });
      om.bindTooltip(`${esc(s.name)}<br><small>bis ${dateDE(v.bis)}</small>`, { direction: 'top' });
      om.on('click', () => openDetail(s.id));
      histLayer.addLayer(om);
      prev = p;
    }
  }
}
function fitAll(animate) {
  const pts = state.data.sitze.map(s => [s.lat, s.lng]);
  if (state.me) pts.push([state.me.lat, state.me.lng]);
  if (!pts.length) { map.setView(THUINE, 14, { animate }); return; }
  if (pts.length === 1) { map.setView(pts[0], 17, { animate }); return; }
  map.fitBounds(L.latLngBounds(pts).pad(0.12), { animate, maxZoom: 17 });
}
function focusSitz(s) {
  switchTab('karte');
  setTimeout(() => { map.invalidateSize(); map.setView([s.lat, s.lng], Math.max(map.getZoom(), 17)); }, 60);
}

/* ---------- Eigener Standort ---------- */
let meWatch = null, meCentered = false;
function locate() {
  if (!navigator.geolocation) { toast('Dieses Gerät liefert keinen Standort.'); return; }
  if (meWatch != null && state.me) {
    // läuft schon → nochmal tippen = zentrieren, Doppeltipp auf aktiven Knopf = aus
    if (map.getCenter().distanceTo([state.me.lat, state.me.lng]) < 5) { stopLocate(); return; }
    map.setView([state.me.lat, state.me.lng], Math.max(map.getZoom(), 16)); return;
  }
  meCentered = false;
  $('#locBtn').classList.add('follow');
  meWatch = navigator.geolocation.watchPosition(p => {
    state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
    const ll = [state.me.lat, state.me.lng];
    if (!meMarker) {
      meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me-dot', iconSize: [24, 24], iconAnchor: [12, 12], html: '<i></i>' }), interactive: false, keyboard: false, zIndexOffset: 1000 }).addTo(map);
      meCircle = L.circle(ll, { radius: state.me.acc, color: '#1c6fe0', weight: 1, fillOpacity: .12, interactive: false }).addTo(map);
    } else { meMarker.setLatLng(ll); meCircle.setLatLng(ll).setRadius(state.me.acc); }
    if (!meCentered) { meCentered = true; map.setView(ll, Math.max(map.getZoom(), 16)); }
    if (state.view.tab === 'liste') renderListDistances();
  }, err => {
    stopLocate();
    toast(err.code === 1 ? 'Standort nicht erlaubt – bitte in den Einstellungen des Handys freigeben.' : 'Standort nicht verfügbar.', 4500);
  }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
}
function stopLocate() {
  if (meWatch != null) navigator.geolocation.clearWatch(meWatch);
  meWatch = null; $('#locBtn').classList.remove('follow');
  if (meMarker) { map.removeLayer(meMarker); map.removeLayer(meCircle); meMarker = meCircle = null; }
  state.me = null;
}

/* ================= Ansichten ================= */
function render() {
  $('#addBtn').hidden = !isAdmin();
  renderMap();
  if (state.view.tab === 'liste') renderList();
  updateBanner();
  if (!render._fitted && state.loaded) { render._fitted = true; fitAll(false); }
}
function switchTab(tab, fromPop) {
  state.view.tab = tab; saveView();
  $$('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $('#view-karte').hidden = tab !== 'karte';
  $('#view-liste').hidden = tab !== 'liste';
  if (tab === 'liste') renderList();
  else setTimeout(() => map.invalidateSize(), 30);
  if (!fromPop && tab !== 'karte') history.pushState({ hs: 'tab' }, '');
}
function renderList() {
  const el = $('#view-liste');
  const sitze = state.data.sitze;
  const pend = pendingIds();
  const q = (state.listQ || '').trim().toLowerCase();
  let rows = sitze.filter(s => !q || s.name.toLowerCase().includes(q) || artOf(s).name.toLowerCase().includes(q) || (s.bemerkung || '').toLowerCase().includes(q));
  const sort = state.view.sort;
  if (sort === 'dist' && state.me) rows = rows.slice().sort((a, b) => distM(state.me, a) - distM(state.me, b));
  else if (sort === 'art') rows = rows.slice().sort((a, b) => artOf(a).short.localeCompare(artOf(b).short) || a.name.localeCompare(b.name, 'de', { numeric: true }));
  const counts = {};
  sitze.forEach(s => { counts[s.art] = (counts[s.art] || 0) + 1; });
  const mangel = sitze.filter(s => s.zustand !== 'gut').length;
  el.innerHTML = `
    <div class="card pad">
      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:10px">
        <div><div style="font:600 30px/1 var(--serif);color:var(--green)">${sitze.length}</div><div class="sub">${sitze.length === 1 ? 'Hochsitz' : 'Hochsitze'} im Revier</div></div>
        ${mangel ? `<span class="badge maengel">${mangel} mit Mängeln/gesperrt</span>` : ''}
      </div>
      <div class="legend" style="margin-top:10px">${Object.entries(ARTEN).filter(([k]) => counts[k]).map(([k, a]) => `<span><i style="background:${a.color}"></i>${esc(a.short)} ${counts[k]}</span>`).join('')}</div>
    </div>
    ${sitze.length ? `<div class="list-tools">
      <input type="search" id="listQ" placeholder="Suchen …" value="${esc(state.listQ || '')}" aria-label="Suchen">
      <select id="listSort" aria-label="Sortierung">
        <option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option>
        <option value="dist" ${sort === 'dist' ? 'selected' : ''}>Entfernung</option>
        <option value="art" ${sort === 'art' ? 'selected' : ''}>Art</option>
      </select>
    </div>` : ''}
    <div id="sitzList">
      ${rows.map(s => `<button class="sitz" data-id="${esc(s.id)}">
        <div class="th" ${s.foto ? `data-img="${esc(s.foto.t)}"` : `style="background:${artOf(s).color}"`}>${s.foto ? '' : artIcon(s.art)}</div>
        <div style="min-width:0"><div class="nm">${esc(s.name)}</div>
          <div class="mt">${esc(artOf(s).short)}${s.richtung != null ? ` · Blick ${dirName(s.richtung)}` : ''}${s.pano ? ' · Panorama' : ''}</div>
          ${s.zustand !== 'gut' || pend.has(s.id) ? `<div style="margin-top:5px;display:flex;gap:5px;flex-wrap:wrap">${s.zustand !== 'gut' ? `<span class="badge ${s.zustand}">${ZUSTAND[s.zustand]}</span>` : ''}${pend.has(s.id) ? '<span class="badge wait">nicht hochgeladen</span>' : ''}</div>` : ''}
        </div>
        <div class="ds" data-dist="${esc(s.id)}"></div>
      </button>`).join('') || (sitze.length ? '<div class="card pad empty">Nichts gefunden.</div>' : `<div class="card pad empty"><img src="icons/logo.png" alt=""><p>Noch keine Hochsitze erfasst.${isAdmin() ? '<br>Auf der Karte unten „+ Hochsitz erfassen“ tippen, wenn du am Sitz stehst.' : ''}</p></div>`)}
    </div>
    ${sort === 'dist' && !state.me && sitze.length ? '<p class="hint" style="text-align:center">Für die Entfernung bitte auf der Karte „Mein Standort“ einschalten.</p>' : ''}
    <p class="hint" style="text-align:center">${state.data.stand ? `Stand: ${dtDE(state.data.stand)} · ` : ''}v${APP_VERSION}</p>`;
  $$('.sitz', el).forEach(b => b.onclick = () => openDetail(b.dataset.id));
  const qi = $('#listQ', el);
  if (qi) qi.oninput = () => { state.listQ = qi.value; const pos = qi.selectionStart; renderList(); const n = $('#listQ'); n.focus(); n.setSelectionRange(pos, pos); };
  const so = $('#listSort', el);
  if (so) so.onchange = () => { state.view.sort = so.value; saveView(); if (so.value === 'dist' && !state.me) locate(); renderList(); };
  renderListDistances();
  hydrateImages(el);
}
function renderListDistances() {
  $$('[data-dist]').forEach(el => {
    const s = sitzById(el.dataset.dist);
    el.innerHTML = s && state.me ? `${distTxt(distM(state.me, s))}<small>${dirName(bearing(state.me, s))}</small>` : '';
  });
}

/* ================= Sheet & Verlauf (Zurück-Taste) ================= */
let sheetCleanup = null;
function openSheet(title, body, foot = '', { overLock = false } = {}) {
  if (sheetCleanup) { const c = sheetCleanup; sheetCleanup = null; c(); }
  if ($('#sheet').hidden) history.pushState({ hs: 'sheet' }, '');
  $('#sheetTitle').textContent = title;
  $('#sheetBody').innerHTML = body;
  $('#sheetFoot').innerHTML = foot;
  $('#sheet').hidden = false;
  $('#sheet').style.zIndex = overLock ? 1160 : '';
  $('#sheetBody').scrollTop = 0;
}
function closeSheet(fromPop = false) {
  if ($('#sheet').hidden) return;
  if (sheetCleanup) { const c = sheetCleanup; sheetCleanup = null; c(); }
  $('#sheet').hidden = true;
  if (!fromPop && history.state?.hs === 'sheet') history.back();
}
document.addEventListener('click', e => { if (e.target.closest('[data-close]')) closeSheet(); });
window.addEventListener('popstate', () => {
  if (!$('#viewer').hidden) { closeViewer(true); return; }
  if (!$('#sheet').hidden) { closeSheet(true); return; }
  if (state.view.tab !== 'karte') switchTab('karte', true);
});

/* ================= Bild-Betrachter ================= */
async function openViewer(path, title, pano) {
  const v = $('#viewer'), body = $('#viewerBody');
  $('#viewerTitle').textContent = title;
  body.className = 'viewer-body' + (pano ? ' pano' : '');
  body.innerHTML = '<p style="color:#ccc">Lade …</p>';
  v.hidden = false; history.pushState({ hs: 'viewer' }, '');
  try {
    const u = await imgUrl(path);
    body.innerHTML = `<img src="${u}" alt="" class="${pano ? '' : 'photo'}" draggable="false">` + (pano ? '<div class="pano-bar"><i></i></div><div class="pano-hint">← zum Umsehen wischen →</div>' : '');
    if (pano) {
      const img = $('img', body);
      const upd = () => {
        const bar = $('.pano-bar i'); if (!bar) return;
        const sw = body.scrollWidth, cw = body.clientWidth;
        bar.style.left = (body.scrollLeft / sw * 100) + '%'; bar.style.width = (cw / sw * 100) + '%';
      };
      const center = () => { body.scrollLeft = (body.scrollWidth - body.clientWidth) / 2; upd(); };
      img.complete ? center() : img.addEventListener('load', center);
      body.addEventListener('scroll', upd, { passive: true });
      // Maus ziehen (PC)
      let drag = null;
      body.onpointerdown = e => { if (e.pointerType !== 'mouse') return; drag = { x: e.clientX, l: body.scrollLeft }; body.style.cursor = 'grabbing'; };
      body.onpointermove = e => { if (drag) body.scrollLeft = drag.l - (e.clientX - drag.x); };
      body.onpointerup = body.onpointerleave = () => { drag = null; body.style.cursor = ''; };
    }
  } catch (e) { body.innerHTML = `<p style="color:#f3dcc6;padding:20px">${esc(e.message)}</p>`; }
}
function closeViewer(fromPop = false) {
  if ($('#viewer').hidden) return;
  $('#viewer').hidden = true; $('#viewerBody').innerHTML = '';
  if (!fromPop && history.state?.hs === 'viewer') history.back();
}
$('#viewerClose').onclick = () => closeViewer();

/* ================= Hochsitz-Details ================= */
function openDetail(id) {
  const s = sitzById(id); if (!s) return;
  const pend = pendingIds().has(id);
  const a = artOf(s);
  const me = state.me;
  const fotoOld = v => v.foto && (!s.foto || v.foto.f !== s.foto.f);
  const panoOld = v => v.pano && (!s.pano || v.pano.f !== s.pano.f);
  const body = `
    <div class="det-photo">${s.foto ? `<img data-img="${esc(s.foto.t)}" data-full="${esc(s.foto.f)}" alt="Foto ${esc(s.name)}" id="detFoto">` : `<div class="ph-empty">Kein Foto</div>`}</div>
    ${s.pano ? `<button class="pano-strip" id="detPano" data-img="${esc(s.pano.t)}"><span>🔭 Panorama vom Sitz ansehen</span></button>` : ''}
    <div style="display:flex;gap:6px;flex-wrap:wrap">
      <span class="badge" style="background:${a.color};color:#fff">${esc(a.short)}</span>
      <span class="badge ${s.zustand}">${ZUSTAND[s.zustand] || s.zustand}</span>
      ${pend ? '<span class="badge wait">noch nicht hochgeladen</span>' : ''}
    </div>
    ${s.bemerkung ? `<div class="note">${esc(s.bemerkung)}</div>` : ''}
    <dl class="facts">
      <dt>Blickrichtung</dt><dd>${dirTxt(s.richtung)}</dd>
      ${me ? `<dt>Entfernung</dt><dd>${distM(me, s) <= Math.max(10, me.acc || 0) ? 'Du bist am Sitz' : `${distTxt(distM(me, s))} Richtung ${dirName(bearing(me, s))}`}</dd>` : ''}
      <dt>Steht hier seit</dt><dd>${dateDE(s.seit)}</dd>
      <dt>Koordinaten</dt><dd>${coordTxt(s)}${s.acc ? ` <span class="sub">(±${Math.round(s.acc)} m)</span>` : ''}</dd>
      <dt>Geändert</dt><dd>${dtDE(s.geaendert)}</dd>
    </dl>
    <div class="btn-row">
      <button class="btn secondary small" id="detMap">📍 Auf Karte zeigen</button>
      <button class="btn secondary small" id="detCopy">Koordinaten kopieren</button>
    </div>
    ${s.verlauf.length ? `<h2 class="section">Standorte (${s.verlauf.length + 1})</h2>
    <div class="card pad"><ul class="hist">
      <li class="cur"><i></i><div><b>Aktuell</b> · seit ${dateDE(s.seit)}<small>${coordTxt(s)}</small></div></li>
      ${s.verlauf.map((v, i) => `<li><i></i><div><b>${dateDE(v.von)} – ${dateDE(v.bis)}</b><small>${distTxt(distM(v, s))} vom heutigen Standort · ${coordTxt(v)}</small>
        <div class="btn-row" style="gap:6px">
          ${fotoOld(v) ? `<button class="btn secondary small" data-hfoto="${i}">Foto damals</button>` : ''}
          ${panoOld(v) ? `<button class="btn secondary small" data-hpano="${i}">Panorama damals</button>` : ''}
          <button class="btn ghost small" data-hmap="${i}">Auf Karte</button>
          ${isAdmin() ? `<button class="btn ghost small" data-hdel="${i}" style="color:var(--warn)">Entfernen</button>` : ''}
        </div></div></li>`).join('')}
    </ul></div>` : ''}
    ${isAdmin() ? '<button class="btn danger block" id="detDel" style="margin-top:22px">Hochsitz löschen</button>' : ''}`;
  const foot = isAdmin() ? `<button class="btn secondary" id="detEdit">Bearbeiten</button><button class="btn" id="detMove">⇄ Umstellen</button>` : '';
  openSheet(s.name, body, foot);
  const root = $('#sheet');
  hydrateImages(root);
  $('#detFoto')?.addEventListener('click', () => openViewer(s.foto.f, s.name));
  $('#detPano')?.addEventListener('click', () => openViewer(s.pano.f, `${s.name} · Panorama`, true));
  $('#detMap').onclick = () => { closeSheet(); focusSitz(s); };
  $('#detCopy').onclick = async () => { try { await navigator.clipboard.writeText(coordTxt(s)); toast('Koordinaten kopiert'); } catch { toast(coordTxt(s), 5000); } };
  $$('[data-hfoto]', root).forEach(b => b.onclick = () => openViewer(s.verlauf[b.dataset.hfoto].foto.f, `${s.name} · bis ${dateDE(s.verlauf[b.dataset.hfoto].bis)}`));
  $$('[data-hpano]', root).forEach(b => b.onclick = () => openViewer(s.verlauf[b.dataset.hpano].pano.f, `${s.name} · Panorama bis ${dateDE(s.verlauf[b.dataset.hpano].bis)}`, true));
  $$('[data-hmap]', root).forEach(b => b.onclick = () => {
    const v = s.verlauf[b.dataset.hmap]; closeSheet(); if (!state.view.hist) toggleHist(true);
    switchTab('karte'); setTimeout(() => map.fitBounds(L.latLngBounds([[v.lat, v.lng], [s.lat, s.lng]]).pad(0.5), { maxZoom: 18 }), 60);
  });
  $$('[data-hdel]', root).forEach(b => b.onclick = () => {
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Wirklich entfernen?'; return; }
    const n = clone(s); n.verlauf.splice(Number(b.dataset.hdel), 1); n.geaendert = new Date().toISOString();
    enqueue({ t: 'put', sitzId: s.id, sitzName: s.name, sitz: n, msg: `Alten Standort von „${s.name}“ entfernt` });
    openDetail(s.id);
  });
  $('#detEdit')?.addEventListener('click', () => openCapture('bearbeiten', s.id));
  $('#detMove')?.addEventListener('click', () => openCapture('umstellen', s.id));
  $('#detDel')?.addEventListener('click', e => {
    const b = e.currentTarget;
    if (!b.dataset.sure) { b.dataset.sure = 1; b.textContent = 'Nochmal tippen zum endgültigen Löschen'; return; }
    const files = sitzFiles(s);
    closeSheet();
    enqueue({ t: 'del', sitzId: s.id, sitzName: s.name, msg: `Hochsitz „${s.name}“ gelöscht`, delFiles: files });
  });
}
function sitzFiles(s) {
  const out = new Set();
  [s, ...(s.verlauf || [])].forEach(x => ['foto', 'pano'].forEach(k => { if (x[k]) { out.add(x[k].f); out.add(x[k].t); } }));
  return [...out];
}

/* ================= Erfassen / Umstellen / Bearbeiten ================= */
function gpsQuality(acc) {
  if (acc == null) return ['', 'warte auf GPS …'];
  if (acc <= 5) return ['', 'sehr gut'];
  if (acc <= 10) return ['', 'gut'];
  if (acc <= 20) return ['bad', 'mäßig – kurz stehen bleiben'];
  return ['bad', 'ungenau – warten oder ins Freie gehen'];
}
/** Mittelwert der besten Messungen (Gewicht 1/Genauigkeit²) */
function estimate(samples) {
  if (!samples.length) return null;
  const best = Math.min(...samples.map(s => s.acc));
  const use = samples.filter(s => s.acc <= Math.max(best * 1.5, best + 3));
  let w = 0, lat = 0, lng = 0;
  use.forEach(s => { const k = 1 / (s.acc * s.acc); w += k; lat += s.lat * k; lng += s.lng * k; });
  return { lat: lat / w, lng: lng / w, acc: best, n: use.length };
}
const dirSeg = deg => `<div class="dir-grid">${DIRS.map((d, i) => `<button type="button" data-dir="${i * 45}" class="${deg != null && dirName(deg) === d ? 'on' : ''}">${d}</button>`).join('')}</div>`;
const roseSvg = `<svg viewBox="0 0 92 92" aria-hidden="true"><g font-size="10" font-weight="700" fill="#66694f" text-anchor="middle" font-family="sans-serif"><text x="46" y="13">N</text><text x="84" y="50">O</text><text x="46" y="87">S</text><text x="8" y="50">W</text></g><g class="needle" id="needle"><path d="M46 46 L37 20 A28 28 0 0 1 55 20 Z" fill="rgba(255,200,60,.6)" stroke="#9b7a32"/><circle cx="46" cy="46" r="4" fill="#1f4a24"/></g></svg>`;

function openCapture(mode, id) {
  if (!isAdmin()) return;
  if (!state.pw) { openPwSheet(() => openCapture(mode, id)); return; }
  const s = id ? sitzById(id) : null;
  const neu = mode === 'neu', move = mode === 'umstellen', edit = mode === 'bearbeiten';
  const f = {
    name: s?.name || '', art: s?.art || 'kanzel', zustand: s?.zustand || 'gut', bemerkung: s?.bemerkung || '',
    richtung: s ? s.richtung : null, foto: edit ? s.foto : null, pano: edit ? s.pano : null,
    newFoto: null, newPano: null, datum: todayISO(),
  };
  const gps = { samples: [], est: null, manual: null, watch: null };
  let mini = null, miniMarker = null, miniCircle = null, compassStop = null, miniDir = null;

  const title = neu ? 'Neuer Hochsitz' : move ? `Umstellen: ${s.name}` : `Bearbeiten: ${s.name}`;
  const posBlock = `<fieldset><legend>${move ? 'Neue Position' : 'Position'}</legend>
      ${edit ? '<p class="hint">Nur zur Korrektur (z. B. Punkt etwas verschieben). Wurde der Sitz versetzt, bitte „Umstellen“ nehmen – dann bleibt der alte Standort im Verlauf.</p>' : ''}
      <div class="gps-box" id="gpsBox" ${edit ? 'hidden' : ''}>
        <div class="gps-live"><span class="gps-dot" id="gpsDot"></span><div class="gps-acc" id="gpsAcc">–<small>Genauigkeit</small></div><div class="gps-txt" id="gpsTxt">Starte GPS …</div></div>
      </div>
      <div class="mini-map" id="miniMap"></div>
      <p class="hint" id="miniHint">${edit ? 'Punkt ziehen oder in die Karte tippen, um ihn zu verschieben.' : 'Der Punkt folgt dem GPS. Du kannst ihn auch ziehen oder in die Karte tippen.'}</p>
      <div class="btn-row">${edit ? '<button type="button" class="btn secondary small" id="gpsStart">An meine GPS-Position setzen</button>' : '<button type="button" class="btn secondary small" id="gpsReset">Neu messen</button>'}</div>
      <div id="nearHint"></div>
    </fieldset>`;
  const dataBlock = move ? '' : `<fieldset><legend>Angaben</legend>
      <label class="field"><span>Name / Nummer</span><input id="fName" value="${esc(f.name)}" placeholder="z. B. Eichenkanzel oder Nr. 7" autocomplete="off"></label>
      <div class="field"><span>Art</span><div class="seg" id="fArt">${Object.entries(ARTEN).map(([k, a]) => `<button type="button" data-v="${k}" class="${f.art === k ? 'on' : ''}">${esc(a.short)}</button>`).join('')}</div></div>
      <div class="field"><span>Zustand</span><div class="seg zst" id="fZst">${Object.entries(ZUSTAND).map(([k, t]) => `<button type="button" data-v="${k}" class="${f.zustand === k ? 'on' : ''}">${t}</button>`).join('')}</div></div>
      <label class="field"><span>Bemerkung</span><textarea id="fBem" placeholder="z. B. Sprosse lose, Dach neu 2026, Zugang von Norden">${esc(f.bemerkung)}</textarea></label>
    </fieldset>`;
  const dirBlock = `<fieldset><legend>Blickrichtung</legend>
      <div class="compass"><div class="rose">${roseSvg}</div>
        <div><div class="dir-val" id="dirVal">${f.richtung == null ? '–' : Math.round(f.richtung) + '°'}<small id="dirTxt">${f.richtung == null ? 'nicht angegeben' : dirName(f.richtung)}</small></div></div></div>
      <div class="btn-row"><button type="button" class="btn secondary small" id="cmpStart">🧭 Mit Kompass messen</button></div>
      <p class="hint" id="cmpHint">Handy flach halten, Oberkante in Blickrichtung des Sitzes zeigen, dann „Übernehmen“.</p>
      ${dirSeg(f.richtung)}
      <button type="button" class="btn ghost small" id="dirNone">keine Richtung</button>
    </fieldset>`;
  const photoBlock = `<fieldset><legend>Fotos</legend>
      <div class="photo-slots">
        <button type="button" class="slot" id="slotFoto"></button>
        <button type="button" class="slot" id="slotPano"></button>
      </div>
      <p class="hint">${move ? 'Leer lassen = bisherige Fotos bleiben. Neue Fotos ersetzen die aktuellen, die alten bleiben im Verlauf.' : 'Panorama: in der Kamera-App den Modus „Pano/Panorama“ nehmen und hier aus der Galerie auswählen.'}</p>
    </fieldset>`;
  const dateBlock = move ? `<fieldset><legend>Umgestellt am</legend><label class="field"><span>Datum</span><input type="date" id="fDatum" value="${f.datum}"></label></fieldset>` : '';

  openSheet(title, posBlock + dataBlock + dirBlock + photoBlock + dateBlock,
    `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="capSave">Speichern</button>`);

  /* --- Fotos --- */
  const slot = (kind) => {
    const el = $(kind === 'foto' ? '#slotFoto' : '#slotPano');
    const nw = kind === 'foto' ? f.newFoto : f.newPano;
    const cur = kind === 'foto' ? f.foto : f.pano;
    const label = kind === 'foto' ? 'Foto vom Sitz' : 'Panorama vom Sitz';
    if (nw) {
      el.className = 'slot has'; el.innerHTML = `<img src="${nw.url}" alt=""><span class="lbl">${label} · neu</span><span class="x" role="button" aria-label="Entfernen">✕</span>`;
    } else if (cur) {
      el.className = 'slot has'; el.innerHTML = `<img data-img="${esc(cur.t)}" alt=""><span class="lbl">${label}</span><span class="x" role="button" aria-label="Entfernen">✕</span>`;
      hydrateImages(el);
    } else {
      el.className = 'slot'; el.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round">${kind === 'foto' ? '<path d="M4 8h3l2-2.5h6L17 8h3v11H4Z"/><circle cx="12" cy="13" r="3.5"/>' : '<path d="M2.5 7.5c6-2 13-2 19 0v9c-6-2-13-2-19 0Z"/><path d="m7 14 3-3 2.5 2.5L15 11l3 3"/>'}</svg>${label}<span class="sub" style="font-weight:400">${kind === 'foto' ? 'aufnehmen oder wählen' : 'aus der Galerie'}</span>`;
    }
  };
  const pick = kind => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*';
    if (kind === 'foto') inp.setAttribute('capture', 'environment');
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      toast('Bereite Foto vor …', 1500);
      try {
        const p = await prepPhoto(file, kind);
        p.url = URL.createObjectURL(new Blob([p.thumb], { type: 'image/jpeg' }));
        if (kind === 'foto') f.newFoto = p; else f.newPano = p;
        slot(kind);
      } catch (e) { toast(e.message, 4000); }
    };
    // Foto: Auswahl lassen (Kamera oder Galerie) – manche Handys öffnen mit capture sofort die Kamera
    if (kind === 'foto' && !/iPhone|iPad|Android/i.test(navigator.userAgent)) inp.removeAttribute('capture');
    inp.click();
  };
  ['foto', 'pano'].forEach(kind => {
    const el = $(kind === 'foto' ? '#slotFoto' : '#slotPano');
    el.onclick = e => {
      if (e.target.closest('.x')) {
        if (kind === 'foto') { if (f.newFoto) f.newFoto = null; else f.foto = null; } else { if (f.newPano) f.newPano = null; else f.pano = null; }
        slot(kind); return;
      }
      pick(kind);
    };
    slot(kind);
  });
  // Auf dem Handy: Foto-Slot öffnet Auswahl ohne Zwang zur Kamera, wenn lange gedrückt? → einfacher: Hinweis
  /* --- Angaben --- */
  const segWire = (sel, key) => $$(`${sel} button`).forEach(b => b.onclick = () => { f[key] = b.dataset.v; $$(`${sel} button`).forEach(x => x.classList.toggle('on', x === b)); });
  if (!move) { segWire('#fArt', 'art'); segWire('#fZst', 'zustand'); }

  /* --- Richtung --- */
  const setDir = deg => {
    f.richtung = deg == null ? null : ((deg % 360) + 360) % 360;
    $('#dirVal').innerHTML = `${f.richtung == null ? '–' : Math.round(f.richtung) + '°'}<small id="dirTxt">${f.richtung == null ? 'nicht angegeben' : dirName(f.richtung)}</small>`;
    $$('[data-dir]').forEach(b => b.classList.toggle('on', f.richtung != null && dirName(f.richtung) === DIRS[b.dataset.dir / 45]));
    $('#needle').style.transform = `rotate(${f.richtung ?? 0}deg)`;
    $('#needle').style.opacity = f.richtung == null ? .25 : 1;
    if (miniDir) miniDir();
  };
  $$('[data-dir]').forEach(b => b.onclick = () => { stopCompass(); setDir(Number(b.dataset.dir)); });
  $('#dirNone').onclick = () => { stopCompass(); setDir(null); };
  let live = null;
  const stopCompass = () => { if (compassStop) { compassStop(); compassStop = null; } const b = $('#cmpStart'); if (b) { b.textContent = '🧭 Mit Kompass messen'; b.classList.add('secondary'); } };
  $('#cmpStart').onclick = async () => {
    if (compassStop) { // läuft → übernehmen
      if (live != null) setDir(live);
      stopCompass(); toast(`Richtung ${dirTxt(f.richtung)} übernommen`); return;
    }
    compassStop = await startCompass(h => {
      live = h;
      $('#needle').style.transform = `rotate(${h}deg)`; $('#needle').style.opacity = 1;
      $('#dirVal').innerHTML = `${Math.round(h)}°<small>${dirName(h)} · live</small>`;
    });
    if (compassStop) { const b = $('#cmpStart'); b.textContent = '✓ Richtung übernehmen'; b.classList.remove('secondary'); }
  };
  setDir(f.richtung);

  /* --- Mini-Karte & GPS --- */
  const startLL = s ? [s.lat, s.lng] : state.me ? [state.me.lat, state.me.lng] : map.getCenter();
  setTimeout(() => {
    if ($('#sheet').hidden || !$('#miniMap')) return;
    mini = L.map('miniMap', { zoomControl: false, attributionControl: false, center: startLL, zoom: 18 });
    makeTiles(state.view.layer).addTo(mini);
    if (move) { // alter Standort als Orientierung
      L.marker([s.lat, s.lng], { icon: L.divIcon({ className: 'hs-old', iconSize: [12, 12], iconAnchor: [6, 6], html: '<i></i>' }), interactive: false }).addTo(mini)
        .bindTooltip('bisher', { permanent: true, direction: 'top', className: 'hs-label' });
    }
    miniMarker = L.marker(startLL, { draggable: true, icon: sitzIcon({ art: f.art, richtung: f.richtung, zustand: f.zustand }) });
    if (edit) miniMarker.addTo(mini);
    miniCircle = L.circle(startLL, { radius: 0, color: '#1c6fe0', weight: 1, fillOpacity: .12, interactive: false }).addTo(mini);
    miniMarker.on('dragend', () => { const ll = miniMarker.getLatLng(); gps.manual = { lat: ll.lat, lng: ll.lng }; manualHint(); checkNear(); });
    mini.on('click', e => { gps.manual = { lat: e.latlng.lat, lng: e.latlng.lng }; miniMarker.setLatLng(e.latlng).addTo(mini); manualHint(); checkNear(); });
    miniDir = () => { miniMarker.setIcon(sitzIcon({ art: f.art, richtung: f.richtung, zustand: f.zustand })); };
    setTimeout(() => mini.invalidateSize(), 250);
    if (gps.est) showGps();
  }, 60);
  const manualHint = () => { $('#miniHint').textContent = 'Punkt von Hand gesetzt. „Neu messen“ nimmt wieder das GPS.'; };
  const pos = () => gps.manual || gps.est || (edit && s ? { lat: s.lat, lng: s.lng, acc: s.acc } : null);
  const showGps = () => {
    const e = gps.est;
    const [cls, txt] = gpsQuality(e?.acc);
    $('#gpsAcc').className = 'gps-acc ' + cls;
    $('#gpsAcc').innerHTML = `${e ? '±' + Math.round(e.acc) + ' m' : '–'}<small>Genauigkeit</small>`;
    $('#gpsTxt').innerHTML = e ? `<b>${txt}</b><br>${e.n} Messung${e.n === 1 ? '' : 'en'} gemittelt` : txt;
    if (e && mini && !gps.manual) {
      miniMarker.setLatLng([e.lat, e.lng]).addTo(mini);
      miniCircle.setLatLng([e.lat, e.lng]).setRadius(e.acc);
      if (!showGps._c) { showGps._c = 1; mini.setView([e.lat, e.lng], 18); }
    }
  };
  const startGps = () => {
    if (!navigator.geolocation) { $('#gpsTxt').textContent = 'Kein GPS – bitte Position in der Karte antippen.'; return; }
    $('#gpsBox').hidden = false;
    $('#gpsDot').classList.add('live');
    gps.samples = []; gps.est = null; gps.manual = null; showGps._c = 0;
    if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch);
    gps.watch = navigator.geolocation.watchPosition(p => {
      gps.samples.push({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() });
      if (gps.samples.length > 30) gps.samples.shift();
      gps.est = estimate(gps.samples);
      state.me = { lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy };
      showGps(); checkNear();
    }, err => {
      $('#gpsDot').classList.remove('live');
      $('#gpsTxt').textContent = err.code === 1 ? 'Standort nicht erlaubt – bitte freigeben oder Position in der Karte antippen.' : 'Kein GPS-Signal – Position in der Karte antippen.';
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  };
  const checkNear = () => {
    if (!neu) return;
    const p = pos(); const box = $('#nearHint'); if (!p || !box) return;
    const near = state.data.sitze.map(x => ({ x, d: distM(p, x) })).filter(o => o.d <= NEAR_M).sort((a, b) => a.d - b.d)[0];
    if (!near) { box.innerHTML = ''; return; }
    if (box.dataset.id === near.x.id) { $('#nearD').textContent = distTxt(near.d); return; }
    box.dataset.id = near.x.id;
    box.innerHTML = `<div class="near-hint">Du bist <b id="nearD">${distTxt(near.d)}</b> von „<b>${esc(near.x.name)}</b>“ entfernt. Wurde dieser Sitz umgestellt?<div class="btn-row"><button type="button" class="btn small" id="nearMove">Ja, „${esc(near.x.name)}“ umstellen</button></div></div>`;
    $('#nearMove').onclick = () => { const keep = { samples: gps.samples }; cleanup(); openCapture('umstellen', near.x.id); };
  };
  if (!edit) startGps();
  $('#gpsReset')?.addEventListener('click', () => { $('#miniHint').textContent = 'Der Punkt folgt dem GPS. Du kannst ihn auch ziehen oder in die Karte tippen.'; startGps(); });
  $('#gpsStart')?.addEventListener('click', () => startGps());

  const cleanup = () => {
    if (gps.watch != null) navigator.geolocation.clearWatch(gps.watch);
    gps.watch = null; stopCompass();
    if (mini) { mini.remove(); mini = null; }
    [f.newFoto, f.newPano].forEach(p => p?.url && URL.revokeObjectURL(p.url));
  };
  sheetCleanup = cleanup;

  /* --- Speichern --- */
  $('#capSave').onclick = async () => {
    const p = pos();
    if (!p) { toast('Noch keine Position – kurz auf GPS warten oder in die Karte tippen.', 3500); return; }
    let name = f.name;
    if (!move) {
      name = $('#fName').value.trim();
      if (!name) { toast('Bitte einen Namen eingeben.'); $('#fName').focus(); return; }
      f.bemerkung = $('#fBem').value.trim();
    }
    if (move && p && distM(p, s) < 3 && !f.newFoto && !f.newPano) {
      if (!$('#capSave').dataset.sure) { $('#capSave').dataset.sure = 1; $('#capSave').textContent = 'Fast gleiche Stelle – trotzdem?'; return; }
    }
    $('#capSave').disabled = true;
    try {
      const sid = s?.id || uid();
      const files = [];
      const store = async (ph, kind) => {
        const base = `${FOTO_DIR}/${sid}-${kind}-${uid()}`;
        const fPath = base + '.bin', tPath = base + '-t.bin';
        await idbSet('bin:' + fPath, await encryptBytes(ph.full, state.pw));
        await idbSet('bin:' + tPath, await encryptBytes(ph.thumb, state.pw));
        imgUrlCache.set(tPath, Promise.resolve(ph.url));
        files.push(fPath, tPath);
        return { f: fPath, t: tPath, w: ph.w, h: ph.h };
      };
      const fotoRef = f.newFoto ? await store(f.newFoto, 'foto') : null;
      const panoRef = f.newPano ? await store(f.newPano, 'pano') : null;
      f.newFoto && (f.newFoto.url = null); f.newPano && (f.newPano.url = null); // URL gehört jetzt dem Cache
      const now = new Date().toISOString();
      let n, msg;
      if (neu) {
        n = { id: sid, name, art: f.art, zustand: f.zustand, bemerkung: f.bemerkung, lat: p.lat, lng: p.lng, acc: p.acc ? Math.round(p.acc * 10) / 10 : null,
          richtung: f.richtung, foto: fotoRef, pano: panoRef, seit: todayISO(), erstellt: now, geaendert: now, verlauf: [] };
        msg = `Hochsitz „${name}“ erfasst`;
      } else if (move) {
        n = clone(s);
        const datum = $('#fDatum').value || todayISO();
        n.verlauf.unshift({ lat: s.lat, lng: s.lng, acc: s.acc, richtung: s.richtung, von: s.seit, bis: datum, foto: s.foto, pano: s.pano });
        Object.assign(n, { lat: p.lat, lng: p.lng, acc: p.acc ? Math.round(p.acc * 10) / 10 : null, richtung: f.richtung, seit: datum, geaendert: now });
        if (fotoRef) n.foto = fotoRef;
        if (panoRef) n.pano = panoRef;
        msg = `Hochsitz „${s.name}“ umgestellt (${distTxt(distM(s, p))})`;
      } else {
        n = clone(s);
        const removed = [];
        const used = new Set(n.verlauf.flatMap(v => [v.foto?.f, v.foto?.t, v.pano?.f, v.pano?.t]).filter(Boolean));
        if ((fotoRef || !f.foto) && s.foto && !used.has(s.foto.f)) removed.push(s.foto.f, s.foto.t);
        if ((panoRef || !f.pano) && s.pano && !used.has(s.pano.f)) removed.push(s.pano.f, s.pano.t);
        Object.assign(n, { name, art: f.art, zustand: f.zustand, bemerkung: f.bemerkung, richtung: f.richtung, foto: fotoRef || f.foto, pano: panoRef || f.pano, geaendert: now });
        if (gps.manual || gps.est) Object.assign(n, { lat: p.lat, lng: p.lng, acc: p.acc ? Math.round(p.acc * 10) / 10 : n.acc });
        msg = `Hochsitz „${name}“ bearbeitet`;
        cleanup(); sheetCleanup = null;
        closeSheet();
        await enqueue({ t: 'put', sitzId: sid, sitzName: name, sitz: n, files, msg, delFiles: removed });
        return;
      }
      cleanup(); sheetCleanup = null;
      closeSheet();
      await enqueue({ t: 'put', sitzId: sid, sitzName: n.name, sitz: n, files, msg });
      if (state.view.tab === 'karte') map.setView([n.lat, n.lng], Math.max(map.getZoom(), 17));
      toast(navigator.onLine === false ? 'Gespeichert auf dem Handy – wird hochgeladen, sobald Netz da ist.' : 'Wird gespeichert …', 2500);
    } catch (e) {
      toast('Fehler: ' + e.message, 5000);
      $('#capSave').disabled = false;
    }
  };
}

/* ---------- Kompass ---------- */
async function startCompass(cb) {
  if (typeof DeviceOrientationEvent === 'undefined') { toast('Dieses Gerät hat keinen Kompass – bitte Richtung antippen.', 3500); return null; }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try { if (await DeviceOrientationEvent.requestPermission() !== 'granted') { toast('Kompass nicht erlaubt.', 3000); return null; } }
    catch { toast('Kompass nicht erlaubt.', 3000); return null; }
  }
  const angle = () => (screen.orientation && typeof screen.orientation.angle === 'number' ? screen.orientation.angle : (window.orientation || 0));
  let sx = null, sy = null, got = false;
  const handler = e => {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading + angle();
    else if (e.absolute && e.alpha != null) h = 360 - e.alpha + angle();
    if (h == null || Number.isNaN(h)) return;
    got = true;
    const r = h * Math.PI / 180, x = Math.cos(r), y = Math.sin(r);
    sx = sx == null ? x : sx * 0.75 + x * 0.25; sy = sy == null ? y : sy * 0.75 + y * 0.25;
    cb((Math.atan2(sy, sx) * 180 / Math.PI + 360) % 360);
  };
  const evt = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evt, handler);
  setTimeout(() => { if (!got) toast('Der Kompass liefert keine Werte – bitte Richtung antippen.', 4000); }, 3000);
  return () => window.removeEventListener(evt, handler);
}

/* ================= Passwort ================= */
function showLock(reason) {
  $('#lock').hidden = false;
  $('#lockMsg').textContent = reason === 'falsch' ? 'Passwort falsch oder geändert – bitte (neu) eingeben.' : 'Bitte das Passwort der Jagdgemeinschaft eingeben.';
  $('#lockMsg').classList.toggle('err', reason === 'falsch');
  $('#lockPw').value = '';
  setTimeout(() => $('#lockPw').focus(), 50);
}
$('#lockForm').addEventListener('submit', async e => {
  e.preventDefault();
  const pw = $('#lockPw').value; if (!pw) return;
  state.pw = pw; $('#lockBtn').disabled = true;
  try {
    await load();
    if ($('#lock').hidden) { lsSet(LS_PW, pw); flush(); }
    else { state.pw = ''; }
  } finally { $('#lockBtn').disabled = false; }
});
$('#lockSettings').onclick = () => openSettings(true);

/** Passwort festlegen (erste Einrichtung) oder ändern (alles neu verschlüsseln) */
function openPwSheet(after) {
  const first = !state.remoteEnc;
  openSheet(first ? 'Passwort festlegen' : 'Passwort ändern', `
    <p class="hint">${first
      ? 'Die Hochsitze und Fotos werden mit dem Passwort der Jagdgemeinschaft verschlüsselt. <b>Am besten dasselbe Passwort wie in der Jagd-Thuine-App</b> – dann passt alles, wenn die Hochsitze später in die App wandern.'
      : 'Alle Daten und Fotos werden mit dem neuen Passwort neu verschlüsselt. Danach fragt jedes Gerät einmal nach dem neuen Passwort. Dafür ist Internet nötig.'}</p>
    ${!first ? '<label class="field"><span>Bisheriges Passwort</span><input type="password" id="pwOld" autocomplete="current-password"></label>' : ''}
    <label class="field"><span>${first ? 'Passwort' : 'Neues Passwort'}</span><input type="password" id="pwNew" autocomplete="new-password"></label>
    <label class="field"><span>Wiederholen</span><input type="password" id="pwNew2" autocomplete="new-password"></label>
    <p class="hint" id="pwMsg"></p>`,
    `<button class="btn secondary" data-close>Abbrechen</button><button class="btn" id="pwSave">${first ? 'Festlegen' : 'Ändern'}</button>`, { overLock: true });
  $('#pwSave').onclick = async () => {
    const a = $('#pwNew').value, b = $('#pwNew2').value;
    if (a.length < 6) { $('#pwMsg').textContent = 'Mindestens 6 Zeichen.'; return; }
    if (a !== b) { $('#pwMsg').textContent = 'Die beiden Eingaben sind verschieden.'; return; }
    if (first) {
      state.pw = a; lsSet(LS_PW, a); closeSheet(); toast('Passwort gespeichert ✓');
      if (after) setTimeout(after, 200); else flush();
      return;
    }
    if ($('#pwOld').value !== state.pw) { $('#pwMsg').textContent = 'Bisheriges Passwort stimmt nicht.'; return; }
    $('#pwSave').disabled = true;
    try { await reencryptAll(state.pw, a, t => ($('#pwMsg').textContent = t)); closeSheet(); toast('Passwort geändert ✓ – alles neu verschlüsselt.', 4000); }
    catch (e) { $('#pwMsg').textContent = 'Fehler: ' + e.message + ' – bitte nochmal versuchen.'; $('#pwSave').disabled = false; }
  };
}
async function reencryptAll(oldPw, newPw, progress) {
  if (state.queue.length) { await flush(); if (state.queue.length) throw new Error('Erst die wartenden Änderungen hochladen'); }
  const { raw } = await fetchRemoteRaw();
  const { data } = await openRaw(raw);
  const files = [...new Set(normalize(data).sitze.flatMap(sitzFiles))];
  lsSet(LS_SALT, undefined); // neuer Salt für das neue Passwort
  let i = 0;
  for (const p of files) {
    progress(`Fotos neu verschlüsseln … ${++i}/${files.length}`);
    await idbDel('bin:' + p);
    const plain = await decryptBytes(await fetchBin(p), [oldPw]);
    const enc = await encryptBytes(plain, newPw);
    const r = await putFile(p, bytesToB64(enc), 'Foto neu verschlüsselt', await getSha(p));
    if (!r.ok) throw new Error(`GitHub ${r.status}`);
    await idbSet('bin:' + p, enc);
  }
  progress('Daten speichern …');
  const r = await putFile(DATA_PATH, b64encodeUtf8(JSON.stringify(await encryptJSON(data, newPw), null, 1) + '\n'), 'Passwort geändert', await getSha(DATA_PATH));
  if (!r.ok) throw new Error(`GitHub ${r.status}`);
  state.pw = newPw; lsSet(LS_PW, newPw);
  await load();
}

/* ================= Einstellungen ================= */
function openSettings(fromLock = false) {
  const c = state.cfg;
  const voll = c.mode === 'voll';
  openSheet('Einstellungen', `
    <fieldset><legend>Zugang auf diesem Gerät</legend>
      <div class="seg" id="sMode"><button type="button" data-v="" class="${voll ? '' : 'on'}">Nur ansehen</button><button type="button" data-v="voll" class="${voll ? 'on' : ''}">Voller Zugang</button></div>
      <div id="sVoll" ${voll ? '' : 'hidden'}>
        <label class="field"><span>GitHub-Token (Contents: Read & Write auf „${esc(c.repo || 'Hochsitze')}“)</span><input type="password" id="sToken" value="${esc(c.token)}" autocomplete="off" placeholder="github_pat_…"></label>
        <div class="grid2" style="margin-top:10px">
          <label class="field"><span>GitHub-Konto</span><input id="sOwner" value="${esc(c.owner)}" autocomplete="off"></label>
          <label class="field"><span>Repository</span><input id="sRepo" value="${esc(c.repo)}" autocomplete="off"></label>
        </div>
        <button type="button" class="btn secondary small" id="sTest" style="margin-top:10px">Zugang prüfen</button>
        <p class="hint" id="sTestMsg"></p>
      </div>
    </fieldset>
    ${voll && !fromLock ? `<fieldset><legend>Datenschutz</legend>
      <p class="hint">${state.remoteEnc ? 'Daten und Fotos sind mit dem Passwort der Jagdgemeinschaft verschlüsselt.' : state.pw ? 'Passwort ist festgelegt – die Daten werden beim nächsten Speichern verschlüsselt.' : 'Noch kein Passwort festgelegt.'}</p>
      <button type="button" class="btn secondary small" id="sPw">${state.remoteEnc ? 'Passwort ändern' : state.pw ? 'Passwort neu festlegen' : 'Passwort festlegen'}</button>
    </fieldset>` : ''}
    <fieldset><legend>Dieses Gerät</legend>
      <button type="button" class="btn secondary small" id="sClear">Gespeicherte Fotos auf dem Gerät löschen</button>
      ${state.pw && !fromLock ? '<button type="button" class="btn ghost small" id="sForget" style="color:var(--warn)">Passwort auf diesem Gerät vergessen</button>' : ''}
      <button type="button" class="btn ghost small" id="sReload">App neu laden</button>
      <p class="hint" id="sDevMsg"></p>
    </fieldset>
    <fieldset><legend>Über die App</legend>
      <div class="about"><img src="icons/logo.png" alt=""><div><b>Hochsitze</b><small>Jagdgemeinschaft Thuine · Version ${APP_VERSION}</small><small>Entwickelt von Sebastian Bruns, Thuine · privat, nicht kommerziell</small></div></div>
      <p class="hint">Karten: Luftbild © Esri · TopPlusOpen © BKG · © OpenStreetMap-Mitwirkende</p>
    </fieldset>`,
    `<button class="btn secondary" data-close>Schließen</button><button class="btn" id="sSave">Übernehmen</button>`, { overLock: fromLock });
  let mode = c.mode;
  $$('#sMode button').forEach(b => b.onclick = () => { mode = b.dataset.v; $$('#sMode button').forEach(x => x.classList.toggle('on', x === b)); $('#sVoll').hidden = mode !== 'voll'; });
  const read = () => ({ mode, token: $('#sToken').value.trim(), owner: $('#sOwner').value.trim(), repo: $('#sRepo').value.trim() });
  $('#sTest').onclick = async () => {
    const v = read(); const msg = $('#sTestMsg'); msg.textContent = 'Prüfe …';
    try {
      const r = await fetch(`https://api.github.com/repos/${encodeURIComponent(v.owner)}/${encodeURIComponent(v.repo)}`, { headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${v.token}` }, cache: 'no-store' });
      if (!r.ok) { msg.textContent = r.status === 401 ? '❌ Token ungültig.' : r.status === 404 ? '❌ Repository nicht gefunden oder Token hat keinen Zugriff.' : `❌ GitHub ${r.status}`; return; }
      const j = await r.json();
      msg.textContent = j.permissions?.push ? '✅ Schreibzugriff vorhanden.' : '⚠️ Nur Lesezugriff – Token braucht „Contents: Read and write“.';
    } catch { msg.textContent = '❌ Keine Verbindung.'; }
  };
  $('#sPw')?.addEventListener('click', () => openPwSheet());
  $('#sClear').onclick = async () => {
    const keep = new Set(state.queue.flatMap(o => o.files));
    const keys = (await idbKeys()) || [];
    let n = 0; for (const k of keys) if (String(k).startsWith('bin:') && !keep.has(k.slice(4))) { await idbDel(k); n++; }
    $('#sDevMsg').textContent = `${n} Dateien gelöscht. Fotos werden bei Bedarf neu geladen.`;
  };
  $('#sForget')?.addEventListener('click', () => { lsSet(LS_PW, undefined); lsSet(LS_DATA, undefined); state.pw = ''; location.reload(); });
  $('#sReload').onclick = async () => {
    try { const regs = await navigator.serviceWorker?.getRegistrations?.(); await Promise.all((regs || []).map(r => r.unregister())); } catch { /* egal */ }
    try { const keys = await caches.keys(); await Promise.all(keys.filter(k => !k.startsWith('hs-tiles')).map(k => caches.delete(k))); } catch { /* egal */ }
    location.replace(location.pathname + '?r=' + Date.now());
  };
  $('#sSave').onclick = () => {
    const v = read();
    Object.assign(state.cfg, v.mode === 'voll' ? v : { mode: '', token: '' });
    if (v.mode !== 'voll' && location.hostname.endsWith('.github.io')) { const d = defaultCfg(); state.cfg.owner = d.owner; state.cfg.repo = d.repo; }
    saveCfg(); closeSheet(); toast('Einstellungen gespeichert');
    render(); load();
  };
}
$('#settingsBtn').onclick = () => openSettings();
$('#refreshBtn').onclick = () => { load(); if (state.queue.length) flush(); };
$$('.tab').forEach(b => b.onclick = () => switchTab(b.dataset.tab));

/* ================= Start ================= */
function measureTop() { document.documentElement.style.setProperty('--top-h', $('.topbar').getBoundingClientRect().height + 'px'); }
window.addEventListener('resize', () => { measureTop(); map?.invalidateSize(); });
window.addEventListener('online', () => flush());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && Date.now() - (load._last || 0) > 60000 && $('#sheet').hidden) { load._last = Date.now(); load({ quiet: true }); }
});
setInterval(() => { if (document.visibilityState === 'visible' && $('#sheet').hidden && $('#viewer').hidden) load({ quiet: true }); }, 5 * 60 * 1000);

(async function start() {
  measureTop();
  initMap();
  switchTab(state.view.tab === 'liste' ? 'liste' : 'karte', true);
  await loadCached();
  load._last = Date.now();
  await load();
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').then(reg => {
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        nw?.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) {
            const b = $('#banner'); b.className = 'banner'; b.hidden = false;
            b.innerHTML = '<span>✨ Neue Version verfügbar</span><button class="btn small" id="updBtn">Neu laden</button>';
            $('#updBtn').onclick = () => { nw.postMessage('skipWaiting'); setTimeout(() => location.reload(), 300); };
          }
        });
      });
    }).catch(() => { /* egal */ });
  }
})();
