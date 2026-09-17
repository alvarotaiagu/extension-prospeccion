# Prospección Maps

Extensión de Chrome (Manifest V3, sin build step, sin dependencias) que extrae los
negocios de una búsqueda de Google Maps y los exporta a **Excel (.xlsx)** y **CSV**,
marcando de forma destacada los que **no tienen web** — el objetivo típico de una
campaña de prospección.

- JS vanilla + HTML + CSS. Cero frameworks, cero CDNs, cero recursos remotos.
- El `.xlsx` se genera escribiendo el OOXML mínimo a mano dentro de un ZIP propio
  (`lib/export.js`), así que `vendor/` está vacío a propósito.
- Los resultados se **acumulan** en `chrome.storage.local` entre búsquedas, para
  barrer varios municipios y exportar una sola hoja al final.

---

## 1. Instalación (carga sin empaquetar)

1. Descarga/clona esta carpeta en tu disco.
2. Abre `chrome://extensions`.
3. Activa **Modo de desarrollador** (arriba a la derecha).
4. Pulsa **Cargar descomprimida** y selecciona la carpeta del proyecto
   (la que contiene `manifest.json`).
5. Ancla la extensión a la barra de herramientas (icono del puzle → chincheta).

> Si ya tenías una pestaña de Google Maps abierta, **recárgala (F5)** después de
> instalar o de actualizar la extensión: el content script sólo se inyecta al cargar
> la página.

### Dominios soportados

Chrome no admite comodines en mitad del host (`https://www.google.*/maps/*` es
inválido), así que el manifest lista los TLD más habituales: `.com`, `.es`, `.pt`,
`.fr`, `.co.uk`, `.com.mx`, `.com.ar`, `.cl`, `.co`. Si usas otro, añádelo en
`manifest.json` en los dos sitios (`host_permissions` y `content_scripts[0].matches`)
y recarga la extensión.

---

## 2. Uso

1. En Google Maps busca lo que quieras prospectar: `cafeterías en Carballo`,
   `peluquerías A Coruña`… Asegúrate de que se ve el **listado de resultados** en el
   panel izquierdo (no la ficha de un solo negocio).
2. Abre el popup de la extensión.
3. Elige el modo:
   - **Rápido** — lee sólo lo visible en cada tarjeta del listado: nombre, valoración,
     nº de reseñas, categoría, dirección corta, teléfono si aparece y si hay botón de
     sitio web. Es el más veloz y suficiente para detectar quién no tiene web.
   - **Completo** — además abre cada ficha, y saca web real, teléfono completo,
     dirección completa con código postal, horario y coordenadas. Tarda ~2 s por
     negocio.
4. Fija el **máximo de resultados** (por defecto 200).
5. **Iniciar extracción**. Puedes cerrar el popup: el proceso sigue en la pestaña y
   guarda cada fila conforme la extrae. Al reabrir el popup verás el progreso.
6. **Detener** corta el bucle de forma limpia y conserva lo extraído hasta ese punto.
7. Repite con otras búsquedas: los resultados se **suman** al acumulado y se
   deduplican automáticamente.
8. Exporta:
   - **Exportar XLSX** → hoja `Negocios` + hoja `Resumen`.
   - **Exportar CSV** → BOM UTF-8 y separador `;` (Excel en español lo abre directo).
   - **Exportar sólo SIN web** → mismo XLSX filtrado a `tiene_web = NO`.
   - Nombre del fichero: `negocios_{busqueda_slug}_{YYYY-MM-DD}.xlsx`.
9. **Vaciar datos acumulados** (con confirmación) cuando empieces una campaña nueva.

Mientras corre verás: extraídos / estimados, el negocio en curso, y el contador
destacado de **sin web**. Al terminar, si hubo incidencias, aparece la lista de
avisos (ficha que no abrió, campo que no se encontró, etc.). Nunca se aborta el
proceso entero por un fallo puntual.

### Excel generado

- Hoja **Negocios**: todas las filas, cabecera en negrita sobre fondo oscuro,
  **fila congelada**, **autofiltro** activado y anchos de columna ajustados.
- Hoja **Resumen**: totales y porcentaje con web vs sin web, negocios por categoría
  y por localidad (con su propio % sin web).

---

## 3. Esquema de datos

Una fila por negocio, en este orden:

| Columna | Contenido |
| --- | --- |
| `nombre` | Nombre del negocio |
| `categoria` | Categoría principal de Maps, tal cual (en español) |
| `subcategorias` | Categorías adicionales, separadas por coma |
| `direccion` | Dirección tal y como la muestra Maps |
| `localidad` | Derivada de la dirección; vacía si no es fiable |
| `provincia` | Derivada de la dirección; sólo si coincide con una provincia real |
| `codigo_postal` | 5 dígitos, si aparece |
| `telefono` | Teléfono en formato legible |
| `telefono_e164` | `+34XXXXXXXXX` cuando el número es español; internacional si ya traía prefijo; vacío si no se puede normalizar |
| `tiene_web` | `SI` / `NO` |
| `solo_redes` | `SI` cuando la "web" es Facebook, Instagram, linktr.ee, wa.me, un portal tipo TripAdvisor/Booking, etc. En ese caso `tiene_web` = `NO` |
| `web_url` | URL real del botón "Sitio web" |
| `dominio` | Dominio de `web_url`, sin `www.` |
| `valoracion` | Ej. `4.7` |
| `num_resenas` | Entero |
| `rango_precio` | `€`, `€€`, `80–120 €`… |
| `latitud` / `longitud` | Parseadas de la URL `@lat,lng,zoom` |
| `maps_url` | Enlace al place |
| `place_id_o_cid` | CID estable (`0x...:0x...`) o `place_id`; es la clave de deduplicación |
| `horario_resumen` | Horario semanal compactado en una celda |
| `fecha_extraccion` | `YYYY-MM-DD HH:mm` |
| `busqueda_origen` | El query que había en la barra de búsqueda al lanzar la extracción |

