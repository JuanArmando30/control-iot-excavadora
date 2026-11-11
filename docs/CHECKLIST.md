# Checklist de seguridad, accesibilidad y errores

## Seguridad
- [x] Página por HTTPS y socket por WSS; `HttpClient` y `WsClient` rechazan `http://` / `ws://` en una página HTTPS (sin mixed content).
- [x] Sin contraseñas, tokens, claves AWS ni datos de RDS en el repositorio; el navegador nunca habla con MySQL.
- [x] `X-API-Key` escrita por el usuario, validada con `GET /sesion`, en `sessionStorage` por defecto.
- [x] CORS del backend limitado al origen de GitHub Pages, métodos GET/POST y cabeceras `Content-Type`, `X-API-Key`, sin credenciales. CORS no se usa como autenticación.
- [x] Content-Security-Policy: scripts solo propios y de jsDelivr (con SRI), `connect-src` limitado a la API, sin `unsafe-inline`.
- [x] JSON remoto validado y reducido a campos conocidos (`validadores.js`); eventos WSS de otro vehículo se descartan.
- [x] Sin `innerHTML`: todo el texto remoto se inserta con `textContent` (sin inyección DOM).
- [x] `fetch` con `credentials: "omit"`, `referrerPolicy: "no-referrer"`, rutas restringidas al origen de la API.
- [x] Solo se envían códigos activos del catálogo; DETENER por nombre como en el backend.

## Resiliencia
- [x] Timeout por petición con `AbortController`; mensajes distintos para red/CORS, timeout, 400–503.
- [x] Una orden en vuelo; cola de un elemento (gana la última); duplicados ignorados.
- [x] DETENER: prioridad, reintento ante fallo de red y reafirmación si una orden previa llega tarde.
- [x] Respuestas tardías de salud ignoradas (número de secuencia).
- [x] WSS: reconexión exponencial con jitter, latido `ping/pong`, reconexión al volver la red o la pestaña, sin reconexión ante `4404`.
- [x] Al perder WSS, soltar el puntero, ocultar la pestaña o perder el foco: se suelta el joystick y se envía DETENER.
- [x] Giroscopio: DETENER al volver a neutral, al exceder ~65° (medido sin suavizar, sin órdenes intermedias), si el sensor calla 0.7 s, al girar la pantalla o perder el foco; DETENER lo pausa.
- [x] DEMO: una a la vez, estado resincronizado con `GET …/demos/ejecucion` al cargar, al reconectar y tras un 409.

## Accesibilidad
- [x] HTML semántico, enlace «Saltar al contenido», encabezados ordenados, `lang="es"`.
- [x] Foco visible (contorno cian de 3 px) en todos los controles.
- [x] Estados con texto + icono + color (no solo color); contraste de texto ≥ 4.5:1 sobre fondo oscuro.
- [x] Áreas táctiles ≥ 40 px (botones de los mandos 46–100 px según pantalla, DETENER ≥ 56 px; en horizontal ocupa el centro del mando).
- [x] Joysticks, crucetas, modos y DETENER utilizables con teclado.
- [x] Regiones `aria-live` para cambios de conectividad, joystick, DEMO y voz.
- [x] `prefers-reduced-motion` respetado.

## GitHub Pages
- [x] Rutas relativas (funciona en `/<repositorio>/`), `.nojekyll`.
- [x] Favicon ICO + PNG + apple-touch-icon + ícono maskable enlazados en los tres HTML.
- [x] Pie «Desarrollado por Juan Armando Castillo Rodríguez · 2026» en el flujo del documento, debajo del mando (sin superposición).
- [ ] Verificar en la URL publicada: favicon en la pestaña, pie visible, consola sin errores (requiere el parche CORS aplicado).
