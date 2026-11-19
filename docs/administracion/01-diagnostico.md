# Etapa 1 · Diagnóstico del proyecto (Control + Monitoreo → Administración)

**Estado: CERRADA** (18 nov 2026). Todo lo de este informe está **VERIFICADO**: se vio en el código, en la estructura exportada de RDS o se comprobó en vivo.
**Regla de la etapa:** solo lectura. No se modificó la base de datos, el backend publicado ni el frontend.
**Siguiente:** [02-modelo-datos.md](02-modelo-datos.md) (Etapa 2: modelo de datos y migraciones).

| Parte | Repositorio | Publicación |
|---|---|---|
| Frontend (Control, Monitoreo, Administración) | `JuanArmando30/control-iot-excavadora` | GitHub Pages |
| Backend FastAPI | `JuanArmando30/Examen_IoT_T2` | EC2 Windows + Caddy · `https://vehiculos-juan.duckdns.org` (`/docs`, `/health`, `/health/db`) |
| Firmware | `JuanArmando30/control_carrito` (`excavadora_iot.ino`) | ESP32 clásica de 38 pines |
| Base de datos | Amazon RDS MySQL **8.4.9**, base `vehiculo_iot` | Solo accesible desde EC2 |

---

## 1. Qué existe hoy

### 1.1 Frontend
Sitio estático: HTML5, Bootstrap 5.3.3 con SRI, ES modules y CSS propio. Mobile First, con CSP estricta.
- **Control** (`index.html`): 6 modos (Pulso, Joystick, Voz, Giroscopio, IA, Táctil), accesorios, DEMO, DETENER prioritario y visualización de la DEMO.
- **Monitoreo** (`monitoreo.html`): nombre del vehículo, indicadores WSS · API AWS · RDS, último movimiento reportado y últimos 10 movimientos (REST + WSS, sin duplicados ni datos fuera de orden).
- **Administración** (`administracion.html`): CRUD de vehículos, comandos, DEMO y pasos.

Además hay **una sola conexión WSS por navegador**, compartida entre pestañas.

### 1.2 Backend
- **Capas:** `routes → services → StoredProcedureRepository`. Todo acceso a datos pasa por **21 procedimientos almacenados**, con parámetros enlazados y lista blanca de nombres.
- **Operaciones:** 28 HTTP en Swagger (`/openapi.json` 1.0.0, idénticas al código), más el panel heredado `/control` y el WebSocket `/ws/vehiculos/{id}`.
- **Respuestas:** todas las rutas declaran `response_model`, así que una columna nueva en una tabla **no cambia** las respuestas de la API.
- **Acceso:** claves `X-API-Key` (operador y admin) y `CONTROL_ABIERTO=true`, que permite mover e iniciar DEMO sin clave.
- **DEMO:** tarea asyncio en memoria, una por vehículo. La cancelación tiene prioridad, termina en DETENER y **no escribe en el historial**.

> Los «21 servicios» del enunciado son **los 21 procedimientos almacenados** (confirmado).

### 1.3 Base de datos (exportada con `app/db/exportar_esquema.py`, solo lectura)

| Tabla | Filas | Llave y restricciones | Llaves foráneas |
|---|---|---|---|
| `vehiculos` | 1 | PK `id_vehiculo` | — |
| `comandos` | 12 | UNIQUE (`id_vehiculo`, `codigo`) y (`id_vehiculo`, `nombre`) | → vehiculos **CASCADE** |
| `estado_vehiculo` | 1 | PK `id_estado`, UNIQUE `id_vehiculo` | → vehiculos CASCADE · → comandos SET NULL |
| `historial_comandos` | **1356** | PK `id_historial` BIGINT; índices simples | → vehiculos **CASCADE** · → comandos SET NULL |
| `demos` | 2 | PK `id_demo` | → vehiculos CASCADE |
| `demo_movimientos` | 16 | UNIQUE (`id_demo`, `orden`) | → demos CASCADE · → comandos **RESTRICT** |

- **Objetos:** no hay vistas, disparadores, eventos ni restricciones `CHECK`. Los 21 SP existen, todos `SQL SECURITY DEFINER` con definer `admin@%`.
- **Configuración:** `time_zone` **UTC** (global, sesión y sistema; `NOW()` = `UTC_TIMESTAMP()`), `utf8mb4_0900_ai_ci`, `sql_mode = NO_ENGINE_SUBSTITUTION` (**no estricto**).
- **Datos de la unidad:** «Excavadora IoT», modelo «Modelo X», microcontrolador registrado **«ESP8266»**, aunque el firmware es para **ESP32**.