**Reglas de normalización clave**

- Si no hay botón de sitio web → `tiene_web = NO`.
- Si la URL es de redes/agregador → `tiene_web = NO` **y** `solo_redes = SI`.
  Esta es la señal de prospección: un negocio que sólo vive en Instagram es cliente
  potencial igual que uno sin nada.
- Si un campo no se encuentra, se guarda cadena vacía. **No se inventan datos**:
  `localidad`/`provincia` se dejan vacías antes que adivinar.
- Deduplicación por CID; si no hay CID, por `nombre|dirección` normalizados.

---

## 4. Estructura de ficheros

```
manifest.json
popup.html / popup.css / popup.js   UI del popup
content/scraper.js                  orquestación: scroll, extracción, dedupe, progreso
content/selectors.js                TODOS los selectores y regex del DOM
content/parsers.js                  normalización de campos
background.js                       service worker: mensajería y descargas
lib/storage.js                      capa sobre chrome.storage.local
lib/export.js                       generación de XLSX (OOXML + ZIP propio) y CSV
vendor/                             vacío: no hace falta ninguna librería externa
icons/                              iconos de la extensión
```

**Permisos**: `storage`, `downloads`, `activeTab` y host permission sólo para
`https://www.google.<tld>/maps/*`. Nada más.

---

## 5. Mantenimiento: cuando Google cambie el DOM

Maps ofusca sus clases (`Nv2PK`, `hfpxzc`, `qBF1Pd`, `DUwDvf`…) y las rota cada
pocos meses. Cuando la extracción empiece a devolver campos vacíos, **sólo hay que
tocar `content/selectors.js`**: ahí está todo el conocimiento del DOM, y cada
selector es un array de candidatos (se usa el primero que matchee), con fallback
estructural cuando todos fallan.

### Cómo identificar los nuevos selectores

1. Abre la búsqueda en Google Maps y pulsa **F12** (DevTools).
2. Con el **inspector** (Ctrl+Shift+C), pincha sobre el elemento que falla (el nombre
   del negocio en una tarjeta, el botón "Sitio web", el teléfono de la ficha…).
3. En el panel *Elements*, mira la clase del nodo o, mejor, un atributo estable:
   `data-item-id`, `data-value`, `aria-label`, `role`, `jsaction`. **Prefiere siempre
   el atributo semántico a la clase ofuscada**: `button[data-item-id="address"]`
   sobrevive a los rediseños; `.rogA2c` no.
4. Comprueba el candidato en la consola antes de tocar código:
   ```js
   document.querySelectorAll('div[role="feed"] .TU_CLASE_NUEVA').length
   ```
5. Añade el selector nuevo **al principio** del array correspondiente en
   `content/selectors.js` (deja los antiguos detrás: no estorban y cubren otras
   versiones del layout de Maps).
6. Guarda, recarga la extensión en `chrome://extensions` (icono de refrescar) y
   **recarga la pestaña de Maps**.

### Depurar desde la consola de la pestaña

El content script expone un handle para probar sin recargar la extensión entera:

```js
__prospectMaps.feed()            // contenedor scrollable de resultados
__prospectMaps.cards().length    // nº de tarjetas detectadas
__prospectMaps.testCard(0)       // datos crudos extraídos de la 1ª tarjeta
__prospectMaps.testDetail()      // datos crudos de la ficha abierta (modo completo)
__prospectMaps.status()          // estado del scraper
__prospectMaps.warnings()        // avisos acumulados
```

Si `cards()` devuelve 0, el problema está en `SELECTORS.feed` / `SELECTORS.card`.
Si devuelve tarjetas pero `testCard(0)` trae campos vacíos, el problema está en los
selectores de esos campos concretos.

### Mapa rápido selector → campo

| Campo que falla | Clave en `SELECTORS` |
| --- | --- |
| No detecta el listado | `feed` |
| No detecta tarjetas | `card`, `cardLink` |
| Nombre vacío | `cardName`, `detailName` |
| Categoría/dirección vacías | `cardMetaRows`, `detailCategory`, `detailAddress` |
| `tiene_web` siempre NO | `cardWebsite`, `detailWebsite` |
| Teléfono vacío | `detailPhone`, `REGEX.phone`, `REGEX.phoneEs` |
| Valoración/reseñas | `cardRating`, `cardReviews`, `detailRating`, `detailReviews` |
| Horario vacío | `detailHoursSummary`, `detailHoursTable` |
| No para al final de la lista | `endOfList`, `END_OF_LIST_TEXTS` |
| No marca `solo_redes` | `SOCIAL_DOMAINS` |
| Coordenadas o CID vacíos | `REGEX.coords`, `REGEX.cid` |

---

## 6. Límites y responsabilidad

Esta extensión lee el DOM de Google Maps tal y como lo ve tu navegador. Eso implica
dos cosas:

- **Es frágil por naturaleza**: cualquier rediseño de Maps puede romper la extracción
  hasta que actualices `content/selectors.js`.
- **El scraping de Google Maps no está permitido por los Términos de Servicio de
  Google.** El uso de esta herramienta es bajo tu propia responsabilidad. Úsala a
  ritmo moderado (los delays aleatorios de 0,9–2,2 s entre scrolls y 1,2–2,5 s entre
  fichas están puestos por eso: no los bajes), con volúmenes razonables, y trata los
  datos de contacto conforme al RGPD si los vas a usar para prospección comercial.
  Para uso intensivo o comercial a gran escala, la vía correcta es la Places API.
