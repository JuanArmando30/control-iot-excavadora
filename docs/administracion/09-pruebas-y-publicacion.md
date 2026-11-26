# Etapa 9 · Pruebas negativas, regresión, accesibilidad y publicación

Estado: **lista y probada localmente** con la configuración final de producción.
Pendiente: publicar (backend + frontend a la vez, con `-Transicion cerrar`) y cargar el firmware con la nueva contraseña del portal Wi-Fi.

## 1. Retiro de la transición

Las cuatro piezas que mantuvimos «hasta la Etapa 9» se retiran **por configuración, sin borrar código**,
para poder volver atrás en un minuto si algo falla.

| Pieza | Antes | Ahora (por defecto) | Vuelta atrás |
|---|---|---|---|
| Clave `X-API-Key` | escrituras y control | **rechazada (401 «se retiró: inicia sesión»)** | `CLAVE_API_HABILITADA=true` |
| `CONTROL_ABIERTO` | mover sin credencial | **false**: solo dueño, empresa (según estado/soporte) o invitado con reserva | `true` |
| `LECTURA_ABIERTA` | estado/historial públicos | **false**: dueño, empresa o soporte | `true` |
| `WS_ABIERTO` | WebSocket sin ticket | **false**: ticket de un solo uso o credencial del ESP32 | `true` |
| Panel `/control` (H7) | público | **410 «retirado»** | vuelve con la clave |

Un solo comando cambia las cuatro en el `.env` del servidor, sin mostrar su contenido:
`actualizar_servidor.ps1 -Transicion cerrar` (y `-Transicion abrir` para volver atrás).

En el frontend (`config.js`): `claveApi: false` y `controlAbierto: false`. La página ya no pide ni envía
la clave, **borra la que hubiera quedado recordada** y, sin sesión, ofrece *Iniciar sesión* o *Probar como invitado*.
Sigue público: `/health`, el catálogo de invitados, la reserva y el inicio de sesión.

## 2. Casos de prueba pedidos → dónde se prueban

Backend: `python -m pytest -q` → **79 pruebas**. La suite `tests/test_produccion.py` corre con la
configuración final (todo cerrado). En el navegador (Chrome sin ventana, backend real con datos de prueba)
se repitieron las suites de cada etapa **en modo producción**.

| Caso de la tarea | Backend (pytest) | Navegador |
|---|---|---|
| Admin registra y asigna vehículo | `test_produccion::test_admin_registra_y_asigna_vehiculo` | Etapa 5 (28 ✓) |
| Usuario ve sólo sus unidades y controla | `test_produccion::test_usuario_ve_solo_sus_unidades_y_controla` | Etapa 6 (23 ✓), Etapa 8 |
| Invitado sólo opera demo temporal | `test_produccion::test_invitado_solo_opera_la_demo_temporal`, `test_invitados` (8) | Etapa 7 (19 ✓) |
| User A no consulta ni ejecuta User B (BOLA/IDOR) | `test_produccion::test_usuario_a_no_consulta_ni_ejecuta_lo_de_usuario_b` (11 rutas) | — |
| Admin sin consentimiento no controla unidad vendida | `test_produccion::test_admin_sin_consentimiento_no_controla_unidad_vendida` | Etapa 6 (editor de fábrica bloqueado en la vendida) |
| WSS no filtra eventos entre usuarios | `test_produccion::test_wss_no_filtra_eventos_entre_usuarios`, `test_tiempo_real` (7) | Etapa 8 (17 ✓) |
| Demos persisten y se ejecutan con DETENER | `test_produccion::test_demos_persisten_y_se_ejecutan_con_detener`, `test_demos` (8) | Etapa 6 |
| RDS conserva historial | `test_produccion::test_rds_conserva_historial_y_su_autor` + `migrar probar` (conteos idénticos en cada migración) | — |
| Reconexión y errores | `test_produccion::test_reconexion_y_errores` | Etapa 8 (ticket nuevo en cada reconexión) |
| Transición retirada | `test_produccion::test_transicion_retirada_clave_control_lectura_y_ws` | comprobación «anónimo en producción» (6 ✓) |
| Entradas inválidas y maliciosas | `test_produccion::test_entradas_invalidas_y_maliciosas` (422, SQL literal, HTML como texto, límites) | — |

