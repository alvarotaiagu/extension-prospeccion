/**
 * parsers.js
 * -----------------------------------------------------------------------------
 * Normalización de campos: teléfono, dirección, localidad/provincia, dominio,
 * coordenadas, identificador de place, valoraciones y horarios.
 *
 * Regla de oro: si un dato no se puede derivar con fiabilidad, se devuelve
 * cadena vacía. Nunca se inventa.
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  const SOCIAL = (global.MapsSelectors && global.MapsSelectors.SOCIAL_DOMAINS) || [];
  const RX = (global.MapsSelectors && global.MapsSelectors.REGEX) || {};

  /* Provincias españolas + variantes habituales en Maps */
  const PROVINCIAS = [
    'A Coruña', 'La Coruña', 'Álava', 'Araba', 'Albacete', 'Alicante', 'Alacant',
    'Almería', 'Asturias', 'Ávila', 'Badajoz', 'Baleares', 'Illes Balears',
    'Barcelona', 'Burgos', 'Cáceres', 'Cádiz', 'Cantabria', 'Castellón',
    'Castelló', 'Ceuta', 'Ciudad Real', 'Córdoba', 'Cuenca', 'Girona', 'Gerona',
    'Granada', 'Guadalajara', 'Gipuzkoa', 'Guipúzcoa', 'Huelva', 'Huesca',
    'Jaén', 'León', 'Lleida', 'Lérida', 'Lugo', 'Madrid', 'Málaga', 'Melilla',
    'Murcia', 'Navarra', 'Nafarroa', 'Ourense', 'Orense', 'Palencia',
    'Las Palmas', 'Pontevedra', 'La Rioja', 'Salamanca', 'Santa Cruz de Tenerife',
    'Segovia', 'Sevilla', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia',
    'València', 'Valladolid', 'Bizkaia', 'Vizcaya', 'Zamora', 'Zaragoza'
  ];

  const PAISES = ['españa', 'spain', 'portugal', 'france', 'francia', 'méxico',
    'mexico', 'argentina', 'chile', 'colombia', 'united kingdom', 'reino unido'];

  /* Prefijos provinciales españoles fijos → primer dígito del CP */
  function stripAccents(str) {
    return (str || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }

  function cleanText(value) {
    if (value === null || value === undefined) return '';
    return String(value)
      .replace(/[\u00a0\u202f\u2009]/g, ' ')   // espacios raros de Maps
      .replace(/[·•⋅]/g, '·')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeKey(value) {
    return stripAccents(cleanText(value)).toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function slugify(value) {
    const base = stripAccents(cleanText(value)).toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return base || 'busqueda';
  }

  function todayISO(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function nowISO(date) {
    const d = date instanceof Date ? date : new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${todayISO(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  /* ------------------------------------------------------------- teléfono */

  /** Extrae el primer teléfono plausible de un texto libre. */
  function extractPhone(text) {
    const t = cleanText(text);
    if (!t) return '';
    const es = RX.phoneEs && t.match(RX.phoneEs);
    if (es) return cleanText(es[0]);
    const any = RX.phone && t.match(RX.phone);
    if (!any) return '';
    const candidate = cleanText(any[0]);
    const digits = candidate.replace(/\D/g, '');
    if (digits.length < 9 || digits.length > 15) return '';
    return candidate;
  }

  function normalizePhone(raw) {
    const t = cleanText(raw).replace(/^tel:/i, '');
    if (!t) return '';
    /* Mantiene el formato legible que muestra Maps, limpiando basura */
    return t.replace(/[^\d+()\s.\-]/g, '').replace(/\s+/g, ' ').trim();
  }

  /**
   * Convierte a E.164. Sólo asume +34 cuando el número encaja con el plan de
   * numeración español (9 dígitos empezando por 6,7,8,9). En otro caso,
   * devuelve el internacional si ya venía con prefijo, o cadena vacía.
   */
  function toE164(raw, defaultCountry) {
    const cc = defaultCountry || '34';
    const t = cleanText(raw).replace(/^tel:/i, '');
    if (!t) return '';
    const hadPlus = t.trim().startsWith('+') || /^00\d/.test(t.replace(/\s/g, ''));
    let digits = t.replace(/\D/g, '');
    if (!digits) return '';
    if (digits.startsWith('00')) digits = digits.slice(2);

    if (hadPlus) {
      if (digits.length < 8 || digits.length > 15) return '';
      return `+${digits}`;
    }
    if (digits.startsWith('34') && digits.length === 11 && /^[6789]/.test(digits.slice(2))) {
      return `+${digits}`;
    }
    if (digits.length === 9 && /^[6789]/.test(digits)) {
      return `+${cc}${digits}`;
    }
    if (digits.length >= 10 && digits.length <= 15) {
      return `+${digits}`;
    }
    return '';
  }

  /* ------------------------------------------------------------ dirección */

  function matchProvincia(part) {
    const key = normalizeKey(part);
    if (!key) return '';
    for (const p of PROVINCIAS) {
      if (normalizeKey(p) === key) return p;
    }
    /* "Coruña, A" o "Rioja, La" invertidos */
    const inverted = cleanText(part).match(/^(.+),\s*(A|La|Las|El|Los|Illes)$/i);
    if (inverted) {
      const rebuilt = `${inverted[2]} ${inverted[1]}`;
      for (const p of PROVINCIAS) {
        if (normalizeKey(p) === normalizeKey(rebuilt)) return p;
      }
    }
    return '';
  }

  function isCountry(part) {
    const key = stripAccents(cleanText(part)).toLowerCase();
    return PAISES.some((c) => stripAccents(c).toLowerCase() === key);
  }

  /**
   * Parsea una dirección completa de Maps.
   * Formatos típicos:
   *   "R. do Sol, 12, 15100 Carballo, A Coruña, España"
   *   "Av. de Finisterre, 25, 15004 A Coruña"
   *   "Praza do Concello, s/n, 15100 Carballo"
   * Devuelve { direccion, localidad, provincia, codigo_postal }.
   */
  function parseAddress(raw) {
    const out = { direccion: '', localidad: '', provincia: '', codigo_postal: '' };
    const full = cleanText(raw).replace(/^Dirección:\s*/i, '').replace(/^Address:\s*/i, '');
    if (!full) return out;
    out.direccion = full;

    let parts = full.split(',').map((p) => cleanText(p)).filter(Boolean);
    /* Quitar país final */
    while (parts.length && isCountry(parts[parts.length - 1])) parts.pop();
    if (!parts.length) return out;

    /* Provincia explícita al final */
    const lastProv = matchProvincia(parts[parts.length - 1]);
    if (lastProv && parts.length > 1) {
      out.provincia = lastProv;
      parts = parts.slice(0, -1);
    }

    /* Buscar el tramo con código postal: "15100 Carballo" */
    for (let i = parts.length - 1; i >= 0; i--) {
      const m = parts[i].match(/^(\d{5})\s*(.*)$/);
      if (m) {
        out.codigo_postal = m[1];
        const loc = cleanText(m[2]);
        if (loc) out.localidad = loc;
        else if (parts[i + 1]) out.localidad = cleanText(parts[i + 1]);
        break;
      }
      const m2 = parts[i].match(/^(.*?)[\s,]+(\d{5})$/);
      if (m2) {
        out.codigo_postal = m2[2];
        if (cleanText(m2[1])) out.localidad = cleanText(m2[1]);
        break;
      }
    }

    /* Sin CP: sólo aceptamos localidad si hay provincia identificada detrás */
    if (!out.localidad && out.provincia && parts.length >= 2) {
      out.localidad = parts[parts.length - 1];
    }

    /* Si la "localidad" quedó igual que la provincia, es capital de provincia */
    if (out.localidad && out.provincia &&
        normalizeKey(out.localidad) === normalizeKey(out.provincia)) {
      out.localidad = out.provincia;
    }

    /* Deducir provincia a partir de la localidad cuando coincide con una */
    if (!out.provincia && out.localidad) {
      const prov = matchProvincia(out.localidad);
      if (prov) out.provincia = prov;
    }

    /* Filtro anti-basura: localidades absurdas (números sueltos, s/n, etc.) */
    if (/^(s\/n|\d+|bajo|local.*)$/i.test(out.localidad || '')) out.localidad = '';

    return out;
  }

  /* -------------------------------------------------------------- web/url */

  function domainFromUrl(url) {
    const u = cleanText(url);
    if (!u) return '';
    try {
      const parsed = new URL(u.startsWith('http') ? u : `https://${u}`);
      return parsed.hostname.replace(/^www\./i, '').toLowerCase();
    } catch (_) {
      const m = u.match(/^(?:https?:\/\/)?(?:www\.)?([^/\s?#]+)/i);
      return m ? m[1].toLowerCase() : '';
    }
  }

  /** ¿La "web" es en realidad un perfil de redes / agregador? */
  function isSocialDomain(url) {
    const d = domainFromUrl(url);
    if (!d) return false;
    return SOCIAL.some((s) => d === s || d.endsWith(`.${s}`));
  }

  /* Google envuelve a veces los enlaces salientes en /url?q=... */
  function unwrapGoogleUrl(url) {
    const u = cleanText(url);
    if (!u) return '';
    try {
      const parsed = new URL(u, 'https://www.google.com');
      if (/google\./i.test(parsed.hostname) && parsed.pathname === '/url') {
        const target = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (target) return target;
      }
      return parsed.href;
    } catch (_) {
      return u;
    }
  }

  /* ---------------------------------------------------------- coordenadas */

  function parseCoords(url) {
    const u = cleanText(url);
    const out = { latitud: '', longitud: '' };
    if (!u || !RX.coords) return out;
    const m = u.match(RX.coords);
    if (m) { out.latitud = m[1]; out.longitud = m[2]; return out; }
    /* Fallback: !3dLAT!4dLNG dentro del parámetro data= */
    const alt = u.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (alt) { out.latitud = alt[1]; out.longitud = alt[2]; }
    return out;
  }

  /** Identificador estable del place: CID hexadecimal o place_id. */
  function parsePlaceId(url) {
    const u = cleanText(url);
    if (!u) return '';
    if (RX.cid) {
      const m = u.match(RX.cid);
      if (m) return m[1];
    }
    if (RX.placeId) {
      const m = u.match(RX.placeId);
      if (m) return m[1];
    }
    const cidParam = u.match(/[?&]cid=(\d+)/);
    if (cidParam) return `cid:${cidParam[1]}`;
    if (RX.cidAlt) {
      const m = u.match(RX.cidAlt);
      if (m) return m[1];
    }
    return '';
  }

  /** Nombre del place tal y como viaja en la URL (/maps/place/NOMBRE/...) */
  function nameFromUrl(url) {
    const m = cleanText(url).match(/\/maps\/place\/([^/@]+)/);
    if (!m) return '';
    try {
      return cleanText(decodeURIComponent(m[1]).replace(/\+/g, ' '));
    } catch (_) {
      return cleanText(m[1].replace(/\+/g, ' '));
    }
  }

  /* ------------------------------------------------- ratings y categorías */

  function parseRating(raw) {
    const t = cleanText(raw).replace(',', '.');
    const m = t.match(/(\d(?:\.\d)?)/);
    if (!m) return '';
    const n = parseFloat(m[1]);
    if (isNaN(n) || n < 0 || n > 5) return '';
    return String(n);
  }

  function parseReviewCount(raw) {
    const t = cleanText(raw);
    if (!t) return '';
    const m = t.match(/([\d][\d.,\s]*)/);
    if (!m) return '';
    const digits = m[1].replace(/[^\d]/g, '');
    if (!digits) return '';
    return String(parseInt(digits, 10));
  }

  /**
   * Separa "Cafetería · Calle Real 12" en categoría + resto.
   * Maps usa "·" como separador en las tarjetas del feed.
   */
  function splitMetaRow(raw) {
    const t = cleanText(raw);
    if (!t) return [];
    return t.split('·').map((s) => cleanText(s)).filter(Boolean);
  }

  function parsePriceRange(raw) {
    const t = cleanText(raw);
    if (!t) return '';
    /* Primero el rango numérico ("80–120 €"), que es más informativo */
    const range = t.match(/(\d+\s*[-–]\s*\d+\s*(?:€|\$|EUR))/i);
    if (range) return cleanText(range[1]);
    const m = t.match(/(€{1,4}|\${1,4})/);
    return m ? m[1] : '';
  }

  /** Compacta el horario semanal en una sola celda legible. */
  function formatHours(rows) {
    if (!rows || !rows.length) return '';
    return rows
      .map((r) => cleanText(r).replace(/\s*,\s*/g, ', '))
      .filter(Boolean)
      .join(' | ')
      .slice(0, 500);
  }

  /**
   * Clave de deduplicación: CID si existe, si no nombre|dirección normalizados.
   */
  function dedupeKey(row) {
    const pid = cleanText(row.place_id_o_cid);
    if (pid) return `id:${pid.toLowerCase()}`;
    return `na:${normalizeKey(row.nombre)}|${normalizeKey(row.direccion)}`;
  }

  /**
   * Construye la fila final aplicando todas las reglas de normalización.
   */
  function buildRow(data) {
    const addr = parseAddress(data.direccion || '');
    const webRaw = unwrapGoogleUrl(data.web_url || '');
    const dominio = domainFromUrl(webRaw);
    const soloRedes = webRaw ? isSocialDomain(webRaw) : false;
    const tieneWeb = webRaw && !soloRedes ? 'SI' : 'NO';
    const telefono = normalizePhone(data.telefono || '');

    return {
      nombre: cleanText(data.nombre),
      categoria: cleanText(data.categoria),
      subcategorias: cleanText(data.subcategorias),
      direccion: addr.direccion || cleanText(data.direccion),
      localidad: cleanText(data.localidad) || addr.localidad,
      provincia: cleanText(data.provincia) || addr.provincia,
      codigo_postal: cleanText(data.codigo_postal) || addr.codigo_postal,
      telefono,
      telefono_e164: toE164(telefono),
      tiene_web: tieneWeb,
      solo_redes: soloRedes ? 'SI' : 'NO',
      web_url: webRaw,
      dominio,
      valoracion: parseRating(data.valoracion),
      num_resenas: parseReviewCount(data.num_resenas),
      rango_precio: parsePriceRange(data.rango_precio),
      latitud: cleanText(data.latitud),
      longitud: cleanText(data.longitud),
      maps_url: cleanText(data.maps_url),
      place_id_o_cid: cleanText(data.place_id_o_cid),
      horario_resumen: cleanText(data.horario_resumen),
      fecha_extraccion: cleanText(data.fecha_extraccion) || nowISO(),
      busqueda_origen: cleanText(data.busqueda_origen)
    };
  }

  global.MapsParsers = {
    PROVINCIAS,
    stripAccents,
    cleanText,
    normalizeKey,
    slugify,
    todayISO,
    nowISO,
    extractPhone,
    normalizePhone,
    toE164,
    parseAddress,
    matchProvincia,
    domainFromUrl,
    isSocialDomain,
    unwrapGoogleUrl,
    parseCoords,
    parsePlaceId,
    nameFromUrl,
    parseRating,
    parseReviewCount,
    splitMetaRow,
    parsePriceRange,
    formatHours,
    dedupeKey,
    buildRow
  };
})(typeof window !== 'undefined' ? window : globalThis);
