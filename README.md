# Control · Excavadora IoT (frontend para GitHub Pages)

Aplicación web estática (HTML5 + CSS3 + Bootstrap 5 + JavaScript ES modules, sin compilación) con tres secciones:

| Sección | Archivo | Qué hace | ¿Clave? |
|---|---|---|---|
| **Control** | `index.html` | Una sola pantalla sin scroll con un mando horizontal: control de **conducción** (izquierda), control de **brazo y pala** (derecha), centro con luz, sonido, encendido, **Demo** y DETENER; indicadores WSS · AWS · RDS integrados en el menú superior; 5 modos de manejo (Pulso, Joystick, Voz, Giroscopio e IA con gestos de la mano) | Operador |
| **Monitoreo** | `monitoreo.html` | Conectividad, estado registrado, DEMO (seleccionar, iniciar, cancelar, avance), historial, catálogo y eventos WSS | Consultar: no · DEMO: Operador |
| **Administración / Configuración** | `administracion.html` | Vehículos, comandos, DEMO y sus pasos (endpoints existentes); configuración y clave | Operador (eliminar: Admin) |

Backend existente (no se modifica su lógica ni los 21 procedimientos): FastAPI en Amazon EC2 + Amazon RDS MySQL.

| Recurso | URL |
|---|---|
| API | `https://vehiculos-juan.duckdns.org` |
| Swagger | `https://vehiculos-juan.duckdns.org/docs` |
| WebSocket | `wss://vehiculos-juan.duckdns.org/ws/vehiculos/1` |
| Salud API | `GET /health` → `{"estado":"ok"}` |
| Salud RDS | `GET /health/db` → `{"estado":"ok"}` o `503` |

---

## 1. Arquitectura y flujo de datos

```
┌───────────────────────── Navegador (GitHub Pages, HTTPS) ─────────────────────────┐
│  pages/  control.js · monitoreo.js · administracion.js   ← conectan vista y dominio│
│     │                                                                              │
│  ui/     joystick · botonera · voz · demo-panel · conectividad-panel · modales     │
│     │        (solo DOM, eventos y estados visuales; nada de fetch)                 │
│  domain/ ComandoService (único envío) · Catalogo · DemoService ·                   │
│          ConectividadService · interprete-voz                                      │
│     │                                                                              │
│  api/    vehiculo-api.js  (rutas reales + validación de cada respuesta)            │
│  core/   http-client (fetch, timeout, errores) · ws-client (WSS, reconexión) ·     │
│          validadores (JSON no confiable) · clave-store (X-API-Key del usuario)     │
└───────────────┬──────────────────────────────────────────┬────────────────────────┘
          HTTPS │ GET consulta / POST acción              │ WSS (eventos)
                ▼                                          ▼
        Caddy (443) ──► Uvicorn/FastAPI ──► 21 SP ──► Amazon RDS MySQL
```

**Movimiento individual:** botón/joystick/voz/teclado → `ComandoService.enviar()` → valida contra el catálogo → `POST /vehiculos/1/movimientos {codigo, origen}` → 201 (registrado) → el backend difunde `movimiento_individual` por WSS → el estado de la página se actualiza **desde el evento**.

**DEMO:** `POST /vehiculos/1/demos/{id}/iniciar` → 202 → el backend emite `demo_iniciada`, N × `demo_movimiento`, `demo_finalizada` (o `demo_cancelada`). El navegador no conoce ni reproduce los pasos.

**Conectividad:** WSS = eventos `open/close/error` del socket + latido `ping/pong`; API = `GET /health`; RDS = `GET /health/db` (si la API no responde, RDS queda *Sin verificar*). Ninguno marca al vehículo físico como conectado.

## 2. Estructura

```
control-vehiculo-iot/
├── index.html                 Control
├── monitoreo.html             Monitoreo
├── administracion.html        Administración / Configuración
├── .nojekyll                  GitHub Pages sirve los archivos tal cual
├── assets/
│   ├── css/app.css            Estilos propios (Mobile First) sobre Bootstrap
│   ├── icons/                 favicon.ico, favicon-32, apple-touch-icon, icon-192/512, icon-maskable-512, sprite.svg
│   ├── modelos/               gesture_recognizer.task (modelo de MediaPipe para el modo IA, ~8 MB, Apache 2.0)
│   ├── site.webmanifest
│   └── js/
│       ├── config.js              URL base, WSS, rutas, vehículo, tiempos, mandos, interruptores, acceso de prueba
│       ├── core/                  http-client · ws-client · validadores · clave-store
│       ├── api/vehiculo-api.js    Una función por endpoint real
│       ├── domain/                catalogo · comando-service · demo-service · demo-preferida · conectividad-service · interprete-voz · interprete-gestos
│       ├── ui/                    dom · joystick · giroscopio · gestos · botonera · voz · carga · demo-visor · demo-panel · conectividad-panel · modales · clave-dialog
│       └── pages/                 comun · control · monitoreo · administracion
└── docs/
    ├── PRUEBAS.md             Casos de prueba paso a paso
    └── CHECKLIST.md           Seguridad, accesibilidad y errores
```

