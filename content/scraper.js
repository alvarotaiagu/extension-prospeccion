/**
 * content/scraper.js
 * -----------------------------------------------------------------------------
 * Orquestación: scroll del feed, extracción (modo RÁPIDO / COMPLETO),
 * deduplicación, persistencia incremental y reporte de progreso al popup.
 *
 * Todo el conocimiento del DOM está en selectors.js; toda la normalización,
 * en parsers.js. Aquí sólo hay flujo de control.
 * -----------------------------------------------------------------------------
 */
(function () {
  'use strict';

  if (window.__PROSPECT_MAPS_SCRAPER__) return;
  window.__PROSPECT_MAPS_SCRAPER__ = true;

  const S = window.MapsSelectors;
  const P = window.MapsParsers;
  const DB = window.ProspectStorage;

  /* ------------------------------------------------------------- estado */

  const state = {
    running: false,
    stopRequested: false,
    mode: 'rapido',
    limit: 200,
    query: '',
    extracted: 0,
    sinWeb: 0,
    estimated: 0,
    current: '',
    phase: 'idle',
    warnings: [],
    seen: new Set(),
    buffer: []
  };

  class StopError extends Error {}

  /* ----------------------------------------------------------- utilidades */

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const rand = (min, max) => Math.floor(min + Math.random() * (max - min));

  /** Pausa aleatoria, abortable por el botón Detener. */
  async function pause(min, max) {
    const total = rand(min, max);
    const step = 150;
    for (let waited = 0; waited < total; waited += step) {
      if (state.stopRequested) throw new StopError('stop');
      await sleep(Math.min(step, total - waited));
    }
    if (state.stopRequested) throw new StopError('stop');
  }

  function checkStop() {
    if (state.stopRequested) throw new StopError('stop');
  }

  /** Espera a que `fn()` devuelva algo truthy o se agote el tiempo. */
  async function waitFor(fn, timeout = 8000, interval = 250) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      checkStop();
      let value = null;
      try { value = fn(); } catch (_) { value = null; }
      if (value) return value;
      await sleep(interval);
    }
    return null;
  }

  function warn(scope, detail) {
    const msg = `[${scope}] ${detail}`;
    state.warnings.push(msg);
    if (state.warnings.length > 300) state.warnings.shift();
  }

  /* --------------------------------------------------- reporte de estado */

  let lastStatusWrite = 0;

  function statusSnapshot(extra) {
    return Object.assign({
      running: state.running,
      mode: state.mode,
      query: state.query,
      extracted: state.extracted,
      estimated: state.estimated,
      sinWeb: state.sinWeb,
      current: state.current,
      phase: state.phase,
      warnings: state.warnings.length,
      updatedAt: Date.now()
    }, extra || {});
  }

  function pushStatus(extra, force) {
    const snapshot = statusSnapshot(extra);
    /* Mensaje directo al popup (si está abierto) */
    try {
      chrome.runtime.sendMessage({ type: 'progress', payload: snapshot }, () => {
        void chrome.runtime.lastError; // popup cerrado: no es un error real
      });
    } catch (_) { /* contexto invalidado: ignorar */ }

    /* Persistencia para que el popup lo recupere al reabrirse */
    const now = Date.now();
    if (force || now - lastStatusWrite > 700) {
      lastStatusWrite = now;
      return DB.setStatus(snapshot).catch(() => {});
    }
    return Promise.resolve();
  }

  /* -------------------------------------------------- query de la búsqueda */

  function readQuery() {
    const input = S.pick(document, S.SELECTORS.searchInput);
    const fromInput = P.cleanText(input && input.value);
    if (fromInput) return fromInput;
    const m = location.pathname.match(/\/maps\/search\/([^/@]+)/);
    if (m) {
      try { return P.cleanText(decodeURIComponent(m[1]).replace(/\+/g, ' ')); }
      catch (_) { return P.cleanText(m[1].replace(/\+/g, ' ')); }
    }
    const q = new URL(location.href).searchParams.get('q');
    return P.cleanText(q);
  }

  /* --------------------------------------------------------- scroll feed */

  async function scrollFeed(limit) {
    const feed = S.getFeed(document);
    if (!feed) throw new Error('No se encontró el panel de resultados. Abre una búsqueda en Google Maps (listado a la izquierda) antes de iniciar.');

    state.phase = 'scroll';
    let stagnant = 0;
    let previous = 0;
    const MAX_STAGNANT = 5;

    while (true) {
      checkStop();
      const cards = S.getCards(feed);
      state.estimated = cards.length;
      state.current = `Cargando resultados… ${cards.length}`;
      pushStatus();

      if (cards.length >= limit) break;
      if (S.isEndOfList(feed, document)) break;

      if (cards.length === previous) {
        stagnant++;
        if (stagnant >= MAX_STAGNANT) break;
      } else {
        stagnant = 0;
        previous = cards.length;
      }

      /* Scroll real: scrollTop + evento wheel (Maps escucha ambos) */
      const last = cards[cards.length - 1];
      if (last && typeof last.scrollIntoView === 'function') {
        last.scrollIntoView({ block: 'end' });
      }
      feed.scrollTop = feed.scrollHeight;
      feed.dispatchEvent(new WheelEvent('wheel', {
        deltaY: 1200, bubbles: true, cancelable: true
      }));

      await pause(900, 2200);
    }

    const cards = S.getCards(feed);
    state.estimated = Math.min(cards.length, limit);
    pushStatus(null, true);
    return cards.slice(0, limit);
  }

  /* ------------------------------------------------ extracción de tarjeta */

  function extractCard(card) {
    const link = S.getCardLink(card);
    const href = link ? link.href : '';
    const nameEl = S.pick(card, S.SELECTORS.cardName);
    let nombre = P.cleanText(nameEl && nameEl.textContent);
    if (!nombre && link) {
      nombre = P.cleanText(link.getAttribute('aria-label')) || P.nameFromUrl(href);
    }

    const ratingEl = S.pick(card, S.SELECTORS.cardRating);
    const reviewsEl = S.pick(card, S.SELECTORS.cardReviews);
    const priceEl = S.pick(card, S.SELECTORS.cardPrice);

    /* Filas de metadatos: "Cafetería · Rúa Real 12" / "Abierto · Cierra 20:00" */
    const metaRows = S.pickAll(card, S.SELECTORS.cardMetaRows)
      .map((el) => P.cleanText(el.textContent))
      .filter(Boolean);

    let categoria = '';
    const subcats = [];
    let direccion = '';
    let telefono = '';

    for (const row of metaRows) {
      const tokens = P.splitMetaRow(row);
      for (const token of tokens) {
        if (!token) continue;
        if (/^(abierto|cerrado|open|closed|cierra|abre|temporalmente)/i.test(token)) continue;
        if (/^(€{1,4}|\${1,4})$/.test(token)) continue;
        const phone = P.extractPhone(token);
        if (!telefono && phone && /\d{6,}/.test(token.replace(/\D/g, ''))) {
          telefono = phone;
          continue;
        }
        /* Heurística: si tiene número de portal o vía, es dirección */
        if (!direccion && /\d/.test(token) && !/^\d+([.,]\d+)?$/.test(token)) {
          direccion = token;
          continue;
        }
        if (!categoria) { categoria = token; continue; }
        if (!direccion && /(calle|rúa|rua|avda|avenida|plaza|praza|carretera|ctra|camino|camiño|paseo|travesía|estrada|lugar|polígono)/i.test(token)) {
          direccion = token;
          continue;
        }
        if (subcats.length < 3 && token !== categoria && token !== direccion) {
          subcats.push(token);
        }
      }
    }

    const webEl = S.findExternalLink(card);
    const webUrl = webEl ? webEl.href : '';
    const coords = P.parseCoords(href);

    return {
      nombre,
      categoria,
      subcategorias: subcats.join(', '),
      direccion,
      telefono,
      web_url: webUrl,
      valoracion: P.cleanText(ratingEl && ratingEl.textContent),
      num_resenas: P.cleanText(reviewsEl && (reviewsEl.getAttribute('aria-label') || reviewsEl.textContent)),
      rango_precio: P.cleanText(priceEl && (priceEl.getAttribute('aria-label') || priceEl.textContent)),
      latitud: coords.latitud,
      longitud: coords.longitud,
      maps_url: href,
      place_id_o_cid: P.parsePlaceId(href),
      horario_resumen: '',
      fecha_extraccion: P.nowISO(),
      busqueda_origen: state.query
    };
  }

  /* -------------------------------------- extracción del panel de detalle */

  function extractDetail(fallback) {
    const panel = S.pick(document, S.SELECTORS.detailPanel) || document;
    const base = Object.assign({}, fallback || {});

    const nameEl = S.pick(panel, S.SELECTORS.detailName);
    const nombre = P.cleanText(nameEl && nameEl.textContent) || base.nombre;

    const catButtons = S.pickAll(panel, S.SELECTORS.detailCategory)
      .map((el) => P.cleanText(el.textContent))
      .filter(Boolean);
    const categoria = catButtons[0] || base.categoria || '';
    const subcategorias = catButtons.slice(1).join(', ') || base.subcategorias || '';

    const addrEl = S.pick(panel, S.SELECTORS.detailAddress);
    let direccion = '';
    if (addrEl) {
      direccion = P.cleanText(addrEl.getAttribute('aria-label') || addrEl.textContent)
        .replace(/^Dirección:\s*/i, '').replace(/^Address:\s*/i, '');
    }
    if (!direccion) direccion = base.direccion || '';

    const phoneEl = S.pick(panel, S.SELECTORS.detailPhone);
    let telefono = '';
    if (phoneEl) {
      const itemId = phoneEl.getAttribute('data-item-id') || '';
      const fromId = itemId.replace(/^phone:tel:/, '');
      telefono = P.normalizePhone(fromId) ||
        P.extractPhone(phoneEl.getAttribute('aria-label') || phoneEl.textContent);
    }
    if (!telefono) telefono = base.telefono || '';

    const webEl = S.pick(panel, S.SELECTORS.detailWebsite) || S.findExternalLink(panel);
    const web_url = webEl ? (webEl.href || webEl.getAttribute('href') || '') : (base.web_url || '');

    const ratingEl = S.pick(panel, S.SELECTORS.detailRating);
    const reviewsEl = S.pick(panel, S.SELECTORS.detailReviews);
    const priceEl = S.pick(panel, S.SELECTORS.detailPriceRange);

    /* Horario: primero el resumen con aria-label, luego la tabla desplegada */
    let horario = '';
    const hoursEl = S.pick(panel, S.SELECTORS.detailHoursSummary);
    if (hoursEl) {
      horario = P.cleanText(hoursEl.getAttribute('aria-label') || hoursEl.textContent);
    }
    if (!horario || horario.length < 12) {
      const rows = S.pickAll(panel, S.SELECTORS.detailHoursTable)
        .map((tr) => P.cleanText(tr.textContent));
      const joined = P.formatHours(rows);
      if (joined.length > horario.length) horario = joined;
    }

    const coords = P.parseCoords(location.href);
    const placeId = P.parsePlaceId(location.href) || base.place_id_o_cid || '';

    return {
      nombre,
      categoria,
      subcategorias,
      direccion,
      telefono,
      web_url,
      valoracion: P.cleanText(ratingEl && ratingEl.textContent) || base.valoracion || '',
      num_resenas: P.cleanText(reviewsEl && (reviewsEl.getAttribute('aria-label') || reviewsEl.textContent)) || base.num_resenas || '',
      rango_precio: P.cleanText(priceEl && (priceEl.getAttribute('aria-label') || priceEl.textContent)) || base.rango_precio || '',
      latitud: coords.latitud || base.latitud || '',
      longitud: coords.longitud || base.longitud || '',
      maps_url: location.href,
      place_id_o_cid: placeId,
      horario_resumen: horario,
      fecha_extraccion: P.nowISO(),
      busqueda_origen: state.query
    };
  }

  /* --------------------------------------------------- navegación detalle */

  async function openDetail(href) {
    const feed = S.getFeed(document);
    let link = null;
    if (feed) {
      link = feed.querySelector(`a[href="${CSS.escape(href)}"]`);
      if (!link) {
        link = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'))
          .find((a) => a.href === href) || null;
      }
    }
    if (!link) return false;

    link.scrollIntoView({ block: 'center' });
    await sleep(120);
    link.click();

    const loaded = await waitFor(() => {
      if (!/\/maps\/place\//.test(location.pathname)) return null;
      const h1 = S.pick(document, S.SELECTORS.detailName);
      return h1 && P.cleanText(h1.textContent) ? h1 : null;
    }, 9000, 250);
    if (!loaded) return false;

    /* Pequeña espera extra: teléfono/web se pintan un tick después del h1 */
    await sleep(500);
    return true;
  }

  async function backToFeed() {
    history.back();
    const ok = await waitFor(() => {
      const feed = S.getFeed(document);
      if (!feed) return null;
      const cards = S.getCards(feed);
      return cards.length ? cards : null;
    }, 9000, 250);
    if (!ok) {
      /* Segundo intento con el botón Atrás del panel */
      const btn = S.pick(document, S.SELECTORS.detailBackButton);
      if (btn) btn.click();
      await waitFor(() => {
        const feed = S.getFeed(document);
        return feed && S.getCards(feed).length ? true : null;
      }, 6000, 250);
    }
    await sleep(300);
  }

  /* ------------------------------------------------------ fila -> buffer */

  async function acceptRow(raw, contexto) {
    let row;
    try {
      row = P.buildRow(raw);
    } catch (err) {
      warn(contexto || 'fila', `no se pudo normalizar: ${err.message}`);
      return false;
    }
    if (!row.nombre && !row.maps_url) {
      warn(contexto || 'fila', 'tarjeta sin nombre ni enlace, descartada');
      return false;
    }
    const key = P.dedupeKey(row);
    if (state.seen.has(key)) return false;
    state.seen.add(key);

    state.buffer.push(row);
    state.extracted++;
    if (row.tiene_web === 'NO') state.sinWeb++;
    state.current = row.nombre;

    if (state.buffer.length >= 5) await flush();
    pushStatus();
    return true;
  }

  async function flush() {
    if (!state.buffer.length) return;
    const pending = state.buffer.splice(0, state.buffer.length);
    try {
      await DB.addRows(pending);
    } catch (err) {
      warn('storage', `no se pudieron guardar ${pending.length} filas: ${err.message}`);
    }
  }

  /* ------------------------------------------------------- bucle principal */

  async function runFast(cards) {
    state.phase = 'extraccion';
    for (let i = 0; i < cards.length; i++) {
      checkStop();
      if (state.extracted >= state.limit) break;
      try {
        await acceptRow(extractCard(cards[i]), `tarjeta #${i + 1}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        warn(`tarjeta #${i + 1}`, err.message);
      }
      if (i % 12 === 11) await sleep(120); // respiro para no bloquear la pestaña
    }
  }

  async function runFull(cards) {
    state.phase = 'extraccion';
    /* Snapshot de datos rápidos + hrefs: el DOM se re-renderiza al volver */
    const targets = cards.map((card, index) => {
      let base = null;
      try { base = extractCard(card); } catch (_) { base = null; }
      const link = S.getCardLink(card);
      return {
        index,
        href: link ? link.href : '',
        base: base || {}
      };
    }).filter((t) => t.href);

    if (!targets.length) {
      throw new Error('No se pudo obtener ningún enlace de ficha en el listado.');
    }

    for (const target of targets) {
      checkStop();
      if (state.extracted >= state.limit) break;

      state.current = P.cleanText(target.base.nombre) || `Ficha ${target.index + 1}`;
      pushStatus();

      let opened = false;
      try {
        opened = await openDetail(target.href);
      } catch (err) {
        if (err instanceof StopError) throw err;
        warn(`ficha #${target.index + 1}`, `error al abrir: ${err.message}`);
      }

      if (!opened) {
        warn(`ficha #${target.index + 1}`, `no se pudo abrir el detalle de "${state.current}". Se guardan los datos de la tarjeta.`);
        try { await acceptRow(target.base, `ficha #${target.index + 1}`); }
        catch (err) { if (err instanceof StopError) throw err; }
        await pause(1200, 2500);
        continue;
      }

      try {
        await acceptRow(extractDetail(target.base), `ficha #${target.index + 1}`);
      } catch (err) {
        if (err instanceof StopError) throw err;
        warn(`ficha #${target.index + 1}`, `error al extraer: ${err.message}`);
      }

      try {
        await backToFeed();
      } catch (err) {
        if (err instanceof StopError) throw err;
        warn(`ficha #${target.index + 1}`, `no se pudo volver al listado: ${err.message}`);
      }

      await pause(1200, 2500);
    }
  }

  async function start(config) {
    if (state.running) return { ok: false, error: 'Ya hay una extracción en curso.' };

    state.running = true;
    state.stopRequested = false;
    state.mode = (config && config.modo) === 'completo' ? 'completo' : 'rapido';
    state.limit = Math.max(1, parseInt((config && config.limite) || 200, 10) || 200);
    state.query = readQuery();
    state.extracted = 0;
    state.sinWeb = 0;
    state.estimated = 0;
    state.current = '';
    state.phase = 'inicio';
    state.warnings = [];
    state.seen = new Set();
    state.buffer = [];

    await DB.setWarnings([]);
    pushStatus({ startedAt: Date.now(), finishedAt: 0, message: '' }, true);

    let error = '';
    try {
      const cards = await scrollFeed(state.limit);
      if (!cards.length) throw new Error('El listado está vacío: no se encontraron tarjetas de resultados.');
      if (state.mode === 'completo') await runFull(cards);
      else await runFast(cards);
      state.phase = 'completado';
    } catch (err) {
      if (err instanceof StopError) {
        state.phase = 'detenido';
      } else {
        state.phase = 'error';
        error = err.message || String(err);
        warn('proceso', error);
      }
    }

    await flush();
    await DB.addWarnings(state.warnings);
    state.running = false;
    state.current = '';
    /* Esperamos la escritura final: si no, un progreso anterior podría pisarla
       y el popup mostraría una extracción "en curso" que ya terminó. */
    await pushStatus({ finishedAt: Date.now(), message: error }, true);

    try {
      chrome.runtime.sendMessage({
        type: 'finished',
        payload: statusSnapshot({ message: error, warnings: state.warnings.length })
      }, () => { void chrome.runtime.lastError; });
    } catch (_) { /* popup cerrado */ }

    return { ok: !error, error, extracted: state.extracted, sinWeb: state.sinWeb };
  }

  /* ------------------------------------------------------------ mensajería */

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || !msg.type) return false;

    if (msg.type === 'ping') {
      sendResponse({ ok: true, running: state.running, query: readQuery() });
      return false;
    }

    if (msg.type === 'status') {
      sendResponse({ ok: true, status: statusSnapshot(), warnings: state.warnings.slice(-50) });
      return false;
    }

    if (msg.type === 'stop') {
      state.stopRequested = true;
      state.phase = 'deteniendo';
      pushStatus(null, true);
      sendResponse({ ok: true });
      return false;
    }

    if (msg.type === 'start') {
      start(msg.config || {}).then(sendResponse).catch((err) => {
        sendResponse({ ok: false, error: err.message || String(err) });
      });
      return true; // respuesta asíncrona
    }

    return false;
  });

  /**
   * Handle de depuración: desde la consola de la pestaña de Maps puedes probar
   * los selectores tras un cambio de DOM sin recargar la extensión entera.
   *   __prospectMaps.cards().length
   *   __prospectMaps.testCard(0)
   *   __prospectMaps.testDetail()
   */
  window.__prospectMaps = {
    feed: () => S.getFeed(document),
    cards: () => S.getCards(S.getFeed(document)),
    testCard: (i) => extractCard(S.getCards(S.getFeed(document))[i || 0]),
    testDetail: () => extractDetail({}),
    status: () => statusSnapshot(),
    warnings: () => state.warnings.slice()
  };

  /* Si la pestaña se cierra a mitad, salvamos lo pendiente */
  window.addEventListener('beforeunload', () => {
    if (state.buffer.length) {
      const pending = state.buffer.splice(0, state.buffer.length);
      try { DB.addRows(pending); } catch (_) { /* best effort */ }
    }
  });
})();
