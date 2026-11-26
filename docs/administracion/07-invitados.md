# Etapa 7 · Invitados y reserva temporal segura

Estado: **lista y probada localmente** (backend 61 pruebas; navegador 19 ✓ + regresión 28 + 23 ✓).
Pendiente en el servidor: `probar` V012, snapshot, `aplicar`.

## 1. Cómo funciona

1. La empresa abre la **exhibición** de la unidad (Administración › Inventario › *Invitados*)
   por 1–8 horas, **solo con alguien junto a la máquina**. Se cierra sola al pasar el tiempo
   o si la API se reinicia (estado seguro).
2. Cualquier visitante entra a **`invitado.html`** (enlace en la tarjeta de inicio de sesión), ve el
   **catálogo público** y, si la unidad está disponible, la **reserva de 2 minutos** tras aceptar las condiciones; al reservar se abre el **control completo** (`index.html?invitado`) con los 6 modos.
3. Durante la reserva: reloj, **DETENER** grande, los **movimientos permitidos a invitados**
   del modelo, los **accesorios** (luz, sonido, encender/apagar) como en las cuentas de administrador y cliente, y las **DEMO de fábrica** cuyos pasos son todos permitidos.
4. Al **terminar**, **caducar** o **dejar de dar señales 15 s** (pestaña cerrada, sin red), el servidor
   cancela la DEMO, **envía DETENER** y libera la unidad.

## 2. Reglas de seguridad

| Regla | Cómo se garantiza |
|---|---|
| Solo la unidad de **exhibición**; nunca la de un comprador | El SP solo reserva unidades activas en estado `exhibicion`; el token del invitado solo sirve para su unidad (403 en otra) |
| Reserva **exclusiva**, sin fila | Índice único de V005 (`uq_reserva_vigente`); si dos reservan a la vez, la base deja pasar a uno |
| Nadie más mueve la unidad durante la reserva | Clave, control abierto, admin o dueño → 409. **DETENER y cancelar siempre pasan** |
| Comandos limitados | `permitido_invitado` del modelo para los movimientos. DETENER y los accesorios (luz, sonido, encender/apagar) siempre: no mueven la unidad |
| Tiempo limitado | 2 min; vigilante cada segundo; reserva vencida también se cierra en la base |
| Desconexión | Latido cada 5 s; sin señal 15 s → DETENER y fin (`desconexion`) |
| Abuso | 5 reservas por hora y 15 s entre reservas por red (en segundos desde V017) (hash de la IP), contados en RDS; la espera no aplica tras una desconexión (V014); además límite en memoria |
| Interruptor | La empresa decide cuándo hay supervisión; caduca solo; al cerrarlo termina la reserva |
| Reinicio de la API | Al arrancar se cierran todas las reservas abiertas (`detenida`) y la exhibición queda cerrada |
| Token | Aleatorio, en memoria y en el `sessionStorage` de la pestaña (para retomar la reserva al recargar; nunca `localStorage`); en la base solo su HMAC; cabecera `X-Invitado` |
| Trazabilidad | El historial guarda la sesión del invitado como autor. En la **Bitácora** (filtro «Invitados») queda todo lo que hizo, con su número de reserva: `invitado.reservar`, cada orden `invitado.movimiento` (comando y modo: Pulso, Joystick, Voz…), `invitado.demo` / `invitado.demo_cancelar` e `invitado.fin` con el resumen (motivo, órdenes, DEMO, duración). También `exhibicion.abrir/cerrar` e `invitado.terminar` (empresa) |

## 3. Backend

**V012** (`db/migraciones/V012__invitados.sql` + `.down.sql`), sin cambios de tablas (usa V005):
`sp_catalogo_exhibicion`, `sp_invitado_reservar` (sesión + reserva en una transacción, con los
límites), `sp_invitado_sesion`, `sp_invitado_finalizar`, `sp_invitado_cerrar_todas`,
`sp_comandos_invitado` y `sp_version_esquema` → 12. `probar_v012` cubre reserva, ocupada,
unidad no disponible (incluida una en inventario), límite por hora, enfriamiento, vencimiento,
terminar y cerrar todas.

