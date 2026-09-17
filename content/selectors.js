/**
 * selectors.js
 * -----------------------------------------------------------------------------
 * TODO el conocimiento del DOM de Google Maps vive aquí. Si Google cambia sus
 * clases ofuscadas (pasa cada pocos meses), este es el ÚNICO fichero a tocar.
 *
 * Convención: cada selector es un ARRAY de candidatos. Se usa el primero que
 * matchee. Cuando todos fallan, hay un fallback ESTRUCTURAL (buscar por forma
 * del DOM: href que contiene /maps/place/, aria-label, data-item-id, etc.),
 * que es mucho más estable que las clases.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const SELECTORS = {
    /* ---------------------------------------------------------------- feed */
    feed: [
      'div[role="feed"]',
      'div[aria-label][role="feed"]',
      '.m6QErb[aria-label]',
      '.ecceSd[role="region"]'
    ],

    /* Tarjeta de resultado dentro del feed */
    card: [
      'div.Nv2PK',
      'div.bfdHYd',
      'div[jsaction*="mouseover:pane"]'
    ],

    /* Enlace al place dentro de la tarjeta */
    cardLink: [
      'a.hfpxzc',
      'a[href*="/maps/place/"]'
    ],

    /* Nombre en la tarjeta */
    cardName: [
      '.qBF1Pd',
      '.NrDZNb',
      'div.fontHeadlineSmall'
    ],

    /* Valoración numérica en la tarjeta (ej. "4,7") */
    cardRating: [
      'span.MW4etd',
      'span[aria-label*="estrella"]',
      'span[aria-label*="star"]'
    ],

    /* Número de reseñas en la tarjeta (ej. "(128)") */
    cardReviews: [
      'span.UY7F9',
      'span[aria-label*="reseña"]',
      'span[aria-label*="review"]'
    ],

    /* Bloques de texto secundarios: categoría · dirección / horario · teléfono */
    cardMetaRows: [
      'div.W4Efsd > div.W4Efsd',
      'div.W4Efsd',
      'div.AJB7ye'
    ],

    /* Botón/enlace "Sitio web" dentro de la tarjeta del feed */
    cardWebsite: [
      'a[data-value="Sitio web"]',
      'a[data-value="Website"]',
      'a[aria-label^="Visitar el sitio web"]',
      'a[aria-label^="Visit"]',
      'a.lcr4fd'
    ],

    /* Rango de precios en la tarjeta (€, €€, €€€) */
    cardPrice: [
      'span[aria-label*="Precio"]',
      'span[aria-label*="Price"]',
      'span.e4rVHe'
    ],

    /* --------------------------------------------------- panel de detalle */
    detailPanel: [
      'div[role="main"][aria-label]',
      'div.m6QErb.WNBkOb',
      'div.TIHn2'
    ],

    detailName: [
      'h1.DUwDvf',
      'h1.fontHeadlineLarge',
      'div[role="main"] h1'
    ],

    detailCategory: [
      'button.DkEaL',
      'button[jsaction*="category"]',
      '.skqShb button'
    ],

    detailRating: [
      'div.F7nice span[aria-hidden="true"]',
      'span.ceNzKf[aria-label]',
      'div.fontDisplayLarge'
    ],

    detailReviews: [
      'div.F7nice span[aria-label*="reseña"]',
      'div.F7nice span[aria-label*="review"]',
      'button[jsaction*="reviewChart"] span'
    ],

    detailAddress: [
      'button[data-item-id="address"]',
      'button[data-tooltip="Copiar dirección"]',
      'button[data-tooltip="Copy address"]'
    ],

    detailWebsite: [
      'a[data-item-id="authority"]',
      'a[data-tooltip="Abrir sitio web"]',
      'a[data-tooltip="Open website"]',
      'a[aria-label^="Sitio web:"]',
      'a[aria-label^="Website:"]'
    ],

    detailPhone: [
      'button[data-item-id^="phone:tel:"]',
      'button[data-tooltip="Copiar número de teléfono"]',
      'button[data-tooltip="Copy phone number"]'
    ],

    detailPlusCode: [
      'button[data-item-id^="oloc"]',
      'button[data-tooltip="Copiar plus code"]'
    ],

    detailPriceRange: [
      'span[aria-label*="Precio"]',
      'span[aria-label*="Price"]',
      'div.fontBodyMedium span.mgr77e'
    ],

    /* Horario: el resumen colapsado y la tabla completa */
    detailHoursSummary: [
      'div.t39EBf[aria-label]',
      'div.OqCZI div.o0Svhf',
      'button[data-item-id="oh"]'
    ],
    detailHoursTable: [
      'table.eK4R0e tr',
      'div.t39EBf table tr'
    ],

    /* Botón atrás del panel (alternativa a history.back()) */
    detailBackButton: [
      'button[aria-label="Atrás"]',
      'button[aria-label="Back"]',
      'button.hYBOP'
    ],

    /* ------------------------------------------------------------ varios */
    searchInput: [
      'input#searchboxinput',
      'input[name="q"]',
      'input[aria-label="Buscar en Google Maps"]',
      'input[aria-label="Search Google Maps"]'
    ],

    /* Nodo con el texto "Has llegado al final de la lista" */
    endOfList: [
      'span.HlvSq',
      'div.PbZDve p',
      'div.m6QErb span.HlvSq'
    ]
  };

  /* Textos que indican final de la lista (multi-idioma) */
  const END_OF_LIST_TEXTS = [
    'has llegado al final de la lista',
    "you've reached the end of the list",
    'you have reached the end of the list',
    'chegaste ao fim da lista',
    'vous êtes arrivé à la fin de la liste',
    'chegou ao final da lista'
  ];

  /* Dominios que NO cuentan como web propia (señal clave de prospección) */
  const SOCIAL_DOMAINS = [
    'facebook.com', 'fb.com', 'fb.me', 'm.facebook.com',
    'instagram.com', 'instagr.am',
    'linktr.ee', 'linktree.com', 'beacons.ai', 'bio.link', 'campsite.bio',
    'wa.me', 'api.whatsapp.com', 'whatsapp.com', 'chat.whatsapp.com',
    'twitter.com', 'x.com', 'tiktok.com', 'youtube.com', 'youtu.be',
    'business.site', 'negocio.site', 'sites.google.com',
    'linkedin.com', 'pinterest.com', 'telegram.me', 't.me',
    'tripadvisor.com', 'tripadvisor.es', 'thefork.es', 'eltenedor.es',
    'booking.com', 'airbnb.es', 'airbnb.com', 'just-eat.es', 'glovoapp.com',
    'ubereats.com', 'doctoralia.es', 'milanuncios.com', 'paginasamarillas.es',
    'yelp.com', 'yelp.es', 'treatwell.es', 'planity.com'
  ];

  /* Regex reutilizables */
  const REGEX = {
    /* Coordenadas de la URL: /@43.213,-8.690,17z */
    coords: /@(-?\d+\.\d+),(-?\d+\.\d+)(?:,([\d.]+)z)?/,
    /* Identificador estable del place dentro del href: !1s0x...:0x... */
    cid: /!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i,
    /* Variante hexadecimal alternativa en data= */
    cidAlt: /(0x[0-9a-f]{8,}:0x[0-9a-f]{4,})/i,
    /* place_id explícito (raro en el href del feed, frecuente en URLs share) */
    placeId: /[?&](?:place_id|placeid)=([A-Za-z0-9_-]{10,})/,
    /* Teléfonos: internacional o nacional con separadores */
    phone: /(?:\+\d{1,3}[\s.\-]?)?(?:\(?\d{2,4}\)?[\s.\-]?){2,5}\d{2,4}/,
    phoneEs: /(?:\+?34[\s.\-]?)?[6789]\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}[\s.\-]?\d{2}/,
    /* Código postal español de 5 dígitos */
    cpEs: /\b(\d{5})\b/,
    /* Valoración tipo 4,7 o 4.7 */
    rating: /^(\d(?:[.,]\d)?)$/,
    /* Número de reseñas entre paréntesis */
    reviews: /\(?\s*([\d.,\s]+)\s*\)?/,
    /* Rango de precio */
    price: /^(€{1,4}|\${1,4}|\d+\s*[-–]\s*\d+\s*€)$/
  };

  /**
   * Devuelve el primer elemento que matchee alguno de los candidatos.
   */
  function pick(root, candidates) {
    if (!root || !candidates) return null;
    for (const sel of candidates) {
      try {
        const el = root.querySelector(sel);
        if (el) return el;
      } catch (_) { /* selector inválido tras un cambio: seguimos */ }
    }
    return null;
  }

  /**
   * Devuelve TODOS los elementos del primer candidato que produzca resultados.
   */
  function pickAll(root, candidates) {
    if (!root || !candidates) return [];
    for (const sel of candidates) {
      try {
        const els = root.querySelectorAll(sel);
        if (els && els.length) return Array.from(els);
      } catch (_) { /* ignorar */ }
    }
    return [];
  }

  /**
   * Fallback estructural: localiza el contenedor scrollable de resultados
   * aunque `div[role="feed"]` desaparezca, buscando el elemento con más
   * enlaces a /maps/place/ y con scroll propio.
   */
  function findFeedStructural(doc) {
    const links = Array.from(doc.querySelectorAll('a[href*="/maps/place/"]'));
    if (!links.length) return null;
    const scores = new Map();
    for (const link of links) {
      let node = link.parentElement;
      let depth = 0;
      while (node && depth < 8) {
        scores.set(node, (scores.get(node) || 0) + 1);
        node = node.parentElement;
        depth++;
      }
    }
    let best = null;
    let bestScore = 0;
    for (const [node, score] of scores.entries()) {
      const scrollable = node.scrollHeight > node.clientHeight + 40;
      const weight = score * (scrollable ? 2 : 1);
      if (weight > bestScore) { bestScore = weight; best = node; }
    }
    return best;
  }

  /** Contenedor scrollable de resultados (selector + fallback estructural). */
  function getFeed(doc) {
    return pick(doc, SELECTORS.feed) || findFeedStructural(doc);
  }

  /**
   * Tarjetas del feed. Si las clases fallan, reconstruye las tarjetas a partir
   * de los enlaces /maps/place/ subiendo al ancestro común razonable.
   */
  function getCards(feed) {
    if (!feed) return [];
    const byClass = pickAll(feed, SELECTORS.card);
    if (byClass.length) return byClass;

    const links = Array.from(feed.querySelectorAll('a[href*="/maps/place/"]'));
    const cards = [];
    const seen = new Set();
    for (const link of links) {
      let node = link.parentElement;
      let hops = 0;
      while (node && hops < 4 && node !== feed) {
        if (node.textContent && node.textContent.trim().length > 10) break;
        node = node.parentElement;
        hops++;
      }
      const card = node && node !== feed ? node : link;
      if (!seen.has(card)) { seen.add(card); cards.push(card); }
    }
    return cards;
  }

  /** Enlace al place dentro de una tarjeta (con fallback por href). */
  function getCardLink(card) {
    const direct = pick(card, SELECTORS.cardLink);
    if (direct) return direct;
    const anchors = Array.from(card.querySelectorAll('a[href]'));
    return anchors.find((a) => (a.getAttribute('href') || '').includes('/maps/place/')) || null;
  }

  /**
   * Enlace a web externa dentro de una tarjeta o panel: cualquier <a> cuyo href
   * no apunte a google/maps ni sea tel:/mailto:.
   */
  function findExternalLink(root) {
    if (!root) return null;
    const direct = pick(root, SELECTORS.cardWebsite);
    if (direct && direct.getAttribute('href')) return direct;
    const anchors = Array.from(root.querySelectorAll('a[href]'));
    for (const a of anchors) {
      const href = a.getAttribute('href') || '';
      if (!/^https?:\/\//i.test(href)) continue;
      if (/(^|\/\/)([a-z0-9-]+\.)*google\.[a-z.]+\//i.test(href)) continue;
      if (/goo\.gl|gstatic\.com|googleusercontent\.com/i.test(href)) continue;
      return a;
    }
    return null;
  }

  /** ¿Aparece en pantalla el texto de "fin de la lista"? */
  function isEndOfList(feed, doc) {
    const scopes = [feed, doc].filter(Boolean);
    for (const scope of scopes) {
      const nodes = pickAll(scope, SELECTORS.endOfList);
      for (const n of nodes) {
        const txt = (n.textContent || '').trim().toLowerCase();
        if (END_OF_LIST_TEXTS.some((t) => txt.includes(t))) return true;
      }
    }
    /* Fallback: buscar el texto en la cola del feed */
    if (feed) {
      const tail = (feed.textContent || '').slice(-400).toLowerCase();
      if (END_OF_LIST_TEXTS.some((t) => tail.includes(t))) return true;
    }
    return false;
  }

  global.MapsSelectors = {
    SELECTORS,
    REGEX,
    SOCIAL_DOMAINS,
    END_OF_LIST_TEXTS,
    pick,
    pickAll,
    getFeed,
    getCards,
    getCardLink,
    findExternalLink,
    findFeedStructural,
    isEndOfList
  };
})(typeof window !== 'undefined' ? window : globalThis);
