# Etapa 8 · Integración y WebSocket por unidad

Estado: **lista y probada localmente** (backend 68 pruebas con WebSocket reales; navegador 17 ✓
con el WS cerrado + regresión 28 / 23 / 19 ✓; firmware **compila** para ESP32).
Pendiente: `probar` V013, snapshot, `aplicar`, credencial y firmware en el ESP32.

## 1. Qué cambia

| Antes | Ahora |
|---|---|
| Cualquiera podía escuchar los eventos de cualquier unidad (H1) | Ticket de un solo uso por unidad, con las mismas reglas que REST |
| El ESP32 entraba como un navegador más | Credencial propia del dispositivo (cabecera `X-Dispositivo`, en la base solo su HMAC) |
| «Conectado» era un dato que se escribía a mano | **Conectado = el ESP32 está en línea con su credencial** (presencia real) |
| Solo «aceptado por la API» | **Solicitado → Aceptado (API) → Reportado (la unidad)** |
| Control y Monitoreo fijos en la unidad #1 | Con sesión: **las unidades de cada quien** (selector si hay varias) y sus DEMO privadas |
| Un permiso perdido seguía recibiendo eventos | **Revocación**: cada 10 s se revalida; fin de reserva y credencial revocada → al instante |
| DEMO: el firmware ejecutaba cualquier duración (H9) | Segundo tope en el firmware: 10 s por paso |

## 2. Quién recibe los eventos de `/ws/vehiculos/{id}`

| Quién | Cómo | Regla |
|---|---|---|
| Dueño | `POST /ws/ticket` con su token | solo sus unidades |
| Empresa | ídem | inventario/exhibición; vendida solo con soporte |
| Invitado | ídem con `X-Invitado` | solo su unidad reservada, mientras dure |
| ESP32 | cabecera `X-Dispositivo` | solo su unidad; único que puede enviar **reportes** |
| Clave X‑API‑Key (transición) | ticket con la clave | — |
| Sin nada (transición) | sin ticket | solo con `WS_ABIERTO=true` |

El ticket viaja en la URL pero **caduca en 30 s y se borra al usarse**. Las pestañas solo comparten
conexión con la misma identidad (una pestaña anónima nunca recibe la conexión del dueño).

Cierres: `4401` sin credencial válida (el navegador pide otro ticket), `4403` sin permiso o revocado
(no se reintenta), `4404` unidad inexistente.

## 3. Transición: `WS_ABIERTO`

Nueva variable del `.env` (por defecto **true**): mientras sea true, el firmware y las páginas
anteriores siguen funcionando sin ticket. **Se apaga en la Etapa 9** junto con `CONTROL_ABIERTO`,
`LECTURA_ABIERTA` y la clave X‑API‑Key, después de cargar la credencial en el ESP32.

## 4. Backend

**V013** (`db/migraciones/V013__credenciales_dispositivo.sql` + `.down.sql`), sin cambios de tablas
(usa `credenciales_dispositivo` de V008): `sp_dispositivo_crear` (revoca la anterior),
`sp_dispositivo_validar`, `sp_dispositivo_revocar`, `sp_dispositivo_estado`, `sp_version_esquema` → 13.

**Rutas nuevas (4)** → 80 operaciones:
`POST /ws/ticket` · `GET/POST /admin/unidades/{id}/dispositivo` · `POST …/dispositivo/revocar`.
Servicio: `app/services/canal_service.py` (tickets, autorización, revalidación, presencia, reportes).
Evento nuevo: `reporte_dispositivo` (`accion`: ejecutando / detenido / ignorado).

## 5. Firmware (`Carrito_ESP32/excavadora_iot`)

| Cambio | Detalle |
|---|---|
| `secretos.ejemplo.h` + `.gitignore` | La credencial va en `secretos.h`, que **no se sube** |
| Cabecera `X-Dispositivo` | Se añade tras `beginSSL` (la librería reinicia las cabeceras en `begin`) |
| `reportar()` | Envía `{"evento":"reporte","codigo":N,"accion":"…"}` al ejecutar, detener o ignorar |
| `DURACION_MAXIMA_PASO_MS = 10000` | Segunda barrera al hallazgo H9 |
| Sin `secretos.h` | Compila igual y funciona mientras `WS_ABIERTO=true` |

