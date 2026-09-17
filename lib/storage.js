/**
 * lib/storage.js
 * -----------------------------------------------------------------------------
 * Capa fina sobre chrome.storage.local. La cargan el popup, el service worker
 * y el content script (script clásico, sin módulos, para que funcione en los
 * tres contextos sin build step).
 *
 * Claves:
 *   pm_rows      -> array acumulado de negocios (persiste entre búsquedas)
 *   pm_config    -> { modo, limite }
 *   pm_warnings  -> array de avisos de la última extracción
 *   pm_status    -> estado en vivo del scraper
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const KEYS = {
    ROWS: 'pm_rows',
    CONFIG: 'pm_config',
    WARNINGS: 'pm_warnings',
    STATUS: 'pm_status'
  };

  const DEFAULT_CONFIG = { modo: 'rapido', limite: 200 };

  const DEFAULT_STATUS = {
    running: false,
    mode: 'rapido',
    query: '',
    extracted: 0,
    estimated: 0,
    sinWeb: 0,
    current: '',
    phase: 'idle',
    startedAt: 0,
    finishedAt: 0,
    updatedAt: 0,
    message: ''
  };

  /* Si un estado "en curso" lleva más de esto sin refrescarse, la pestaña
     que lo generó se cerró o se recargó: se considera muerto. */
  const STATUS_STALE_MS = 20000;

  /* Tope duro para no reventar la cuota de chrome.storage.local (~10 MB) */
  const MAX_ROWS = 20000;

  function get(keys) {
    return new Promise((resolve) => {
      chrome.storage.local.get(keys, (res) => resolve(res || {}));
    });
  }

  function set(obj) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.set(obj, () => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve();
      });
    });
  }

  function keyOf(row) {
    const pid = String(row.place_id_o_cid || '').trim().toLowerCase();
    if (pid) return `id:${pid}`;
    const norm = (v) => String(v || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '');
    return `na:${norm(row.nombre)}|${norm(row.direccion)}`;
  }

  async function getRows() {
    const res = await get(KEYS.ROWS);
    return Array.isArray(res[KEYS.ROWS]) ? res[KEYS.ROWS] : [];
  }

  async function setRows(rows) {
    await set({ [KEYS.ROWS]: rows.slice(0, MAX_ROWS) });
  }

  /**
   * Añade filas deduplicando contra lo ya acumulado.
   * Devuelve { added, duplicated, total }.
   */
  async function addRows(newRows) {
    const rows = await getRows();
    const seen = new Set(rows.map(keyOf));
    let added = 0;
    let duplicated = 0;
    for (const row of newRows || []) {
      const k = keyOf(row);
      if (seen.has(k)) { duplicated++; continue; }
      seen.add(k);
      rows.push(row);
      added++;
      if (rows.length >= MAX_ROWS) break;
    }
    await setRows(rows);
    return { added, duplicated, total: rows.length };
  }

  async function clearRows() {
    await set({ [KEYS.ROWS]: [], [KEYS.WARNINGS]: [] });
  }

  async function getConfig() {
    const res = await get(KEYS.CONFIG);
    return Object.assign({}, DEFAULT_CONFIG, res[KEYS.CONFIG] || {});
  }

  async function setConfig(patch) {
    const cfg = await getConfig();
    const next = Object.assign({}, cfg, patch || {});
    await set({ [KEYS.CONFIG]: next });
    return next;
  }

  async function getWarnings() {
    const res = await get(KEYS.WARNINGS);
    return Array.isArray(res[KEYS.WARNINGS]) ? res[KEYS.WARNINGS] : [];
  }

  async function addWarnings(list) {
    if (!list || !list.length) return;
    const current = await getWarnings();
    const merged = current.concat(list).slice(-300);
    await set({ [KEYS.WARNINGS]: merged });
  }

  async function setWarnings(list) {
    await set({ [KEYS.WARNINGS]: (list || []).slice(-300) });
  }

  /* Cola para que dos setStatus concurrentes no se pisen (get + set no es atómico) */
  let statusQueue = Promise.resolve();

  async function getStatus() {
    const res = await get(KEYS.STATUS);
    return Object.assign({}, DEFAULT_STATUS, res[KEYS.STATUS] || {});
  }

  function setStatus(patch) {
    statusQueue = statusQueue.then(async () => {
      const status = await getStatus();
      const next = Object.assign({}, status, patch || {});
      await set({ [KEYS.STATUS]: next });
      return next;
    }).catch(() => getStatus());
    return statusQueue;
  }

  /** Estadísticas rápidas para el popup. */
  function computeStats(rows) {
    const stats = {
      total: rows.length,
      conWeb: 0,
      sinWeb: 0,
      soloRedes: 0,
      conTelefono: 0,
      busquedas: new Set(),
      localidades: new Set()
    };
    for (const r of rows) {
      if (r.tiene_web === 'SI') stats.conWeb++; else stats.sinWeb++;
      if (r.solo_redes === 'SI') stats.soloRedes++;
      if (r.telefono) stats.conTelefono++;
      if (r.busqueda_origen) stats.busquedas.add(r.busqueda_origen);
      if (r.localidad) stats.localidades.add(r.localidad);
    }
    return {
      total: stats.total,
      conWeb: stats.conWeb,
      sinWeb: stats.sinWeb,
      soloRedes: stats.soloRedes,
      conTelefono: stats.conTelefono,
      busquedas: Array.from(stats.busquedas),
      localidades: Array.from(stats.localidades)
    };
  }

  /** ¿El estado dice "running" pero nadie lo refresca desde hace rato? */
  function isStaleRunning(status) {
    if (!status || !status.running) return false;
    if (!status.updatedAt) return false;
    return Date.now() - status.updatedAt > STATUS_STALE_MS;
  }

  global.ProspectStorage = {
    KEYS,
    STATUS_STALE_MS,
    isStaleRunning,
    DEFAULT_CONFIG,
    DEFAULT_STATUS,
    MAX_ROWS,
    keyOf,
    getRows,
    setRows,
    addRows,
    clearRows,
    getConfig,
    setConfig,
    getWarnings,
    addWarnings,
    setWarnings,
    getStatus,
    setStatus,
    computeStats
  };
})(typeof window !== 'undefined' ? window : globalThis);
