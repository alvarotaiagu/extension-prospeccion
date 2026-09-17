/**
 * lib/export.js
 * -----------------------------------------------------------------------------
 * Generación de XLSX y CSV sin dependencias externas.
 *
 * El .xlsx se escribe a mano como OOXML mínimo dentro de un ZIP "stored"
 * (método 0, sin compresión) construido aquí mismo. Excel, LibreOffice y
 * Google Sheets abren este formato sin problema, y así evitamos meter SheetJS
 * o JSZip en vendor/ (cero código de terceros, cero CDNs, CSP de MV3 contenta).
 *
 * Si algún día prefieres SheetJS: déjalo en vendor/xlsx.full.min.js, cárgalo en
 * popup.html antes de este fichero y sustituye buildWorkbook().
 * -----------------------------------------------------------------------------
 */
(function (global) {
  'use strict';

  /* Orden y etiqueta de las columnas de la hoja "Negocios" */
  const COLUMNS = [
    { key: 'nombre',           label: 'nombre',           width: 34 },
    { key: 'categoria',        label: 'categoria',        width: 22 },
    { key: 'subcategorias',    label: 'subcategorias',    width: 24 },
    { key: 'direccion',        label: 'direccion',        width: 42 },
    { key: 'localidad',        label: 'localidad',        width: 18 },
    { key: 'provincia',        label: 'provincia',        width: 16 },
    { key: 'codigo_postal',    label: 'codigo_postal',    width: 12 },
    { key: 'telefono',         label: 'telefono',         width: 16 },
    { key: 'telefono_e164',    label: 'telefono_e164',    width: 16 },
    { key: 'tiene_web',        label: 'tiene_web',        width: 10 },
    { key: 'solo_redes',       label: 'solo_redes',       width: 11 },
    { key: 'web_url',          label: 'web_url',          width: 38 },
    { key: 'dominio',          label: 'dominio',          width: 24 },
    { key: 'valoracion',       label: 'valoracion',       width: 11, num: true },
    { key: 'num_resenas',      label: 'num_resenas',      width: 12, num: true },
    { key: 'rango_precio',     label: 'rango_precio',     width: 12 },
    { key: 'latitud',          label: 'latitud',          width: 12, num: true },
    { key: 'longitud',         label: 'longitud',         width: 12, num: true },
    { key: 'maps_url',         label: 'maps_url',         width: 46 },
    { key: 'place_id_o_cid',   label: 'place_id_o_cid',   width: 26 },
    { key: 'horario_resumen',  label: 'horario_resumen',  width: 48 },
    { key: 'fecha_extraccion', label: 'fecha_extraccion', width: 17 },
    { key: 'busqueda_origen',  label: 'busqueda_origen',  width: 26 }
  ];

  /* ------------------------------------------------------------------ ZIP */

  const CRC_TABLE = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) {
      crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ bytes[i]) & 0xff];
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  const encoder = new TextEncoder();
  const utf8 = (str) => encoder.encode(str);

  function dosDateTime(date) {
    const d = date || new Date();
    const time = ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) |
      (Math.floor(d.getSeconds() / 2) & 0x1f);
    const dateBits = (((d.getFullYear() - 1980) & 0x7f) << 9) |
      (((d.getMonth() + 1) & 0x0f) << 5) | (d.getDate() & 0x1f);
    return { time: time, date: dateBits };
  }

  /**
   * ZIP sin compresión (método 0). entries: [{ name, data: string|Uint8Array }]
   */
  function zip(entries, when) {
    const stamp = dosDateTime(when);
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const entry of entries) {
      const nameBytes = utf8(entry.name);
      const dataBytes = entry.data instanceof Uint8Array ? entry.data : utf8(entry.data);
      const crc = crc32(dataBytes);

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);            // versión mínima
      lv.setUint16(6, 0x0800, true);        // flag: nombres en UTF-8
      lv.setUint16(8, 0, true);             // método 0 = stored
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, dataBytes.length, true);
      lv.setUint32(22, dataBytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      local.set(nameBytes, 30);

      chunks.push(local, dataBytes);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, stamp.time, true);
      cv.setUint16(14, stamp.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, dataBytes.length, true);
      cv.setUint32(24, dataBytes.length, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + dataBytes.length;
    }

    let centralSize = 0;
    for (const cd of central) centralSize += cd.length;

    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, central.length, true);
    ev.setUint16(10, central.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);

    const out = new Uint8Array(offset + centralSize + end.length);
    let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    for (const c of central) { out.set(c, pos); pos += c.length; }
    out.set(end, pos);
    return out;
  }

  /* ----------------------------------------------------------------- XML */

  const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(CONTROL_CHARS, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Índice 0 -> "A", 25 -> "Z", 26 -> "AA" */
  function colName(index) {
    let n = index + 1;
    let name = '';
    while (n > 0) {
      const rem = (n - 1) % 26;
      name = String.fromCharCode(65 + rem) + name;
      n = Math.floor((n - 1) / 26);
    }
    return name;
  }

  function isNumeric(value) {
    if (value === '' || value === null || value === undefined) return false;
    return /^-?\d+(\.\d+)?$/.test(String(value).trim());
  }

  /**
   * rows: array de arrays de celdas { v, num?, style? }
   */
  function sheetXml(rows, opts) {
    const options = opts || {};
    const cols = options.cols || [];
    const parts = [];
    parts.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
    parts.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">');

    const maxCols = rows.reduce((m, r) => Math.max(m, r.length), 1);
    parts.push('<dimension ref="A1:' + colName(maxCols - 1) + Math.max(rows.length, 1) + '"/>');

    if (options.freezeHeader) {
      parts.push('<sheetViews><sheetView workbookViewId="0">' +
        '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
        '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
        '</sheetView></sheetViews>');
    } else {
      parts.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
    }

    parts.push('<sheetFormatPr defaultRowHeight="15"/>');

    if (cols.length) {
      parts.push('<cols>');
      cols.forEach((width, i) => {
        parts.push('<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + width + '" customWidth="1"/>');
      });
      parts.push('</cols>');
    }

    parts.push('<sheetData>');
    rows.forEach((cells, rowIndex) => {
      const r = rowIndex + 1;
      parts.push('<row r="' + r + '">');
      cells.forEach((cell, colIndex) => {
        if (cell === null || cell === undefined) return;
        const ref = colName(colIndex) + r;
        const style = cell.style ? ' s="' + cell.style + '"' : '';
        const value = cell.v;
        if (value === '' || value === null || value === undefined) {
          if (style) parts.push('<c r="' + ref + '"' + style + '/>');
          return;
        }
        if (cell.num && isNumeric(value)) {
          parts.push('<c r="' + ref + '"' + style + '><v>' + String(value).trim() + '</v></c>');
        } else {
          parts.push('<c r="' + ref + '"' + style + ' t="inlineStr"><is><t xml:space="preserve">' +
            esc(value) + '</t></is></c>');
        }
      });
      parts.push('</row>');
    });
    parts.push('</sheetData>');

    if (options.autoFilterRef) {
      parts.push('<autoFilter ref="' + options.autoFilterRef + '"/>');
    }

    parts.push('</worksheet>');
    return parts.join('');
  }

  const STYLES_XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3">' +
      '<font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
      '<fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FF11284A"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="2">' +
      '<border><left/><right/><top/><bottom/><diagonal/></border>' +
      '<border><left/><right/><top/><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>' +
    '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
      '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const STYLE_HEADER = 1;   // cabecera blanca sobre fondo oscuro
  const STYLE_BOLD = 2;     // negrita simple (hoja Resumen)

  /* ------------------------------------------------------------- resumen */

  function countBy(rows, key) {
    const map = new Map();
    for (const row of rows) {
      const value = String(row[key] || '').trim() || '(sin dato)';
      const entry = map.get(value) || { total: 0, sinWeb: 0 };
      entry.total++;
      if (row.tiene_web === 'NO') entry.sinWeb++;
      map.set(value, entry);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({ name: name, total: v.total, sinWeb: v.sinWeb }))
      .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'es'));
  }

  function pct(part, total) {
    if (!total) return '0%';
    return (Math.round((part / total) * 1000) / 10) + '%';
  }

  function summaryRows(rows, meta) {
    const total = rows.length;
    const conWeb = rows.filter((r) => r.tiene_web === 'SI').length;
    const sinWeb = total - conWeb;
    const soloRedes = rows.filter((r) => r.solo_redes === 'SI').length;
    const conTelefono = rows.filter((r) => r.telefono).length;
    const busquedas = Array.from(new Set(rows.map((r) => r.busqueda_origen).filter(Boolean)));

    const text = (v, style) => ({ v: v, style: style || 0 });
    const num = (v, style) => ({ v: v, num: true, style: style || 0 });

    const out = [];
    out.push([text('Resumen de extracción', STYLE_BOLD)]);
    out.push([text('Generado', STYLE_BOLD), text((meta && meta.generated) || '')]);
    out.push([text('Búsquedas incluidas', STYLE_BOLD), text(busquedas.join(' | '))]);
    out.push([]);
    out.push([text('Métrica', STYLE_HEADER), text('Valor', STYLE_HEADER), text('%', STYLE_HEADER)]);
    out.push([text('Negocios totales'), num(total), text('100%')]);
    out.push([text('Con web propia'), num(conWeb), text(pct(conWeb, total))]);
    out.push([text('SIN web (objetivo)'), num(sinWeb), text(pct(sinWeb, total))]);
    out.push([text('Sólo redes sociales'), num(soloRedes), text(pct(soloRedes, total))]);
    out.push([text('Con teléfono'), num(conTelefono), text(pct(conTelefono, total))]);
    out.push([]);

    out.push([text('Negocios por categoría', STYLE_BOLD)]);
    out.push([text('Categoría', STYLE_HEADER), text('Negocios', STYLE_HEADER),
      text('Sin web', STYLE_HEADER), text('% sin web', STYLE_HEADER)]);
    countBy(rows, 'categoria').forEach((c) => {
      out.push([text(c.name), num(c.total), num(c.sinWeb), text(pct(c.sinWeb, c.total))]);
    });
    out.push([]);

    out.push([text('Negocios por localidad', STYLE_BOLD)]);
    out.push([text('Localidad', STYLE_HEADER), text('Negocios', STYLE_HEADER),
      text('Sin web', STYLE_HEADER), text('% sin web', STYLE_HEADER)]);
    countBy(rows, 'localidad').forEach((c) => {
      out.push([text(c.name), num(c.total), num(c.sinWeb), text(pct(c.sinWeb, c.total))]);
    });

    return out;
  }

  /* ------------------------------------------------------------- workbook */

  function buildWorkbook(rows, meta) {
    const dataRows = [];
    dataRows.push(COLUMNS.map((c) => ({ v: c.label, style: STYLE_HEADER })));
    rows.forEach((row) => {
      dataRows.push(COLUMNS.map((c) => ({
        v: row[c.key] === undefined ? '' : row[c.key],
        num: !!c.num
      })));
    });

    const lastCol = colName(COLUMNS.length - 1);
    const lastRow = Math.max(dataRows.length, 2);

    const sheet1 = sheetXml(dataRows, {
      cols: COLUMNS.map((c) => c.width),
      freezeHeader: true,
      autoFilterRef: 'A1:' + lastCol + lastRow
    });

    const sheet2 = sheetXml(summaryRows(rows, meta), { cols: [34, 14, 12, 12] });

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>';

    const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="Negocios" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Resumen" sheetId="2" r:id="rId2"/>' +
      '</sheets>' +
      '<definedNames>' +
      '<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">' +
      'Negocios!$A$1:$' + lastCol + '$' + lastRow + '</definedName>' +
      '</definedNames>' +
      '</workbook>';

    const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>';

    const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
    const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
      'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
      'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>' + esc((meta && meta.title) || 'Negocios Google Maps') + '</dc:title>' +
      '<dc:creator>Prospección Maps</dc:creator>' +
      '<cp:lastModifiedBy>Prospección Maps</cp:lastModifiedBy>' +
      '<dcterms:created xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:created>' +
      '<dcterms:modified xsi:type="dcterms:W3CDTF">' + nowIso + '</dcterms:modified>' +
      '</cp:coreProperties>';

    const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" ' +
      'xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>Prospeccion Maps</Application></Properties>';

    return zip([
      { name: '[Content_Types].xml', data: contentTypes },
      { name: '_rels/.rels', data: rels },
      { name: 'docProps/core.xml', data: core },
      { name: 'docProps/app.xml', data: app },
      { name: 'xl/workbook.xml', data: workbook },
      { name: 'xl/_rels/workbook.xml.rels', data: workbookRels },
      { name: 'xl/styles.xml', data: STYLES_XML },
      { name: 'xl/worksheets/sheet1.xml', data: sheet1 },
      { name: 'xl/worksheets/sheet2.xml', data: sheet2 }
    ]);
  }

  /* ------------------------------------------------------------------ CSV */

  /**
   * Neutraliza fórmulas para que Excel no las evalúe. Se respeta el "+" de los
   * teléfonos E.164 (+34...), que no es una fórmula válida y sí un dato útil.
   */
  function csvCell(value) {
    let v = value === null || value === undefined ? '' : String(value);
    v = v.replace(/\r?\n/g, ' ').trim();
    if (/^[=@]/.test(v) || /^[+\-](?![0-9])/.test(v)) v = "'" + v;
    if (/[";]/.test(v)) v = '"' + v.replace(/"/g, '""') + '"';
    return v;
  }

  /** CSV con BOM UTF-8 y separador ';' (Excel en español lo abre directo). */
  function buildCsv(rows) {
    const lines = [];
    lines.push(COLUMNS.map((c) => c.label).join(';'));
    rows.forEach((row) => {
      lines.push(COLUMNS.map((c) => csvCell(row[c.key])).join(';'));
    });
    return '﻿' + lines.join('\r\n') + '\r\n';
  }

  /* -------------------------------------------------------------- helpers */

  function slug(value) {
    const base = String(value || '')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '').slice(0, 60);
    return base || 'busqueda';
  }

  function today() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /** negocios_{busqueda_slug}_{YYYY-MM-DD}.xlsx */
  function filename(query, ext, prefix) {
    return (prefix || 'negocios') + '_' + slug(query) + '_' + today() + '.' + ext;
  }

  /** Uint8Array | string -> base64 (para pasar la descarga al service worker). */
  function toBase64(input) {
    const bytes = input instanceof Uint8Array ? input : utf8(String(input));
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
  }

  global.ProspectExport = {
    COLUMNS: COLUMNS,
    buildWorkbook: buildWorkbook,
    buildCsv: buildCsv,
    filename: filename,
    slug: slug,
    today: today,
    toBase64: toBase64,
    zip: zip,
    crc32: crc32,
    MIME_XLSX: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    MIME_CSV: 'text/csv'
  };
})(typeof window !== 'undefined' ? window : globalThis);