Mutaciones (se rompe a propósito una regla y se comprueba que alguna prueba falla): filtro de DEMO privadas,
prioridad de DETENER, exclusividad de la reserva, vigilante del invitado, validación del ticket, revalidación
del WebSocket, reportes solo del dispositivo y clave retirada. **Todas detectadas.**

## 3. Regresión de 4.1 (Control) y 4.2 (Monitoreo)

- Con sesión: Control con los comandos de la unidad, 6 modos, DETENER, DEMO; Monitoreo con último movimiento
  en vivo y la tabla de 10 movimientos de RDS. Probado como dueño y como empresa (selector).
- Sin sesión (producción): botón «Entrar», ventana con *Iniciar sesión* / *Probar como invitado* (una sola),
  la clave recordada se borra y no se envía, sin errores de JavaScript.
- En transición (por si se vuelve atrás): Control y Monitoreo anónimos siguen funcionando como antes.

## 4. Accesibilidad

Auditoría con **axe-core 4.10** (reglas WCAG 2.1 A y AA) en **20 vistas**: las cuatro páginas, cada rol,
cada pestaña de Administración, formularios modales, el editor de pasos y teléfono (390 px).
Resultado: **0 infracciones** tras corregir la única encontrada (la tabla con desplazamiento de Monitoreo
no se alcanzaba con el teclado: ahora es una región enfocable con nombre).
Además, en etapas anteriores: foco del teclado tras reordenar pasos, `aria-live` en listas y avisos,
DETENER con teclado (Espacio / Escape en la página del invitado), sin desplazamiento horizontal en móvil.
axe-core no sustituye una prueba con lector de pantalla real; queda recomendada.

## 5. Estado de los hallazgos de la Etapa 1

| Hallazgo | Estado |
|---|---|
| H1 WSS público | **Resuelto** (Etapa 8): ticket por unidad + credencial del ESP32; `WS_ABIERTO=false` |
| H2 GET públicos | **Resuelto**: autorización por recurso; `LECTURA_ABIERTA=false` |
| H3 `CONTROL_ABIERTO` | **Retirado** (Etapa 9); lo reemplaza la reserva de invitado |
| H4 claves compartidas | **Resuelto**: cuentas personales, clave retirada |
| H5 sin límite de tasa | **Resuelto**: login, códigos, reservas y tickets |
| H6 sin auditoría | **Resuelto**: bitácora con altas, asignaciones, roles, DEMO, soporte, exhibición, dispositivo |
| H7 panel `/control` | **Retirado** (410) |
| H8 historial sin LIMIT | **Resuelto** (V006 + V009) |
| H9 duración de pasos sin tope | **Resuelto** en servidor (límites del modelo) y firmware (10 s) |
| H10 estado en memoria | **Aceptado**: un solo proceso de Uvicorn (verificar que la tarea no use `--workers`) |
| H11 «conectado» manual | **Resuelto**: presencia real del ESP32 + reportes de ejecución |
| H12 cuenta maestra de RDS | **Pendiente en el servidor**: `migrar crear-cuenta-api` (paso 6 abajo) |
| H13 borrado en cascada | **Resuelto**: «baja» en lugar de borrar; con historial no se elimina |
| H14 `sql_mode` no estricto | **Resuelto** para todo lo nuevo (los SP se crean en modo estricto) |
| H15 contraseña del portal Wi-Fi pública | **Resuelto en el código** (va en `secretos.h`); **cámbiala**: la anterior sigue en el historial de git |
| H16 TLS sin certificado raíz | **Riesgo residual**: el ESP32 no verifica el certificado del servidor; recomendación: `beginSslWithCA` con el certificado raíz de la autoridad que emite el certificado del dominio (la que use Caddy) y probarlo con la placa |
| H17 «ESP8266» en la base | **Pendiente**: Administración › Vehículos › Editar › microcontrolador = ESP32 |