### 1.4 Firmware (`excavadora_iot.ino`)
- **Conexión:** se conecta como **cliente WSS** a `wss://vehiculos-juan.duckdns.org/ws/vehiculos/1`, sin credencial, y ejecuta lo que llega por ese canal.
- **Lo que ejecuta:**
  - `movimiento_individual`: mueve **máximo 3000 ms** y se detiene solo.
  - `demo_movimiento`: mueve durante `duracion_ms` exacto, **sin tope**.
  - `demo_finalizada`, `demo_cancelada` y `error`: se detiene.
  - `estado_inicial`: no mueve.
  - Si se pierde el Wi-Fi o el WSS, **se detiene todo** (hombre muerto).
- **Capacidades reales:** códigos 1–8 de movimiento, 9 DETENER y 10–12 pulsos (luz, sonido, encendido). Los códigos desconocidos se ignoran.
- **No envía confirmación**: no existe un estado «ejecutado físicamente».

---

## 2. Comprobado en vivo (solo lectura, sin credenciales)

| Prueba | Resultado |
|---|---|
| `GET /vehiculos`, `/estado`, `/historial`, `/demos`, `/comandos` | **200**: inventario, estado, últimos 10 movimientos con origen, 2 DEMO y 12 comandos visibles para cualquiera |
| WSS `/ws/vehiculos/1` | Conecta, recibe `estado_inicial`, `ping` → `pong`: **cualquiera escucha los eventos** |
| WSS `/ws/vehiculos/999` | `error` y cierre **4404** (correcto) |
| `GET /sesion` sin clave | `{"rol":"operador","acceso":"abierto"}`: **cualquiera puede mover la unidad** |
| `GET /control` | 200: el panel antiguo sigue publicado |
| `GET /health/db` | `{"estado":"ok"}` |

---

## 3. Hallazgos

| # | Severidad | Hallazgo | Dónde se resuelve |
|---|---|---|---|
| H1 | Alta | WSS sin autenticación: cualquiera recibe los eventos (y el canal es el que **ejecuta el ESP32**) | Etapa 8: canal autenticado para navegadores y credencial propia del dispositivo (tabla en V008) |
| H2 | Alta | Todos los GET son públicos | Etapa 4: autorización por recurso |
| H3 | Alta | `CONTROL_ABIERTO=true` | Se conserva hasta la Etapa 9 (decidido); lo reemplaza la reserva de exhibición |
| H12 | **Alta** | **La API usa la cuenta maestra de RDS** (`admin@%`, con `CREATE USER`, `DROP`, `GRANT OPTION` y `rds_superuser_role`) | Etapa 3: cuenta `vehiculo_api` con **solo EXECUTE** (los SP son DEFINER, no necesita más) |
| H13 | Alta | **Eliminar una unidad borra en cascada su historial**, su estado y sus DEMO | V003–V008 la bloquean si tiene asignaciones, reservas o credenciales. Etapa 3: «dar de baja» en lugar de borrar |
| H4 | Media | Dos claves compartidas: no hay identidad por persona | Etapa 4 |
| H5 | Media | Sin límite de tasa | Etapa 4 |
| H6 | Media | Sin auditoría | V007 + Etapa 3 |
| H7 | Media | Panel heredado `/control` público | Etapa 9 |
| H8 | Media | `sp_obtener_historial` no tiene `LIMIT` ni índice compuesto: ordena todo el historial (1356 filas y creciendo) | Índice en V006 + SP con `LIMIT` en la Etapa 3 |
| H9 | **Media (riesgo físico)** | Un paso de DEMO admite hasta 600 000 ms y **el firmware lo ejecuta completo sin tope** | Límites por modelo (V001) validados en el servidor (Etapa 6); tope opcional en el firmware |
| H14 | Media | `sql_mode` no estricto: un texto demasiado largo se trunca en silencio | Las migraciones corren en modo estricto; la API lo fijará por sesión (Etapa 3) |
| H15 | Media | La **contraseña del portal Wi-Fi del ESP32** está escrita en el código y su repositorio es público | Cambiarla y moverla a un archivo fuera de git. Sigue en el historial de git: rotarla es lo que la invalida |
| H16 | Baja | El firmware usa `beginSSL` sin certificado raíz ni huella: según la versión de la librería, podría no verificar la identidad del servidor | Usar `beginSslWithCA` con la raíz de Let's Encrypt (ISRG Root X1) |
| H17 | Baja | El vehículo registra «ESP8266», pero la placa es ESP32 | Corregirlo desde Administración; las migraciones no inventan datos |
| H10 | Info | Estado de DEMO y clientes WSS en memoria de un proceso | Mantener un solo proceso (D12) |
| H11 | Info | `conectado` lo fija un humano; el ESP no confirma | Etapa 8: solicitado / aceptado / reportado |
| — | Info | `sp_actualizar_estado` usa `VALUES()` en `ON DUPLICATE KEY UPDATE`, obsoleto desde MySQL 8.0.20 (sigue funcionando en 8.4) | Reescribir cuando se toque ese SP |

