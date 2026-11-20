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

## 7. Criterios de aceptación

- [x] Pruebas negativas automáticas en modo producción para todos los casos pedidos.
- [x] Regresión de Control y Monitoreo (con y sin sesión).
- [x] Accesibilidad WCAG 2.1 A/AA sin infracciones en 20 vistas.
- [x] Transición retirada con vuelta atrás de un comando.
- [x] README y documentación por etapa (01–09).
- [ ] Publicado con `-Transicion cerrar` y verificado en producción.