Otros riesgos aceptados y documentados: límites de tasa y tickets en memoria (un proceso); la IP real se toma de
`X-Forwarded-For` solo si la petición llega del proxy local; «Duplicar pestaña» invalida la sesión de una de las dos
(efecto seguro de la rotación); una pestaña muy vieja abierta durante un despliegue puede seguir con el JavaScript
anterior hasta recargarla.

## 6. Publicación (orden importante)

1. **Firmware:** en tu `secretos.h` agrega `#define CLAVE_PORTAL_WIFI "una-contraseña-NUEVA"` (8+ caracteres);
   compila y sube. Sin esa línea el firmware no compila (a propósito). La credencial del dispositivo ya la tiene.
2. **Commit y push** de backend, frontend y firmware (sin `secretos.h`).
3. **Servidor:** `powershell -ExecutionPolicy Bypass -File C:\vehiculo_oit\deploy\actualizar_servidor.ps1 -Transicion cerrar`
   (no hay migraciones en esta etapa). El script muestra «Lectura CERRADA» y «Panel /control retirado».
4. **Verificación:** sin sesión, Control pide iniciar sesión; con tu cuenta, Control y Monitoreo funcionan;
   Inventario › Dispositivo dice **CONECTADO**; la página de invitado funciona con la exhibición abierta.
5. **Si algo falla:** `actualizar_servidor.ps1 -Transicion abrir` (vuelve todo como antes) y avísame.
6. **H12 · mínimo privilegio en RDS** (recomendado): `python -m app.db.migrar crear-cuenta-api`, sigue las
   instrucciones que imprime (nueva cuenta solo con `EXECUTE` en `DB_USER`, la maestra en `DB_MIGRA_USER`) y reinicia.
7. Opcional: quitar `API_KEY_OPERADOR` y `API_KEY_ADMIN` del `.env` (ya no se usan).

## 7. Corrección posterior: WSS «Desconectado» y reserva del invitado (V014)

Síntomas reportados tras publicar: el indicador WSS en rojo aunque AWS y RDS estaban bien, y el invitado
veía su propia reserva como «ocupada» y no podía volver a entrar.

| Causa | Corrección |
|---|---|
| Sin sesión (o sin reserva) la página igual intentaba abrir el WSS; el servidor lo rechazaba (401) y se pintaba **rojo** | Estado nuevo `SIN_PERMISO`: no se pide ticket ni se abre el WebSocket; el indicador queda **gris** («Sin sesión», «Sin reserva» o «Sin permiso»). Rojo solo es una falla real de red o servidor |
| Administración abría el WSS **antes** del inicio de sesión y nunca lo rehacía (había que recargar); además siempre iba a la unidad #1 (403 para un comprador) | Canal reconfigurable (`CanalWs` en `comun.js`): al iniciar sesión se conecta a la unidad de la persona (`resolverUnidad`), al cerrarla se suelta; Control y Monitoreo lo sueltan si la sesión termina |
| El invitado conectaba el WSS sin reserva y siempre a la unidad de `config.js` | El WSS se abre **solo al reservar**, a la unidad reservada, con identidad propia de la reserva; al terminar vuelve a gris |
| El token del invitado vivía solo en memoria: **recargar** lo perdía y la unidad quedaba «ocupada» por uno mismo | El token se guarda en el `sessionStorage` de **esa pestaña** (nunca `localStorage`); al recargar se **retoma** la reserva |
| Tras perderla, la espera de 10 min castigaba al visitante aunque la reserva terminara por desconexión | **V014** (`sp_invitado_reservar`): la espera solo cuenta reservas `cancelada`/`expirada` (las que el visitante usó o cerró); tras `desconexion`, `detenida` o `admin` puede reservar enseguida. Si la misma red ya tiene la reserva responde `propia` → «Ya tienes una reserva activa…» en lugar de «ocupada». El límite por hora sigue contando todas |