Compilado con `arduino-cli` (esp32:esp32 3.3.12): 91 % de flash, sin errores, con y sin `secretos.h`.
No se tocó nada más del firmware (Wi-Fi, portal de configuración y pines siguen igual).

## 6. Frontend

| Archivo | Cambio |
|---|---|
| `assets/js/core/unidad-activa.js` | **Nuevo** · unidad de la sesión, selector, identidad del canal |
| `core/ws-client.js`, `ws-compartido.js` | Ticket antes de cada conexión; 4401/4403; canal por identidad |
| `core/http-client.js`, `clave-store.js` | Con sesión, control y lecturas con el token |
| `core/validadores.js` | Evento `reporte_dispositivo` (solo acciones conocidas) |
| `pages/control.js`, `monitoreo.js`, `comun.js` | Unidad activa, DEMO privadas en «Demo», tercer estado «reportado» |
| `index.html`, `monitoreo.html` | Selector de unidad en el encabezado |
| `pages/admin/inventario.js` | Acción **Dispositivo**: generar (se muestra una vez) y revocar la credencial |
| `pages/administracion.js`, `pages/invitado.js` | Conexión con la identidad correcta / ticket del invitado |

## 7. Pruebas

- **Backend (68):** 7 nuevas en `tests/test_tiempo_real.py`, con conexiones WebSocket reales:
  transición sin ticket; WS cerrado exige ticket con las reglas de REST (unidad ajena 403, vendida
  sin soporte 403, un solo uso, ticket de otra unidad 4403); **eventos aislados entre usuarios**;
  **revocación** al perder la unidad; credencial del dispositivo (presencia, reportes, un navegador
  no puede fingir reportes, revocar lo expulsa); invitado solo mientras dura la reserva; sin V013 → 503.
  Mutaciones: quitar la validación del ticket, la revalidación o la exclusividad de los reportes hace fallar las pruebas.
- **Navegador (17 ✓, WS cerrado):** sin sesión no hay suscripción; el dueño ve su unidad, sus DEMO
  privadas en «Demo», mueve con su token, un ESP32 simulado recibe la orden y su reporte aparece en
  Control (y «detenido» se muestra como tal); Monitoreo del dueño; selector de la empresa; credencial
  desde Inventario. Regresión con `WS_ABIERTO=true`: Etapas 5 (28), 6 (23), 7 (19), Control y Monitoreo
  anónimos suscritos como hoy.
- La prueba encontró y se corrigió: el orden de mensajes al conectar el ESP32 (`estado_inicial` primero)
  y que el validador del navegador descartaba la acción del reporte.

## 8. Pasos en el servidor

1. Commit y push de backend y frontend; en el servidor `deploy\actualizar_servidor.ps1`.
2. `.\.venv\Scripts\python.exe -m app.db.migrar probar` → OK.
3. Snapshot de RDS: `antes-v013-AAAAMMDD` (Acciones › Realizar instantánea) hasta *Disponible*.
4. `.\.venv\Scripts\python.exe -m app.db.migrar aplicar --respaldo antes-v013-AAAAMMDD`
5. `.\.venv\Scripts\python.exe -m app.db.verificar_procedimientos` → `Dispositivo (V013): 4 de 4`.

## 9. Pasos con el ESP32

1. Administración › Inventario › **Dispositivo** en la unidad real → **Generar credencial** → copiarla.
2. En `Carrito_ESP32/excavadora_iot`: copiar `secretos.ejemplo.h` como `secretos.h` y pegar la credencial
   entre las comillas de `TOKEN_DISPOSITIVO`.
3. Compilar y subir el firmware. En el monitor serie debe decir «Con credencial de dispositivo».
4. En Inventario › Dispositivo debe decir **CONECTADO**; en Control, al mover, la línea de estado muestra
   «Unidad · reporta: ejecuta …».

## 10. Criterios de aceptación

- [x] Suscripciones WSS autenticadas y autorizadas por unidad; acceso revocado al cambiar permisos.
- [x] El WSS no filtra eventos entre usuarios.
- [x] Control con los comandos de la unidad seleccionada, DETENER y estado solicitado/aceptado/reportado.
- [x] Monitoreo de la unidad del usuario; reconexión y resincronización (tickets nuevos en cada reconexión).
- [x] WSS del navegador ≠ conexión física: «conectado» lo da la presencia del ESP32 con su credencial.
- [ ] Aplicado en RDS, credencial cargada en el ESP32 y probado con la unidad real.