Todas las rutas son **relativas** (`assets/...`, `assets/js/...`), por eso funcionan en la subruta `https://juanarmando30.github.io/<repositorio>/`.

## 3. Contrato de la API usado (validado contra el código del backend)

| Uso | Método y ruta | Respuesta usada |
|---|---|---|
| Catálogo | `GET /vehiculos/1/comandos` | `[{id_comando, nombre, codigo, descripcion, activo}]` |
| Movimiento | `POST /vehiculos/1/movimientos` `{"codigo": 1, "origen": "WEB_JOYSTICK"}` | 201 `{comando, codigo, clientes_notificados, …}` |
| DEMO (lista) | `GET /vehiculos/1/demos` | `[{id_demo, nombre, descripcion, activo}]` |
| Iniciar DEMO | `POST /vehiculos/1/demos/{id}/iniciar` | 202 `{nombre, total_movimientos, clientes_websocket, …}` |
| Cancelar DEMO | `POST /vehiculos/1/demos/cancelar` | 200 / 409 si no hay DEMO |
| ¿DEMO corriendo? | `GET /vehiculos/1/demos/ejecucion` | `{en_ejecucion, movimientos_emitidos, total_movimientos, …}` |
| Validar clave | `GET /sesion` (X-API-Key) | `{rol: "operador"|"admin"}` |
| Estado / historial | `GET /vehiculos/1/estado` · `GET /vehiculos/1/historial` | ver Swagger |
| Administración | `POST /vehiculos`, `…/actualizar`, `…/eliminar`, comandos, DEMO y pasos | ver Swagger |

Eventos WSS (formato común `{evento, id_vehiculo, comando, codigo, timestamp, datos}`): `estado_inicial`, `estado_actualizado`, `movimiento_individual`, `demo_iniciada`, `demo_movimiento`, `demo_finalizada`, `demo_cancelada`, `error`, `pong`.

Si Swagger cambia, solo se editan `assets/js/config.js` (rutas) y `assets/js/core/validadores.js` (campos).

## 4. Configuración (sin secretos)

Todo está en `assets/js/config.js`. Si cambias el dominio, actualiza también `connect-src` en la etiqueta `Content-Security-Policy` de los tres HTML.

