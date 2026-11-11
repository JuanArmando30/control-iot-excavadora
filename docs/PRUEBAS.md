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
| B5 | Quita la clave (Olvidar clave) con el acceso de prueba desactivado | Controles deshabilitados y aviso «Falta la clave» |
| B6 | Toca Luz, luego Sonido, luego Luz | Aviso centrado (~3 s, con icono y barra de tiempo): «Luz encendida», «Sonido activado», «Luz apagada». Cada botón queda en ámbar sólido con luz piloto y texto «Luz ON» / «Sonido ON» / «Encendida» (en horizontal: icono + «ON») hasta que se vuelve a tocar; entonces vuelve a normal. El estado se conserva al recargar. En horizontal el aviso no tapa DETENER |
| B7 | Acceso de prueba activo (`accesoLibre`) y navegador sin clave guardada | No pide clave; el botón superior dice «Acceso de prueba» y el control funciona |

## D · DETENER

En Monitoreo (Eventos WSS) cada caso debe mostrar **un solo** DETENER, salvo D2b.

| # | Pasos | Resultado esperado |
|---|---|---|
| D1 | Toca DETENER | `POST` con DETENER al instante (pointerdown), estado *Registrado* |
| D2 | Toca Avanzar e inmediatamente DETENER | Un solo DETENER aunque AVANZAR responda después del paro (el WSS confirma que el servidor lo aplicó antes) |
| D2b | Igual que D2, pero si el servidor aplica AVANZAR **después** del DETENER (se ve en el orden de eventos WSS) | Se reafirma DETENER automáticamente: el último evento siempre es DETENER |
| D6 | Mantén el joystick o inclina el teléfono más de 2.4 s y suelta / nivela | Un solo DETENER |
| D3 | Espacio o Esc en el teclado | DETENER |
| D4 | Di «alto» (o «detente», «frena», «quieto») en modo Voz | DETENER sin esperar el resultado final del reconocimiento; también si «alto» aparece solo en una de las alternativas del reconocedor |
| D5 | DETENER durante una DEMO | Llama a `POST …/demos/cancelar`; llega `demo_cancelada` con `detenido_con: "DETENER"` |

## G · Giroscopio (modo Giro, en un teléfono real por HTTPS)

| # | Pasos | Resultado esperado |
|---|---|---|
| G0 | Cambia entre Pulso, Joystick, Voz y Giro | Giro tiene paneles propios (indicador de teléfono + botonera 2×2 de brazo y pala); no aparecen en los otros modos, y los otros no aparecen en Giro |
| G1 | Toca «Activar» (en iPhone acepta el permiso de movimiento) y sostén el teléfono cómodo | El teléfono dibujado queda recto y la burbuja al centro: esa postura es la neutral. No se envía nada |
| G2 | Aleja el borde superior ~15–20° | AVANZAR (origen `WEB_GIROSCOPIO`), flecha superior iluminada; mientras sigas inclinado, un reenvío cada 2.4 s |
| G3 | Acerca el borde superior / inclina a la derecha / a la izquierda | RETROCEDER / GIRAR_DERECHA / GIRAR_IZQUIERDA (un solo `POST` por cambio) |
| G4 | Vuelve a la postura neutral (o inclina menos de ~7°) | DETENER |
| G5 | Repite G2–G4 con el teléfono en horizontal | Mismo comportamiento: los ejes siguen a la pantalla, no al teléfono |
| G6 | Inclinado: intenta usar Subir, Pala o Luz | Botones deshabilitados (una orden a la vez); al nivelar se habilitan |
| G7 | Nivelado: usa Subir / Bajar / Pala izq. / Pala der. / Luz / Sonido / On-Off | Envían su comando como en modo Pulso |
| G8 | Voltea el teléfono boca abajo o inclínalo más de ~65° | DETENER inmediato, sin órdenes intermedias; no conduce hasta volver a la postura neutral |
| G9 | Inclinado, toca DETENER | DETENER y el giroscopio queda en pausa (hay que tocar «Activar» de nuevo) |
| G10 | Inclinado, cambia de pestaña / bloquea la pantalla / gira la pantalla | DETENER; al girar la pantalla se toma una nueva postura neutral |
| G11 | «Centrar» con el teléfono en otra postura | La nueva postura pasa a ser la neutral |
| G12 | En una PC sin sensor, toca «Activar» | «No llegan datos del sensor…»; no se envía nada |

## V · Voz (modo Voz; también sirve escribir la frase en «…o escribe una orden»)

