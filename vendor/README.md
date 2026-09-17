# vendor/

Vacío a propósito: la extensión **no usa ninguna librería de terceros**.

- El `.xlsx` se genera en `lib/export.js` escribiendo el OOXML mínimo dentro de un
  ZIP "stored" (método 0) construido a mano, con su propio CRC32. No hace falta
  SheetJS ni JSZip, y así no hay nada que auditar ni que actualizar.
- El CSV se genera también ahí, con BOM UTF-8 y separador `;`.

Si algún día necesitas algo que SheetJS haga y esto no (fórmulas, varias hojas con
estilos complejos, lectura de xlsx existentes):

1. Descarga `xlsx.full.min.js` y déjalo aquí como `vendor/xlsx.full.min.js`
   (fichero local: la CSP de MV3 no permite CDNs).
2. Cárgalo en `popup.html` **antes** de `lib/export.js`.
3. Sustituye `buildWorkbook()` por la llamada equivalente a `XLSX.write(...)`
   devolviendo un `Uint8Array`; el resto del flujo (base64 → `background.js` →
   `chrome.downloads`) no cambia.