Lo que ya cumple se conserva:
- DETENER prioritario.
- Transacción estado + historial.
- DEMO fuera del historial.
- Reconexión WSS con latido.
- Anti-duplicados.
- Los tres indicadores independientes.
- Ningún secreto en el frontend.
- CSP estricta.
- El ESP se detiene al perder la conexión.

---

## 4. Brechas frente al modelo de negocio

| Requisito | Hoy | Falta (diseño en Etapa 2) |
|---|---|---|
| Admin / Usuario / Invitado | Claves compartidas | `usuarios`, login, tokens y sesión de invitado anónima |
| Modelo ≠ unidad física | `vehiculos.modelo` es texto | `modelos_vehiculo`, `modelo_comandos`, nº de serie y estado comercial |
| Propiedad | No existe | `asignaciones` (un solo dueño vigente) |
| Admin sin control de unidades vendidas | El admin puede todo | `autorizaciones_soporte` otorgadas por el comprador |
| DEMO de fábrica y privadas | DEMO sin dueño | `demos.ambito`, `demos.id_propietario` y límites por modelo |
| Invitado con reserva exclusiva | No existe | `sesiones_invitado`, `reservas_exhibicion` |
| Auditoría | No existe | `auditoria` |
| Quién ejecutó cada movimiento | Solo `origen` (texto) | `historial_comandos.id_usuario` / `id_sesion_invitado` |
| WSS por unidad y credencial del ESP | Canal público | `credenciales_dispositivo` + Etapa 8 |

---

## 5. Dudas resueltas

| # | Duda | Respuesta |
|---|---|---|
| D1 | Estructura real | Verificada (§1.3) |
| D2 | Privilegios de la cuenta de la API | Cuenta maestra con todos los privilegios → **H12** |
| D3 | Zona horaria | **UTC**: Monitoreo interpreta bien las fechas |
| D4 | ¿Cómo recibe órdenes el ESP? | **Cliente del WSS público** de la unidad 1 (§1.4). Proteger el canal **exige actualizar el firmware** con una credencial propia: el canal actual se mantiene hasta entonces |
| D5 | Unidades físicas | **Una.** Pasa a ser unidad de **exhibición** (como se usa hoy). Las pruebas «A no controla a B» usarán unidades **simuladas** (`es_simulada = 1`), mostradas siempre como tales |
| D6 | Invitado | **Anónimo**, sin cuenta (sesión temporal) |
| D7 | Google | Sin cuenta de Google Cloud por ahora. Queda como **opción futura**: la tabla `identidades_externas` ya lo contempla y no estorba |
| D8 | `X-API-Key` y `CONTROL_ABIERTO` | Se conservan; se retiran en la Etapa 9 |
| D9 | «21 servicios» | Son los 21 SP |
| D10 | Respaldos | Obligatorios antes de aplicar en la base real (ver 02 §5): lo exige el enunciado y el DDL de MySQL no se puede deshacer |
| D11 | Versión de MySQL | 8.4.9: admite `CHECK`, columnas generadas y `JSON` |
| D12 | ¿Uvicorn con un solo proceso? | **Pendiente**, no bloquea la Etapa 2. Se comprueba en el servidor con `(Get-ScheduledTask VehiculoAPI).Actions \| Format-List Execute, Arguments` |

## 6. Criterios de aceptación de la Etapa 1

- [x] Inventario de APIs (código = Swagger) y de WSS.
- [x] Estructura real de RDS: tablas, llaves, índices, SP, configuración y privilegios.
- [x] Firmware revisado: cómo recibe órdenes y qué capacidades tiene.
- [x] Hallazgos con severidad y etapa que los resuelve.
- [x] Dudas resueltas o con su forma de verificarse.
- [x] Sin cambios en la base de datos ni en lo publicado.
