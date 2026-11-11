# Control · Excavadora IoT (frontend para GitHub Pages)

Aplicación web estática (HTML5 + CSS3 + Bootstrap 5 + JavaScript ES modules, sin compilación) con tres secciones:

| Sección | Archivo | Qué hace | ¿Clave? |
|---|---|---|---|
| **Control** | `index.html` | Una sola pantalla sin scroll con un mando horizontal: control de **conducción** (izquierda), control de **brazo y pala** (derecha), centro con luz, sonido, encendido y DETENER; indicadores WSS · AWS · RDS integrados en el menú superior; 3 modos de manejo (Pulso, Joystick, Voz) | Operador |
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
│   └── site.webmanifest
├── js/
│   ├── config.js              URL base, WSS, rutas, vehículo, tiempos, mapeo de direcciones
│   ├── core/                  http-client · ws-client · validadores · clave-store
│   ├── api/vehiculo-api.js    Una función por endpoint real
│   ├── domain/                catalogo · comando-service · demo-service · conectividad-service · interprete-voz
│   ├── ui/                    dom · joystick · botonera · voz · demo-panel · conectividad-panel · modales · clave-dialog
│   └── pages/                 comun · control · monitoreo · administracion
└── docs/
    ├── PRUEBAS.md             Casos de prueba paso a paso
    └── CHECKLIST.md           Seguridad, accesibilidad y errores
```

Todas las rutas son **relativas** (`assets/...`, `js/...`), por eso funcionan en la subruta `https://juanarmando30.github.io/<repositorio>/`.

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

Si Swagger cambia, solo se editan `js/config.js` (rutas) y `js/core/validadores.js` (campos).

## 4. Configuración (sin secretos)

Todo está en `js/config.js`. Si cambias el dominio, actualiza también `connect-src` en la etiqueta `Content-Security-Policy` de los tres HTML.

- `vehiculoId: 1`
- `direcciones: {arriba: 1, abajo: 2, izquierda: 3, derecha: 4}`: códigos del catálogo para el mando izquierdo (conducción). Una dirección solo se habilita si su código existe y está activo.
- `brazo: {arriba: 5, abajo: 6, izquierda: 7, derecha: 8}`: códigos del mando derecho (subir/bajar brazo, girar pala izquierda/derecha), con la misma regla.
- Cualquier otro comando activo del catálogo (hoy LUZ, SONIDO y ENCENDER_APAGAR) aparece como botón en el centro del mando.
- `etiquetasCortas` e `iconos`: texto corto e icono por código, solo estéticos; el nombre del catálogo sigue en `title` y `aria-label`.
- DETENER se identifica por **nombre** (`DETENER`), igual que el backend.
- Teclado: flechas o `WASD` = conducción · `I` `K` = subir/bajar brazo · `J` `L` = girar pala · `Espacio`/`Esc` = DETENER.
- Voz: `interprete-voz.js` entiende lenguaje natural sin IA ni servicios externos (vocabulario amplio, palabras parecidas, frases encadenadas con «y luego», repeticiones, correcciones). `voz: {pasoMs, maxPasos}` controla la pausa entre órdenes encadenadas y el tope por frase. Las palabras de paro se comparan exactas y siempre ganan.
- En modo Joystick solo se sostiene **un** joystick a la vez (una orden en vuelo); mientras tanto el otro joystick y los botones centrales no responden.
- `mantenerMs: 2400`: con el joystick sostenido se repite la **misma** orden cada 2.4 s (pensado para el firmware que se detiene a los ~3 s sin órdenes). `0` = solo en cada cambio de dirección.

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