**Rutas nuevas (8)** → 76 operaciones (API 1.3.0):

| Ruta | Quién |
|---|---|
| `GET /invitado/catalogo` | público |
| `POST /invitado/reservar` | público (límites por red) |
| `GET /invitado/estado` · `POST /invitado/latido` · `POST /invitado/terminar` | invitado (`X-Invitado`) |
| `GET/POST /admin/unidades/{id}/exhibicion` · `POST …/exhibicion/terminar` | administrador |

El invitado mueve e inicia DEMO con las rutas de siempre (`/vehiculos/{id}/movimientos`,
`…/demos/{d}/iniciar`, `…/demos/cancelar`) enviando `X-Invitado`.
Servicio: `app/services/invitado_service.py` (reserva, vigilante, exclusividad, interruptor).

## 4. Frontend

| Archivo | Qué es |
|---|---|
| `invitado.html` + `assets/js/pages/invitado.js` | **Nuevo** · catálogo, condiciones, prueba (reloj, DETENER, mandos, DEMO), latido |
| `assets/js/api/invitado-api.js` | **Nuevo** · token de la pestaña (memoria + sessionStorage) |
| `assets/js/pages/admin/inventario.js` | Acción *Invitados*: abrir/cerrar exhibición y terminar la reserva |
| `assets/js/ui/sesion-ui.js` | Enlace «Pruébala como invitado» |
| `assets/js/core/http-client.js`, `config.js`, `assets/css/app.css` | Cabecera `X-Invitado`, rutas, estilos |

## 5. Pruebas

- **Backend (61):** 8 nuevas en `tests/test_invitados.py`: catálogo y exhibición cerrada por defecto;
  reserva exclusiva y comandos (movimiento no permitido → 403, LUZ y DETENER sí, clave/admin → 409, otra unidad → 403, token
  inventado → 401); no se abre ni reserva una unidad vendida; terminar deja la unidad en DETENER y
  aplica enfriamiento (429); vigilante por caducidad y por desconexión; DEMO aptas para invitados;
  la empresa cierra o termina; sin V012 → 503. Mutaciones: quitar la exclusividad o el vigilante hace fallar las pruebas.
- **Navegador (19 ✓):** flujo completo empresa → invitado, token fuera del almacenamiento, exclusividad
  real contra la API, DEMO + DETENER, móvil, enfriamiento. Regresión: Etapa 5 (28 ✓), Etapa 6 (23 ✓),
  Control y Monitoreo sin cambios.

## 6. Pasos en el servidor

1. Commit y push de ambos repositorios; en el servidor `deploy\actualizar_servidor.ps1`.
2. `.\.venv\Scripts\python.exe -m app.db.migrar probar` → OK.
3. Snapshot de RDS (Acciones › Realizar instantánea): `antes-v012-AAAAMMDD`, hasta *Disponible*.
4. `.\.venv\Scripts\python.exe -m app.db.migrar aplicar --respaldo antes-v012-AAAAMMDD`
5. `.\.venv\Scripts\python.exe -m app.db.verificar_procedimientos` → `Invitados (V012): 6 de 6`.

## 7. Prueba con la máquina real (con supervisión)

Zona despejada, una persona junto a la excavadora y nadie más controlando:
1. Administración › Inventario › *Invitados* en la unidad de exhibición → **Abrir a invitados** (1 h).
2. En otro navegador o en modo incógnito, abre `invitado.html`, reserva y mueve; prueba **DETENER**.
3. Cierra esa pestaña: en ~15 s la excavadora debe quedar en DETENER y la unidad libre.
4. Al acabar: *Invitados* → **Cerrar exhibición**.

## 8. Criterios de aceptación

- [x] Invitado anónimo: catálogo público y prueba temporal.
- [x] Reserva exclusiva de la unidad de exhibición, tiempo límite y comandos permitidos.
- [x] Detención al caducar, al terminar o al desconectarse; DETENER siempre disponible.
- [x] Nunca controla unidades de compradores; nadie más controla la unidad durante la reserva.
- [x] Límites contra abuso y auditoría.
- [ ] Aplicado en RDS y probado con la máquina real bajo supervisión.
