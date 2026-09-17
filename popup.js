/**
 * popup.js
 * -----------------------------------------------------------------------------
 * UI: configuración, arranque/parada, contadores en vivo, exportación y
 * vaciado del acumulador.
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  const DB = window.ProspectStorage;
  const EX = window.ProspectExport;

  const $ = (id) => document.getElementById(id);

  const el = {
    modo: $('modo'),
    limite: $('limite'),
    modoHint: $('modoHint'),
    btnStart: $('btnStart'),
    btnStop: $('btnStop'),
    btnXlsx: $('btnXlsx'),
    btnCsv: $('btnCsv'),
    btnXlsxSinWeb: $('btnXlsxSinWeb'),
    btnClear: $('btnClear'),
    btnClearYes: $('btnClearYes'),
    btnClearNo: $('btnClearNo'),
    clearConfirm: $('clearConfirm'),
    clearCount: $('clearCount'),
    tabQuery: $('tabQuery'),
    badgeTotal: $('badgeTotal'),
    cExtracted: $('cExtracted'),
    cEstimated: $('cEstimated'),
    cCurrent: $('cCurrent'),
    progressBar: $('progressBar'),
    cSinWeb: $('cSinWeb'),
    cTotal: $('cTotal'),
    cConWeb: $('cConWeb'),
    cSoloRedes: $('cSoloRedes'),
    warnBox: $('warnBox'),
    warnToggle: $('warnToggle'),
    warnCount: $('warnCount'),
    warnList: $('warnList'),
    msg: $('msg')
  };

  let running = false;
  let pollTimer = null;

  /* ------------------------------------------------------------- helpers */

  function showMsg(text, kind) {
    if (!text) {
      el.msg.hidden = true;
      el.msg.textContent = '';
      return;
    }
    el.msg.hidden = false;
    el.msg.textContent = text;
    el.msg.className = 'msg' + (kind ? ' ' + kind : '');
  }

  function activeTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve((tabs && tabs[0]) || null);
      });
    });
  }

  function isMapsUrl(url) {
    return /^https:\/\/www\.google\.[a-z.]+\/maps/.test(url || '');
  }

  function sendToTab(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          const err = chrome.runtime.lastError;
          if (err) resolve({ ok: false, error: err.message });
          else resolve(response || { ok: false, error: 'sin respuesta' });
        });
      } catch (err) {
        resolve({ ok: false, error: err.message || String(err) });
      }
    });
  }

  function sendToBackground(message) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(message, (response) => {
        const err = chrome.runtime.lastError;
        if (err) resolve({ ok: false, error: err.message });
        else resolve(response || { ok: false, error: 'sin respuesta' });
      });
    });
  }

  /* --------------------------------------------------------------- render */

  function setRunning(value) {
    running = value;
    el.btnStart.hidden = value;
    el.btnStop.hidden = !value;
    el.modo.disabled = value;
    el.limite.disabled = value;
    el.btnXlsx.disabled = value;
    el.btnCsv.disabled = value;
    el.btnXlsxSinWeb.disabled = value;
    el.btnClear.disabled = value;
  }

  function renderStatus(status) {
    if (!status) return;

    /* La pestaña que extraía se cerró o se recargó: el estado quedó colgado */
    if (DB.isStaleRunning(status)) {
      status = Object.assign({}, status, { running: false, phase: 'idle', current: '' });
      DB.setStatus({ running: false, phase: 'idle', current: '' });
    }

    setRunning(!!status.running);
    el.cExtracted.textContent = status.extracted || 0;
    el.cEstimated.textContent = status.estimated || 0;

    const pct = status.estimated
      ? Math.min(100, Math.round((status.extracted / status.estimated) * 100))
      : 0;
    el.progressBar.style.width = pct + '%';

    const phaseText = {
      idle: 'Sin actividad',
      inicio: 'Preparando…',
      scroll: 'Cargando listado…',
      extraccion: 'Extrayendo…',
      deteniendo: 'Deteniendo…',
      detenido: 'Detenido por el usuario',
      completado: 'Extracción completada',
      error: 'Error'
    }[status.phase] || '';

    el.cCurrent.textContent = status.current
      ? (status.running ? '▶ ' + status.current : status.current)
      : phaseText || '—';

    if (status.message) showMsg(status.message, 'error');
  }

  function renderStats(rows) {
    const stats = DB.computeStats(rows);
    el.cTotal.textContent = stats.total;
    el.cConWeb.textContent = stats.conWeb;
    el.cSinWeb.textContent = stats.sinWeb;
    el.cSoloRedes.textContent = stats.soloRedes;
    el.badgeTotal.textContent = stats.total + ' acumulados';
    el.clearCount.textContent = stats.total;

    const hasRows = stats.total > 0;
    el.btnXlsx.disabled = running || !hasRows;
    el.btnCsv.disabled = running || !hasRows;
    el.btnXlsxSinWeb.disabled = running || !stats.sinWeb;
  }

  function renderWarnings(warnings) {
    const list = warnings || [];
    el.warnBox.hidden = list.length === 0;
    el.warnCount.textContent = list.length;
    el.warnList.innerHTML = '';
    list.slice(-60).forEach((w) => {
      const li = document.createElement('li');
      li.textContent = w;
      el.warnList.appendChild(li);
    });
  }

  /* ---------------------------------------------------------------- carga */

  async function refresh() {
    const [rows, status, warnings] = await Promise.all([
      DB.getRows(), DB.getStatus(), DB.getWarnings()
    ]);
    renderStatus(status);
    renderStats(rows);
    renderWarnings(warnings);
  }

  async function init() {
    const cfg = await DB.getConfig();
    el.modo.value = cfg.modo;
    el.limite.value = cfg.limite;

    const tab = await activeTab();
    if (tab && isMapsUrl(tab.url)) {
      const pong = await sendToTab(tab.id, { type: 'ping' });
      if (pong.ok) {
        el.tabQuery.textContent = pong.query ? 'Búsqueda: ' + pong.query : 'Google Maps listo';
        if (pong.running) setRunning(true);
      } else {
        el.tabQuery.textContent = 'Recarga la pestaña de Maps (F5) para activar';
      }
    } else {
      el.tabQuery.textContent = 'Abre una búsqueda en Google Maps';
    }

    await refresh();

    pollTimer = setInterval(async () => {
      const status = await DB.getStatus();
      renderStatus(status);
      if (status.running) {
        const rows = await DB.getRows();
        renderStats(rows);
      }
    }, 1500);
  }

  /* ------------------------------------------------------------- acciones */

  async function start() {
    showMsg('');
    const tab = await activeTab();
    if (!tab || !isMapsUrl(tab.url)) {
      showMsg('Abre primero una búsqueda en Google Maps (con el listado de resultados a la izquierda).', 'error');
      return;
    }

    const config = {
      modo: el.modo.value,
      limite: Math.max(1, parseInt(el.limite.value, 10) || 200)
    };
    await DB.setConfig(config);

    setRunning(true);
    showMsg('Extracción en marcha. Puedes cerrar el popup: sigue trabajando en la pestaña.', 'ok');

    const res = await sendToTab(tab.id, { type: 'start', config });
    if (!res.ok) {
      setRunning(false);
      const needsReload = /Receiving end does not exist|Could not establish connection/i.test(res.error || '');
      showMsg(needsReload
        ? 'La pestaña de Maps no tiene el script cargado. Recárgala (F5) y vuelve a intentarlo.'
        : 'No se pudo iniciar: ' + res.error, 'error');
    }
    await refresh();
  }

  async function stop() {
    const tab = await activeTab();
    if (tab) await sendToTab(tab.id, { type: 'stop' });
    showMsg('Deteniendo… se guardará lo extraído hasta ahora.', 'ok');
  }

  /** Plan B: descarga con blob: URL desde el propio popup. */
  function downloadFromPopup(payload, filename, mime) {
    return new Promise((resolve) => {
      let url = '';
      try {
        url = URL.createObjectURL(new Blob([payload], { type: mime }));
      } catch (err) {
        resolve({ ok: false, error: err.message || String(err) });
        return;
      }
      chrome.downloads.download(
        { url, filename, saveAs: false, conflictAction: 'uniquify' },
        (downloadId) => {
          const err = chrome.runtime.lastError;
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          if (err) resolve({ ok: false, error: err.message });
          else resolve({ ok: true, downloadId });
        }
      );
    });
  }

  async function exportRows(rows, query, prefix, format) {
    if (!rows.length) {
      showMsg('No hay datos para exportar.', 'error');
      return;
    }
    try {
      let payload;
      let filename;
      let mime;

      if (format === 'csv') {
        payload = EX.buildCsv(rows);
        filename = EX.filename(query, 'csv', prefix);
        mime = EX.MIME_CSV + ';charset=utf-8';
      } else {
        payload = EX.buildWorkbook(rows, {
          generated: new Date().toLocaleString('es-ES'),
          title: 'Negocios ' + query
        });
        filename = EX.filename(query, 'xlsx', prefix);
        mime = EX.MIME_XLSX;
      }

      /* Vía normal: el service worker dispara la descarga desde una data: URL */
      let res = await sendToBackground({
        type: 'download', base64: EX.toBase64(payload), filename, mime
      });
      /* Si el SW no pudo, lo intentamos desde aquí con un blob: URL */
      if (!res.ok) res = await downloadFromPopup(payload, filename, mime);

      if (res.ok) showMsg('Descargado: ' + filename, 'ok');
      else showMsg('No se pudo descargar: ' + res.error, 'error');
    } catch (err) {
      showMsg('Error generando el fichero: ' + (err.message || err), 'error');
    }
  }

  /** Nombre de búsqueda para el fichero: una sola búsqueda o "N-busquedas". */
  function queryLabel(rows) {
    const set = new Set(rows.map((r) => r.busqueda_origen).filter(Boolean));
    if (set.size === 1) return Array.from(set)[0];
    if (set.size === 0) return 'busqueda';
    return set.size + '-busquedas';
  }

  async function doExport(format, onlyNoWeb) {
    showMsg('Generando fichero…');
    const all = await DB.getRows();
    const rows = onlyNoWeb ? all.filter((r) => r.tiene_web === 'NO') : all;
    await exportRows(rows, queryLabel(rows), onlyNoWeb ? 'negocios_sin_web' : 'negocios', format);
  }

  async function clearAll() {
    await DB.clearRows();
    await DB.setStatus({ extracted: 0, sinWeb: 0, estimated: 0, current: '', phase: 'idle' });
    el.clearConfirm.hidden = true;
    showMsg('Datos acumulados borrados.', 'ok');
    await refresh();
  }

  /* -------------------------------------------------------------- eventos */

  el.btnStart.addEventListener('click', start);
  el.btnStop.addEventListener('click', stop);
  el.btnXlsx.addEventListener('click', () => doExport('xlsx', false));
  el.btnCsv.addEventListener('click', () => doExport('csv', false));
  el.btnXlsxSinWeb.addEventListener('click', () => doExport('xlsx', true));

  el.btnClear.addEventListener('click', () => { el.clearConfirm.hidden = false; });
  el.btnClearNo.addEventListener('click', () => { el.clearConfirm.hidden = true; });
  el.btnClearYes.addEventListener('click', clearAll);

  el.warnToggle.addEventListener('click', () => {
    el.warnList.hidden = !el.warnList.hidden;
  });

  el.modo.addEventListener('change', () => {
    DB.setConfig({ modo: el.modo.value });
    el.modoHint.textContent = el.modo.value === 'completo'
      ? 'Completo: abre cada ficha (web, teléfono, horario, coordenadas). ~2 s por negocio.'
      : 'Rápido: sólo lo visible en el listado. ~1–2 min por búsqueda.';
  });

  el.limite.addEventListener('change', () => {
    const value = Math.max(1, Math.min(1000, parseInt(el.limite.value, 10) || 200));
    el.limite.value = value;
    DB.setConfig({ limite: value });
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg || !msg.payload) return;
    if (msg.type === 'progress') {
      renderStatus(msg.payload);
    } else if (msg.type === 'finished') {
      renderStatus(msg.payload);
      refresh();
      if (!msg.payload.message) {
        showMsg('Extracción terminada: ' + msg.payload.extracted + ' negocios (' +
          msg.payload.sinWeb + ' sin web).', 'ok');
      }
    }
  });

  window.addEventListener('unload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });

  init().catch((err) => showMsg('Error al iniciar el popup: ' + err.message, 'error'));
})();