Pruebas: `pytest` **80** (nueva `test_reserva_propia_y_sin_espera_tras_desconexion`), `probar_v014` para la
copia de RDS, y en el navegador (modo producción) **25/25**: sin sesión/sin reserva gris y sin tickets; invitado
reserva → WSS en línea a su unidad; recarga → retoma; otra pestaña → «Ya tienes una reserva»; cerrar la pestaña →
se libera en ~11 s y se reserva de nuevo sin espera; terminar a propósito → sí hay espera; Administración conecta
al iniciar sesión y suelta al salir sin recargar; comprador → su unidad. Regresión Etapa 8 y anónimo: sin cambios.

Publicación de la corrección:
1. Commit y push de backend y frontend.
2. Servidor: `actualizar_servidor.ps1` (sin `-Transicion`; ya está cerrada).
3. `python -m app.db.migrar probar` (debe pasar V014 en la copia).
4. Instantánea de RDS `antes-v014-AAAAMMDD` y esperar a que esté **Disponible**.
5. `python -m app.db.migrar aplicar --respaldo` y reiniciar la tarea de la API.
   Sin V014 aplicada la página ya funciona (WSS y retomar la reserva); V014 solo añade «propia» y quita la espera tras una desconexión.

## 8. Ajustes de roles: movimientos en Inventario, invitado con todos los modos y 1 minuto

| Pedido | Cambio |
|---|---|
| La empresa debe ver los movimientos de cada unidad | **Inventario › «Movimientos»**: catálogo de la unidad (copiado de su modelo; se edita en Modelos › Capacidades) e historial reciente de RDS con el **origen** (modo) de cada orden. En una unidad **vendida** el catálogo se ve siempre (ficha del producto, `GET /vehiculos/{id}/comandos` abierto a la empresa), pero el historial y el control siguen pidiendo el soporte del cliente (regla de la tarea, sin cambios) |
| El cliente controla su unidad sin quitarle movimientos y crea sus DEMO | Ya era así: controla desde Control; crear/editar/eliminar comandos responde 403 a su cuenta (nueva prueba); hasta 20 DEMO privadas por unidad |
| Invitado: todos los modos de control | Al reservar se abre **Control** en modo invitado (`index.html?invitado`): Pulso, Joystick, Voz, Giroscopio, IA y Táctil sobre la unidad reservada, solo con los comandos y DEMO permitidos a invitados; reloj y latido en la barra; «Vista sencilla» o «Terminar prueba» desde el botón del reloj. El historial guarda el modo usado (p. ej. `WEB_PULSO`, `WEB_TECLADO`). El invitado puede consultar si corre una DEMO en **su** unidad (`/demos/ejecucion` con `X-Invitado`); el historial sigue cerrado para él |
| Reserva de 1 minuto | `MINUTOS_RESERVA=1`, `MAX_RESERVAS_POR_HORA=5`, `ENFRIAMIENTO_MIN=3` (sin migración: son parámetros de `sp_invitado_reservar`) |

Pruebas: `pytest` **82** (nuevas: invitado lee solo la ejecución de su unidad y mueve con cualquier origen; empresa ve el
catálogo de la vendida pero no su historial ni la mueve; cliente no elimina comandos). Navegador (modo producción)
**22/22** en el flujo nuevo y regresión sin cambios (WSS 25/25, Etapa 8, anónimo).

Publicación: commit y push de backend y frontend, y en el servidor
`actualizar_servidor.ps1 -Transicion cerrar` (no hay migraciones nuevas).