| # | Frase | Resultado esperado |
|---|---|---|
| V1 | «regresa», «échate pa'trás», «retrocede» | RETROCEDER (origen `WEB_VOZ`) |
| V2 | «voltea a la izquierda», «dale a la derecha», «hacia el lado derecho» | GIRAR_IZQUIERDA / GIRAR_DERECHA |
| V3 | «sigue derecho», «camina», «avanza un poquito» | AVANZAR («derecho» = recto, salvo «lado derecho») |
| V4 | «súbele al brazo», «bájale a la pala», «levanta la pala» | SUBIR_BRAZO / BAJAR_BRAZO |
| V5 | «gira la cuchara a la izquierda», «pala a la derecha» | GIRAR_PALA_IZQUIERDA / GIRAR_PALA_DERECHA |
| V6 | «prende la luz», «toca el claxon», «enciende el motor» | LUZ / SONIDO / ENCENDER_APAGAR (el sustantivo manda: «prende la luz» no es encendido) |
| V7 | «avanza y luego gira a la derecha» | AVANZAR y, 1.2 s después, GIRAR_DERECHA; la pantalla muestra «Avanzar → Girar derecha» |
| V8 | «avanza tres veces» y DETENER durante la secuencia | Se envía el primer AVANZAR, DETENER corta el resto; pantalla «… cancelada con DETENER» |
| V9 | «a la izquierda, no, mejor a la derecha» | Solo GIRAR_DERECHA (corrección) |
| V10 | «no avances» | No envía nada («Entendido: no hago nada») |
| V11 | «otra vez» | Repite la última orden de voz |
| V12 | Errores típicos del reconocedor: «abanza», «isquierda», «retro sede» | Se entienden como avanza, izquierda, retrocede |
| V13 | «para», «quieto», «no te muevas», «párale» | DETENER inmediato. «para atrás» **no** detiene: retrocede |
| V14 | «hola qué tal» | No envía nada y sugiere frases de ejemplo |

## M · DEMO

**Desde Control (botón «Demo» de la fila central, en los 4 modos):**

| # | Pasos | Resultado esperado |
|---|---|---|
| MC1 | Toca «Demo» | Se abre el panel «Elegir DEMO» con las DEMO activas, su número de pasos y duración; la última usada aparece seleccionada. Las DEMO sin pasos aparecen deshabilitadas |
| MC2 | Elige una DEMO y toca «Iniciar DEMO» | `POST …/demos/{id}/iniciar`; el panel se cierra; el botón muestra «Demo n/N» con barra de avance; aviso «DEMO «…» (n/N): mando bloqueado» |
| MC3 | Toca «Cancelar» en el panel | No se envía nada |
| MC4 | Durante la DEMO toca «Demo» o DETENER | `POST …/demos/cancelar`; vuelve a «Demo» |
| MC5 | En el panel toca «Crear o editar» | Abre Administración directamente en la pestaña DEMO |
| MC6 | Di (o escribe) «inicia la demo» en modo Voz | Inicia la última DEMO elegida (o la primera activa) |
| MC7 | Sin clave o sin WSS | Botón deshabilitado |
| MC9 | Inicia una DEMO y recorre los 4 modos mientras corre | El mando queda atenuado y **solo brilla lo que hace cada paso**, durante lo que dura: Pulso = el botón de la cruceta (o de brazo/pala, o el accesorio); Joystick = la perilla se desplaza hacia la dirección; Giro = el teléfono dibujado se inclina y se ilumina la etiqueta (brazo/pala: la botonera 2×2); Voz = tarjeta «Paso n de N · acción». DETENER de la DEMO hace destellar el botón DETENER. La banda superior muestra «DEMO «…» · paso n/N · acción» con barra de avance. Al terminar todo vuelve a la normalidad |
| MC8 | Teléfono horizontal estrecho (p. ej. 640×360) | Si Luz · Sonido · On/Off · Demo no caben en una fila, Demo pasa abajo **centrada** |

**Desde Monitoreo:**

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
| R5 | Modo Giro en vertical y horizontal | Indicador del teléfono con Activar/Centrar a la izquierda, botonera 2×2 de brazo y pala a la derecha, accesorios y DETENER al centro; sin scroll |
| R6 | Pantalla de carga | Al entrar o recargar: animación completa ~3.5 s. Al navegar entre Control, Monitoreo y Administración: versión corta ~1.8 s con «Abriendo <sección>». Siempre desaparece sola. Con «reducir movimiento» activado en el sistema no se muestra |

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
