# Casos de prueba

Requisitos: parche CORS aplicado, clave de operador a la mano, página abierta en GitHub Pages. Abre también **Monitoreo** en otra pestaña o dispositivo para observar los eventos.

## J · Joystick (modo Joystick)

| # | Pasos | Resultado esperado |
|---|---|---|
| J1 | Arrastra la perilla hacia arriba y mantén | Un `POST` con el código de AVANZAR (origen `WEB_JOYSTICK`); flecha superior iluminada; luego como máximo un reenvío cada 2.4 s |
| J2 | Sin soltar, gira hacia la derecha | Un solo `POST` con DERECHA al cruzar el límite (no uno por píxel; DevTools → Red) |
| J3 | Mueve en la zona central | No se envía nada; texto «Neutral» |
| J4 | Suelta | La perilla vuelve al centro y se envía DETENER |
| J5 | Arrastra y saca el dedo/ratón fuera de la página o cambia de pestaña | DETENER (pointercancel / lostpointercapture / blur) |
| J6 | Movimientos rápidos arriba ↔ abajo | Nunca dos órdenes a la vez; si una está en vuelo, la siguiente queda en cola y gana la última |
| J7 | Teclado: Tab hasta el joystick, mantén ↑, suelta | Igual que J1 y J4 |
| J8 | Joystick derecho (Brazo y pala): arrastra arriba, luego a un lado, suelta | `POST` SUBIR_BRAZO, luego GIRAR_PALA_… (origen `WEB_JOYSTICK`); al soltar, DETENER |
| J9 | Mantén un joystick y toca el otro (multitáctil) | El segundo no responde: solo un joystick sostenido a la vez |

## B · Botones y crucetas (modo Pulso)

| # | Pasos | Resultado esperado |
|---|---|---|
| B1 | Toca «Avanzar» | Estado *Enviando* (borde ámbar) → *Aceptado* (verde); mensaje «registrado» |
| B2 | Toca «Avanzar» dos veces muy rápido | Un solo `POST` (duplicado ignorado mientras el primero viaja) |
| B3 | Revisa los botones del centro (Luz, Sonido, On / Off) | Solo aparecen comandos **activos** del catálogo; desactiva uno en Administración y recarga: desaparece |
| B3b | Cruceta derecha: Subir, Bajar, Pala izq., Pala der. | `POST` con los códigos 5, 6, 7 y 8 (origen `WEB_PULSO`); si desactivas uno en Administración, su botón queda «No disponible» |
| B3c | Teclado en modo Pulso: `I`, `K`, `J`, `L` | SUBIR_BRAZO, BAJAR_BRAZO, GIRAR_PALA_IZQUIERDA, GIRAR_PALA_DERECHA (origen `WEB_TECLADO`) |
| B4 | Mantén un joystick y toca un botón del centro (multitáctil) | Botones centrales deshabilitados mientras hay una dirección sostenida; DETENER sigue activo |
| B5 | Quita la clave (Olvidar clave) | Controles deshabilitados y aviso «Falta la clave» |

## D · DETENER

| # | Pasos | Resultado esperado |
|---|---|---|
| D1 | Toca DETENER | `POST` con DETENER al instante (pointerdown), estado *Registrado* |
| D2 | Toca Avanzar e inmediatamente DETENER | Si AVANZAR se confirma después de pedir el paro, se envía un segundo DETENER automático (reafirmación) |
| D3 | Espacio o Esc en el teclado | DETENER |
| D4 | Di «alto» en modo Voz | DETENER sin esperar el resultado final del reconocimiento |
| D5 | DETENER durante una DEMO | Llama a `POST …/demos/cancelar`; llega `demo_cancelada` con `detenido_con: "DETENER"` |

## M · DEMO