### 8.1 La empresa bloquea movimientos de cualquier unidad

La empresa es la dueña inicial del producto: puede **bloquear** un movimiento en **cualquier** unidad
(inventario, exhibición o **vendida**) **sin** la autorización de soporte del cliente. Es la única excepción a
la regla de la vendida: ver su historial o moverla sigue pidiendo el soporte.

- **Dónde:** Inventario › «Movimientos» › botón **Bloquear / Desbloquear** en cada comando. DETENER muestra
  «Parada de seguridad» y no se puede bloquear (la API responde 409).
- **API:** `POST /admin/unidades/{id}/comandos/{id_comando}/bloqueo` con `{"bloqueado": true|false}`, solo
  administrador. Marca el comando inactivo en el catálogo de la unidad (`sp_actualizar_comando`, sin migración)
  y deja `comando.bloquear` / `comando.desbloquear` en la auditoría.
- **Efecto inmediato:**
  - La API rechaza el movimiento (409 «El movimiento X está bloqueado en esta unidad») al cliente, al
    invitado (su reserva en curso se actualiza) y a las DEMO que lo usen. Una DEMO en curso que lo use se
    detiene y termina en DETENER.
  - La página de Control lo deshabilita al instante y muestra el aviso «La empresa bloqueó el movimiento X»
    (evento WSS `catalogo_actualizado`; Monitoreo también lo registra).
- **El cliente no puede desbloquearlo:** tanto `…/bloqueo` como `…/comandos/{id}/actualizar` le responden 403.

Pruebas: `pytest` **84** (bloqueo de la vendida sin soporte, cliente sin poder desbloquear, DETENER no
bloqueable, 404 de comando ajeno, auditoría y reserva de invitado en curso). Navegador **18/18**: la empresa
bloquea desde Inventario, el Control abierto del cliente se deshabilita en vivo, desbloquea y vuelve a moverse.
Regresión 22/22 (invitado) y 25/25 (WSS).

### 8.2 Eliminar una unidad dada de baja (V015)

**Falla:** una unidad con historial no se podía eliminar (regla H13: se da de baja para conservarlo), pero
la regla seguía aplicándose **después** de la baja. Además, sus asignaciones pasadas, autorizaciones de
soporte, reservas y credencial (`ON DELETE RESTRICT`) bloqueaban el `DELETE`. Una unidad dada de baja se
quedaba para siempre en la pestaña Vehículos.

**Corrección:**
- La baja es el **paso previo**: conserva el historial hasta que la empresa decide eliminar la unidad.
- Una unidad **dada de baja** se elimina **definitivamente** con `sp_eliminar_unidad_baja` (migración V015).
  En una sola transacción borra la unidad, sus comandos, historial, estado, DEMO y sus pasos, asignaciones
  pasadas, autorizaciones de soporte, reservas de invitado y credencial del ESP32. Rechaza la operación
  si la unidad no está en baja o tiene una asignación vigente.
- La bitácora registra `unidad.eliminar` con el nombre de la unidad y cuánto se borró (la auditoría no
  tiene FK a la unidad, así que se conserva).
- **Dónde:**
  - Pestaña **Vehículos › Eliminar** (`POST /vehiculos/{id}/eliminar`): si la unidad está en baja, la
    elimina definitivamente.
  - **Inventario**: botón **Eliminar** en las unidades dadas de baja (`POST /admin/unidades/{id}/eliminar`).
    Pide escribir el nombre de la unidad para confirmar.
- **Sin baja y con historial** sigue respondiendo 409: «primero dala de baja en Inventario».
- **Sin V015** en la base responde 503 indicando aplicar la migración, y no borra nada.

Pruebas: `pytest` **86**. `migrar probar` en MySQL 8.0 local con la estructura de RDS: V001–V015, la
reversión deja la base idéntica y `probar_v015` comprueba que una unidad con historial, DEMO, venta, soporte,
reserva y credencial no deja ninguna fila. Navegador **12/12** (pestaña Vehículos, Inventario con nombre
equivocado y correcto, unidad sin baja protegida).