- `vehiculoId: 1`
- `direcciones: {arriba: 1, abajo: 2, izquierda: 3, derecha: 4}`: códigos del catálogo para el mando izquierdo (conducción). Una dirección solo se habilita si su código existe y está activo.
- `brazo: {arriba: 5, abajo: 6, izquierda: 7, derecha: 8}`: códigos del mando derecho (subir/bajar brazo, girar pala izquierda/derecha), con la misma regla.
- Cualquier otro comando activo del catálogo (hoy LUZ, SONIDO y ENCENDER_APAGAR) aparece como botón en el centro del mando.
- `etiquetasCortas` e `iconos`: texto corto e icono por código, solo estéticos; el nombre del catálogo sigue en `title` y `aria-label`.
- DETENER se identifica por **nombre** (`DETENER`), igual que el backend.
- Teclado: flechas o `WASD` = conducción · `I` `K` = subir/bajar brazo · `J` `L` = girar pala · `Espacio`/`Esc` = DETENER.
- DEMO desde Control: botón «Demo» en la fila central (visible en los 5 modos). Abre un panel para elegir la DEMO (con número de pasos y duración) e iniciarla; mientras corre muestra el avance y tocarlo de nuevo la cancela. Crear o editar DEMO se hace en Administración (enlace «Crear o editar» del panel → `administracion.html#demo`). La última elegida queda preseleccionada (`domain/demo-preferida.js`, en este navegador) y es la que inicia la voz con «inicia la demo».
- Visualización de la DEMO (`ui/demo-visor.js`): cada `demo_movimiento` del WSS se reproduce en el mando del modo abierto (botón de la cruceta, perilla del joystick, teléfono de Giro, tarjeta en Voz o gesto de la guía y flecha sobre la cámara en IA) durante su `duracion_ms`; el resto del mando queda atenuado y solo brilla la acción en curso. Banda superior con paso y avance. Es solo visual: no envía órdenes.
- Accesorios interruptor (`interruptores`): Luz, Sonido y On/Off alternan su estado; el botón queda «prendido» (ámbar sólido, luz piloto y «Luz ON») hasta que se vuelve a tocar, y aparece un aviso centrado («Luz encendida», «Luz apagada»…). El cliente WSS ignora copias exactas de un mismo evento (mismo timestamp) para no alternar dos veces. El estado sale de los movimientos que difunde el servidor por WSS (también los de otros clientes y de la DEMO) y se recuerda en el navegador; no hay confirmación física del ESP.
- DETENER único: si un movimiento enviado antes del paro se confirma después, se comprueba con el WSS (orden real del servidor) y solo se reafirma DETENER si hace falta. Sin WSS se reafirma por seguridad.
- Pantalla de carga (`ui/carga.js` + CSS): animación de ~3.5 s al entrar al sitio o recargar, y versión corta (~1.8 s) con el nombre de la sección al navegar entre secciones. Se oculta sola por CSS (no depende de JavaScript).
- Giroscopio (`ui/giroscopio.js`), modo aislado con sus propios paneles: inclinar el teléfono conduce (adelante, atrás, izquierda, derecha) con el mismo envío sostenido del joystick y origen `WEB_GIROSCOPIO`; brazo, pala y accesorios quedan en botones. Necesita HTTPS; en iPhone pide permiso de movimiento al tocar «Activar». Se detiene al nivelar, al voltear el teléfono, si el sensor deja de enviar datos, al ocultar la página o con DETENER (que además lo pausa).
- Modo IA (`ui/gestos.js` + `domain/interprete-gestos.js`), aislado como Giro, para teléfonos, tabletas y computadoras con cámara: MediaPipe Gesture Recognizer corre **en el navegador** (el video no se graba ni se envía). «Joystick en el aire»: ✊ puño y mover la mano conduce, ✌️ victoria y mover la mano mueve brazo (↑ ↓) y pala (← →); el centro es donde se cierra la mano y la distancia se mide en tamaños de mano. 👍 sostenido 1 s = Luz, 🤟 1 s = Sonido, ☝️ 2 s = Encender/Apagar (con anillo de progreso; para repetir hay que abrir la mano). ✋ mano abierta, mano fuera de cuadro (~0.3 s), confianza baja, cámara congelada, pestaña oculta o ventana sin foco = DETENER. Tras DETENER no vuelve a mover hasta que se abra la mano. Mismo envío sostenido del joystick, origen `WEB_IA`. `ia: {libreria, wasm, modelo, fps, accesorios}` en `config.js`: la librería (`@mediapipe/tasks-vision@0.10.35`, ~11 MB de WebAssembly desde jsDelivr) y el modelo (`assets/modelos/`) se descargan solo al tocar «Activar cámara». Necesita HTTPS y permiso de cámara. La CSP de `index.html` incluye `'wasm-unsafe-eval'`, `connect-src 'self' https://cdn.jsdelivr.net` y `media-src blob: mediastream:` por este modo.
- Voz: `interprete-voz.js` entiende lenguaje natural sin IA ni servicios externos (vocabulario amplio, palabras parecidas, frases encadenadas con «y luego», repeticiones, correcciones). `voz: {pasoMs, maxPasos}` controla la pausa entre órdenes encadenadas y el tope por frase. Las palabras de paro se comparan exactas y siempre ganan.
- En modo Joystick solo se sostiene **un** joystick a la vez (una orden en vuelo); mientras tanto el otro joystick y los botones centrales no responden.
- `mantenerMs: 2400`: con el joystick sostenido se repite la **misma** orden cada 2.4 s (pensado para el firmware que se detiene a los ~3 s sin órdenes). `0` = solo en cada cambio de dirección.

**⚠ Acceso de prueba (temporal):** `accesoLibre: { activo: true, clave: "…" }` en `assets/js/config.js` hace que la página entre sin pedir clave y use esa. La clave queda **visible en el código publicado**: usa una clave de *operador* (no de administrador), compártela solo mientras duren las pruebas y **cámbiala en el backend al terminar**; luego pon `activo: false` y borra la clave del archivo.