| # | Pasos | Resultado esperado |
|---|---|---|
| M1 | Abre Monitoreo | La lista se llena con `GET /vehiculos/1/demos` (solo activas) |
| M2 | Inicia una DEMO desde Monitoreo con Control abierto en otro dispositivo | 202; barra de avance según `demo_movimiento`; en Control el mando se bloquea y DETENER la cancela |
| M3 | Intenta iniciar otra durante la ejecución | Botón deshabilitado; si se fuerza, la API responde 409 y la página se resincroniza |
| M4 | Deja terminar | `demo_finalizada`; controles habilitados de nuevo |
| M5 | Cuenta el historial (Monitoreo) antes y después | No cambia: los pasos de DEMO no se guardan |
| M6 | Recarga la página a mitad de una DEMO | `GET …/demos/ejecucion` recupera el estado |

## E · Errores y resiliencia

| # | Pasos | Resultado esperado |
|---|---|---|
| E1 | Clave incorrecta | 401 → mensaje «Clave X-API-Key faltante o incorrecta» y se pide de nuevo |
| E2 | Clave de operador y eliminar en Administración | 403 «requiere administrador» |
| E3 | Modo avión 10 s y luego reconectar | WSS: Desconectado → Reconectando → En línea; API: No disponible → Disponible; RDS: Sin verificar → Disponible; el control se bloquea y se reactiva solo |
| E4 | Detén la instancia RDS (o simula) | API Disponible, RDS **No disponible** (503) |
| E5 | Sin el parche CORS | API «Sin respuesta (… o CORS)», RDS Sin verificar, WSS En línea |
| E6 | DevTools → Red → Lenta 3G | Peticiones >8 s se cancelan con «La API no respondió a tiempo» |

## R · Diseño responsivo

| # | Dispositivo | Verificar |
|---|---|---|
| R1 | Teléfono vertical (360–412 px) | Control completo sin scroll: menú con indicadores WSS · AWS · RDS integrados (tocarlos comprueba al instante; el detalle está en el texto emergente), los dos mandos lado a lado, Luz · Sonido · On/Off, DETENER y pie visibles a la vez |
| R2 | Teléfono horizontal | Como un control real: conducción a la izquierda, centro con modos, Luz · Sonido · On/Off y DETENER, brazo y pala a la derecha; indicadores dentro del menú; sin scroll |
| R3 | Tableta y escritorio | Misma distribución mando · centro · mando; indicadores en una fila |
| R4 | Teclado solo | Foco visible en todo; modos con Tab + Enter; flechas/WASD conducen, IJKL mueven brazo y pala |

## W · Verificación independiente del WebSocket

**Postman:** *New → WebSocket* → `wss://vehiculos-juan.duckdns.org/ws/vehiculos/1` → *Connect*.
**Chrome:** cualquier extensión cliente WebSocket (p. ej. «Simple WebSocket Client»), misma URL.

1. Al conectar llega `estado_inicial`.
2. Escribe `ping` y envía → llega `pong`.
3. En el Control, toca «Avanzar». En Postman debe llegar:
   ```json
   {"evento":"movimiento_individual","id_vehiculo":1,"comando":"AVANZAR","codigo":1,
    "timestamp":"2026-…+00:00","datos":{"origen":"WEB_PULSO","registrado_en_historial":true,…}}
   ```
   Compara `comando`/`codigo` con el botón pulsado, y `origen` con el modo (`WEB_PULSO`, `WEB_JOYSTICK`, `WEB_BOTON`, `WEB_VOZ`, `WEB_TECLADO`).
4. Inicia una DEMO: llega `demo_iniciada` (con `total_movimientos` = N), luego N mensajes `demo_movimiento` con `orden` 1…N y `registrado_en_historial: false`, y por último `demo_finalizada` con `movimientos_ejecutados: N`.
5. Repite e interrumpe con DETENER: llega `demo_cancelada` con `movimientos_ejecutados` < N.

Recuerda: estos mensajes confirman registro y difusión en el servidor, **no** ejecución física.