**Publicación (sí hay migración):**
1. Commit y push de backend y frontend.
2. En el servidor: `actualizar_servidor.ps1 -Transicion cerrar`. Descarga el código, incluido el archivo
   V015. Hasta aplicar la migración todo funciona igual; solo eliminar una unidad en baja responde 503.
3. Crea un **snapshot de RDS** y anota su identificador.
4. Desde `C:\vehiculo_oit`:
   - `.\.venv\Scripts\python.exe -m app.db.migrar probar`
   - Si pasa: `.\.venv\Scripts\python.exe -m app.db.migrar aplicar --respaldo <id-del-snapshot>`
5. La API detecta la versión 15 sola (en menos de 30 s, sin reiniciar). Recarga el navegador con Ctrl + F5.

### 8.3 Accesorios para el invitado (luz, sonido, encender/apagar)

**Antes:** el invitado solo recibía los comandos marcados «Permitido a invitados» en el modelo, más DETENER.
Los accesorios (códigos 10, 11 y 12) no tenían esa marca, así que no aparecían ni en el control completo
ni en la vista sencilla.

**Ahora:** los accesorios activos de la unidad siempre entran en la reserva del invitado, igual que DETENER,
porque no mueven la unidad. Así se ven los mismos botones que en las cuentas de administrador y cliente,
con su estado (Luz ON, Sonido ON, Encendida).
- Los **movimientos** siguen dependiendo de la marca del modelo.
- Un accesorio **bloqueado** por la empresa (8.1) no aparece.
- Las DEMO de fábrica que usan accesorios ahora también se ofrecen al invitado.
- Al guardar una capacidad de tipo accesorio, la marca queda en «Sí».

Sin migración: se resuelve en `InvitadoService._comandos_de_invitado`. Pruebas: `pytest` 86 (con un
movimiento no permitido → 403 y LUZ → 201). Navegador **12/12**: el invitado ve los tres botones, los usa,
el botón alterna su estado y el historial los guarda.

### 8.4 Invitado: reserva de 2 minutos y espera de 15 s (V017)

- `MINUTOS_RESERVA = 2` (sin migración) y `ENFRIAMIENTO_S = 15`. Siguen 5 reservas por hora, y no hay
  espera tras una desconexión (V014).
- **V017** cambia solo `sp_invitado_reservar`: la espera pasa de **minutos** enteros a **segundos**, porque
  15 s no se pueden expresar en minutos. La API envía 15 (segundos) solo cuando la base está en V017; antes
  envía 1 (minuto), para que «15» nunca signifique 15 minutos.
- La V016 de este proyecto es `V016__accesorios_invitado`, que marca los accesorios como permitidos.

Pruebas: `pytest` 87. `migrar probar` en MySQL 8.0 local de V001 a V017 pasa, con reversión idéntica.
`probar_v017` comprueba una reserva de 2 min y una espera de 15 s. Navegador 6/6: reloj 1:5x, «de nuevo en
0:12» y nueva reserva pasados 15 s.

**Publicación:**
1. Commit y push.
2. `actualizar_servidor.ps1 -Transicion cerrar`.
3. Snapshot de RDS, luego `migrar probar` y `migrar aplicar --respaldo <id>`. Son los mismos pasos que
   V015, ver 8.2.

## 9. Criterios de aceptación

- [x] Pruebas negativas automáticas en modo producción para todos los casos pedidos.
- [x] Regresión de Control y Monitoreo (con y sin sesión).
- [x] Accesibilidad WCAG 2.1 A/AA sin infracciones en 20 vistas.
- [x] Transición retirada con vuelta atrás de un comando.
- [x] README y documentación por etapa (01–09).
- [ ] Publicado con `-Transicion cerrar` y verificado en producción.
