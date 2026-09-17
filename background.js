/**
 * background.js — service worker (MV3)
 * -----------------------------------------------------------------------------
 * Responsabilidades:
 *   1. Disparar las descargas (el SW no puede crear blob: URLs, así que el
 *      popup le manda el fichero ya codificado en base64 y aquí se convierte
 *      en una data: URL para chrome.downloads).
 *   2. Guardar el último estado de progreso emitido por el content script,
 *      para que el popup lo recupere aunque se haya cerrado y reabierto.
 *   3. Inicializar la configuración por defecto en la instalación.
 * -----------------------------------------------------------------------------
 */
importScripts('lib/storage.js');

const DB = self.ProspectStorage;

/* Último progreso conocido (memoria del SW; la fuente de verdad es storage) */
let lastProgress = null;

chrome.runtime.onInstalled.addListener(async () => {
  try {
    const cfg = await DB.getConfig();
    await DB.setConfig(cfg);          // fija los valores por defecto si faltan
    await DB.setStatus({ running: false, phase: 'idle' });
  } catch (err) {
    console.warn('[Prospección Maps] init:', err);
  }
});

chrome.runtime.onStartup.addListener(() => {
  /* Tras reiniciar el navegador no hay ninguna extracción viva */
  DB.setStatus({ running: false, phase: 'idle', current: '' }).catch(() => {});
});

/**
 * Lanza una descarga desde base64.
 * @returns {Promise<number>} downloadId
 */
function downloadBase64(base64, filename, mime) {
  return new Promise((resolve, reject) => {
    const url = `data:${mime || 'application/octet-stream'};base64,${base64}`;
    chrome.downloads.download(
      { url, filename, saveAs: false, conflictAction: 'uniquify' },
      (downloadId) => {
        const err = chrome.runtime.lastError;
        if (err) reject(new Error(err.message));
        else resolve(downloadId);
      }
    );
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'download') {
    downloadBase64(msg.base64, msg.filename, msg.mime)
      .then((downloadId) => sendResponse({ ok: true, downloadId }))
      .catch((err) => sendResponse({ ok: false, error: err.message || String(err) }));
    return true; // respuesta asíncrona
  }

  if (msg.type === 'progress' || msg.type === 'finished') {
    lastProgress = msg.payload || null;
    /* No respondemos: el popup escucha estos mensajes directamente. */
    return false;
  }

  if (msg.type === 'lastProgress') {
    sendResponse({ ok: true, payload: lastProgress });
    return false;
  }

  return false;
});