**Clave:** el operador la escribe en la página; se valida con `GET /sesion` y se guarda en `sessionStorage` (o `localStorage` si marca «Recordar»). Nunca está en el repositorio. Es adecuada para una práctica con usuarios de confianza; para producción conviene cambiarla por tokens de corta duración emitidos por un servicio de inicio de sesión.

## 5. Cambio obligatorio en el backend: CORS

El control anterior funcionaba porque lo servía la misma API (`/control`, mismo origen). Desde GitHub Pages el origen es `https://juanarmando30.github.io`, y **sin CORS el navegador bloquea todas las peticiones REST** (el WSS sí funciona: CORS no aplica a WebSocket).

El paquete `backend_cors_fix.zip` agrega `CORSMiddleware` en `app/main.py` y la función `origenes_cors()` en `app/core/config.py` (lee `CORS_ORIGINS`). No cambia endpoints, lógica ni procedimientos.

```powershell
# En el servidor EC2
cd C:\vehiculo_oit
Stop-ScheduledTask VehiculoAPI
Get-Process python -ErrorAction SilentlyContinue | Stop-Process -Force
git pull                                  # tras subir el parche al repositorio
Add-Content .env "CORS_ORIGINS=https://juanarmando30.github.io"
Start-ScheduledTask VehiculoAPI
```

Comprobación desde tu PC (debe devolver `access-control-allow-origin: https://juanarmando30.github.io`):

```powershell
curl.exe -i -X OPTIONS https://vehiculos-juan.duckdns.org/vehiculos/1/movimientos `
  -H "Origin: https://juanarmando30.github.io" `
  -H "Access-Control-Request-Method: POST" `
  -H "Access-Control-Request-Headers: content-type,x-api-key"
```

Si el Caddyfile ya agrega cabeceras CORS, quita una de las dos configuraciones para no duplicarlas. CORS **no es autenticación**: solo le dice al navegador qué páginas pueden leer las respuestas; las escrituras siguen protegidas por `X-API-Key`.

## 6. Ejecución local

No requiere instalar nada. Desde la carpeta del proyecto:

```powershell
python -m http.server 5500
# abrir http://localhost:5500/
```

Para que el REST funcione en local, agrega temporalmente `http://localhost:5500` a `CORS_ORIGINS` en el servidor (separado por coma). No abras los HTML con doble clic (`file://`): los módulos ES no cargan así.

## 7. Publicación en GitHub Pages

1. Crea un repositorio, por ejemplo `control-vehiculo-iot`, y sube el **contenido** de esta carpeta a la raíz (incluido `.nojekyll`).
2. *Settings → Pages → Build and deployment → Source: Deploy from a branch → Branch: `main` / `(root)` → Save*.
3. Espera 1–2 minutos y abre `https://juanarmando30.github.io/control-vehiculo-iot/`.
4. Verifica: pestaña del navegador con el **favicon** de la excavadora; **pie** «Desarrollado por Juan Armando Castillo Rodríguez · 2026» visible debajo del mando; consola sin errores; panel con los tres indicadores.
5. Aplica el parche CORS (sección 5) antes de probar comandos.

Commits recomendados:

```
feat: estructura base y configuración pública del frontend
feat: cliente REST, WebSocket con reconexión y validadores
feat: dominio de comandos (servicio único, prioridad DETENER) y DEMO
feat: control con joystick, cruceta, voz y botones del catálogo
feat: panel de conectividad WSS / API AWS / Amazon RDS
feat: secciones de monitoreo y administración
feat: favicon, manifiesto y pie con créditos
docs: README, pruebas y checklist
```

## 8. Prueba independiente del WebSocket

Ver `docs/PRUEBAS.md`, sección W. Resumen: abre `wss://vehiculos-juan.duckdns.org/ws/vehiculos/1` en Postman (*New → WebSocket*), pulsa un botón en el control y verifica que llega `movimiento_individual` con el mismo `id_vehiculo`, `comando`, `codigo` y un `timestamp` UTC.

> Un 201 de la API o un evento WSS significan que el comando fue **registrado y difundido**, no que el vehículo lo ejecutó. La confirmación física llegará con el ESP32.

---

Desarrollado por **Juan Armando Castillo Rodríguez** · 2026 · *Implementación de Soluciones IoT*
