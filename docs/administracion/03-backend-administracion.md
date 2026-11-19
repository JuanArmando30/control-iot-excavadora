# Etapa 3 · Ampliación mínima del backend (Administración)

**Estado:** código escrito. 17 pruebas automáticas pasan (`python -m pytest -q`) y no hay avisos del análisis estático.
**Pendiente en el servidor:** `probar` con V001–V009 → snapshot → `aplicar` → cuenta `vehiculo_api` → verificación en Swagger.
**Antes:** [02-modelo-datos.md](02-modelo-datos.md). **Después:** Etapa 4 (inicio de sesión, roles y autorización por unidad).

## 1. Principios
- **Reutilizar primero.** Las 28 operaciones existentes no cambian de ruta, de forma ni de respuesta.
- **Solo lo que falta:** 21 rutas en `/admin` sobre 25 procedimientos nuevos (V009). Se mantiene la capa `routes → services → repositorio de SP`.
- **Doble barrera:** el servicio valida para responder 404/409 claros, y el SP vuelve a validar dentro de su transacción (`SIGNAL '45000'` → 409 con el mensaje del SP).
- **Independiente del orden de despliegue.** Si la base aún no tiene V009, las rutas `/admin` responden **503** con instrucciones y el historial usa el SP original. Al aplicar V009, la API lo detecta sola en 30 s, sin reiniciar.
- **El administrador gestiona el inventario, no controla unidades vendidas.** Ninguna ruta `/admin` mueve la unidad.

## 2. API actual → función nueva → ajuste

| API actual | Función en el modelo de negocio | Ajuste |
|---|---|---|
| `GET /health`, `GET /health/db` | Indicadores API AWS y RDS | Ninguno |
| `GET /vehiculos`, `GET /vehiculos/{id}` | Detalle técnico de una unidad | Ahora: ninguno. Etapa 4: solo dueño, admin o reserva |
| `POST /vehiculos`, `…/actualizar` | Sustituidas por `POST /admin/unidades` (nace con modelo y catálogo) | Se conservan por compatibilidad |
| `POST /vehiculos/{id}/eliminar` | — | **Con V009 rechaza (409)** una unidad con movimientos: se usa `…/baja` (H13) |
| `GET/POST …/comandos` | Catálogo permitido de la unidad | Etapa 4: solo el admin edita; la unidad nace con las capacidades del modelo |
| `GET …/estado` | Último estado reportado (Monitoreo) | Etapa 4: solo dueño, admin o reserva |
| `GET …/historial` | Últimos 10 persistidos (Monitoreo) | **Con V009 usa `sp_obtener_historial_reciente`** (LIMIT + índice; H8). La respuesta es idéntica |
| `POST …/movimientos` | Control del comprador o del invitado con reserva | Etapa 4: autorización por unidad y autor en el historial |
| DEMO (`…/demos…`) | DEMO de fábrica y privadas | Etapa 6: ámbito, propietario, límites del modelo y reordenar |
| `GET /sesion` | Comprobar el acceso | Etapa 4: `GET /auth/yo` con token |
| WS `/ws/vehiculos/{id}` | Tiempo real por unidad | Etapa 8: canal autenticado + credencial del ESP32 |

## 3. Rutas nuevas (todas exigen al administrador)

| Método y ruta | Hace | SP | Respuestas |
|---|---|---|---|
| `GET /admin/metricas` | Conteos reales del panel | `sp_metricas_admin` | 200 · 401 · 403 · 503 |
| `GET /admin/modelos` · `POST /admin/modelos` | Listar / crear modelo con sus límites | `sp_listar_modelos` · `sp_crear_modelo` | 200/201 · 401 · 403 · 409 · 422 · 503 |
| `GET /admin/modelos/{id}` · `POST …/{id}/actualizar` | Detalle / actualizar | `sp_obtener_modelo` · `sp_actualizar_modelo` | 200 · 404 · 409 · 422 |
| `GET …/{id}/capacidades` · `POST …/{id}/capacidades` · `POST …/capacidades/{codigo}/eliminar` | Comandos que el hardware ejecuta. DETENER siempre disponible para invitados y no se elimina | `sp_listar_capacidades` · `sp_guardar_capacidad` · `sp_eliminar_capacidad` | 200 · 404 · 409 · 422 |
| `GET /admin/unidades?estado&id_modelo&q&limite&desplazamiento` | Inventario paginado con dueño vigente y estado | `sp_listar_unidades` | 200 · 422 |
| `POST /admin/unidades` | Registrar una unidad física o **simulada**, con el catálogo de su modelo | `sp_crear_unidad` | 201 · 404 · 409 · 422 |
| `GET /admin/unidades/{id}` · `POST …/actualizar` · `POST …/baja` | Detalle / actualizar (vendida solo por asignación) / baja que conserva el historial | `sp_obtener_unidad` · `sp_actualizar_unidad` · `sp_baja_unidad` | 200 · 404 · 409 · 422 |
| `GET /admin/usuarios?rol&activo&q&…` · `POST /admin/usuarios` | Clientes y administradores. Correo normalizado y único; sin contraseña hasta la Etapa 4 | `sp_listar_usuarios` · `sp_crear_usuario` | 200/201 · 400 · 409 · 422 |
| `GET /admin/usuarios/{id}` · `POST …/actualizar` | Nombre, rol y activo. Protege al último admin; desactivar revoca sus sesiones | `sp_obtener_usuario` · `sp_actualizar_usuario` | 200 · 404 · 409 |
| `GET /admin/asignaciones?id_vehiculo&id_usuario&vigentes&…` | Historial comercial | `sp_listar_asignaciones` | 200 |
| `POST /admin/asignaciones` | Asignar a un cliente activo: cierra la anterior, revoca el soporte y marca vendida, **en una transacción** | `sp_asignar_unidad` | 201 · 404 · 409 |
| `POST /admin/asignaciones/{id}/finalizar` | Deja la unidad en inventario, exhibición o baja | `sp_finalizar_asignacion` | 200 · 409 · 422 |
| `GET /admin/auditoria?accion&id_usuario&recurso_tipo&recurso_id&desde&hasta&…` | Bitácora (solo lectura; no hay ruta para modificarla) | `sp_listar_auditoria` | 200 |

Paginación: `limite` de 1 a 200 (50 por defecto) y `desplazamiento`. La respuesta es `{total, limite, desplazamiento, elementos}`, y `total` viene de `COUNT(*) OVER ()` en el mismo SP.

Auditoría: `modelo.crear`, `modelo.actualizar`, `capacidad.guardar`, `capacidad.eliminar`, `unidad.crear`, `unidad.actualizar`, `unidad.baja`, `usuario.crear`, `usuario.actualizar`, **`rol.cambiar`**, `asignacion.crear` y `asignacion.finalizar`. El detalle va en JSON sin secretos; en las actualizaciones guarda solo los campos que cambiaron.

## 4. Privilegios mínimos (corrige H12)

```powershell
cd C:\vehiculo_oit
.\.venv\Scripts\python.exe -m app.db.migrar crear-cuenta-api
```

- **Qué hace:** crea `vehiculo_api` con **solo `EXECUTE`** sobre `vehiculo_iot` y una contraseña aleatoria que se muestra una vez.
- **Comprobación:** verifica que la cuenta ejecuta los SP y que **no puede leer tablas** (`SELECT` → error 1142).
- **Después:** indica cómo editar el `.env`. `DB_USER` y `DB_PASSWORD` pasan a la cuenta nueva; la administrativa queda en `DB_MIGRA_USER` y `DB_MIGRA_PASSWORD`, solo para `migrar`, `exportar_esquema` y `verificar_procedimientos`.

## 5. Pruebas

| Dónde | Qué cubre |
|---|---|
| `tests/` con pytest (sin base de datos; repositorio falso) | 401 sin clave o con clave equivocada · 403 con clave de operador · 503 sin V009, con el historial siguiendo · historial con LIMIT con V009 · 422 en límites incoherentes · DETENER siempre para invitados y no eliminable · unidad nace con el catálogo · no nace ni se vuelve «vendida» a mano · paginación · baja en lugar de borrar · 409 al borrar un vehículo con historial · correo normalizado, único y válido · último admin protegido · `rol.cambiar` auditado · asignar, reasignar (un dueño vigente) y finalizar · auditoría paginada con JSON · métricas · las rutas previas siguen en Swagger (28 + 21) |
| `migrar probar` en la copia de RDS (`pruebas_procedimientos.py`) | Los 25 SP contra MySQL real, incluidas las reglas que deben fallar: unidad que nace vendida, asignar a un admin, asignación repetida, cambio de rol con unidades, baja con comprador, borrar una unidad con historia comercial (1451), CHECK de límites y de rol del actor, correo repetido sin importar mayúsculas, `LIMIT` del historial. Al terminar no quedan datos de prueba |

## 6. Pasos en el servidor (en este orden)

```powershell
# 1. Traer el código (la API arranca igual: /admin responde 503 hasta aplicar V009)
powershell -ExecutionPolicy Bypass -File C:\vehiculo_oit\deploy\actualizar_servidor.ps1
cd C:\vehiculo_oit
# 2. Prueba en la copia con V001–V009
.\.venv\Scripts\python.exe -m app.db.migrar probar
# 3. Snapshot manual de RDS (consola de AWS) y aplicar
Stop-ScheduledTask VehiculoAPI
.\.venv\Scripts\python.exe -m app.db.migrar aplicar --respaldo <nombre-del-snapshot>
Start-ScheduledTask VehiculoAPI
.\.venv\Scripts\python.exe -m app.db.verificar_procedimientos
# 4. Cuenta con privilegios mínimos y reinicio
.\.venv\Scripts\python.exe -m app.db.migrar crear-cuenta-api
```

## 7. Criterios de aceptación de la Etapa 3

- [x] Rutas mínimas con esquemas Pydantic, códigos 200/201/400/401/403/404/409/422/503, paginación, filtros y validaciones.
- [x] Capas `routes → services → repositorio`, SP parametrizados y credenciales solo en el `.env` del servidor.
- [x] Las 28 operaciones previas siguen en Swagger y responden igual (prueba automática).
- [x] Pruebas automáticas: 17 pasan.
- [ ] `probar` con V001–V009 = PASÓ.
- [ ] Aplicado en la base real con snapshot; `verificar_procedimientos`: 21 + 25.
- [ ] API con `vehiculo_api` (solo EXECUTE); Control y Monitoreo funcionan igual.
- [ ] En Swagger (`/docs`, con la clave de admin): crear un modelo con DETENER, registrar una unidad simulada, crear un cliente, asignar y ver la auditoría.

**Para la Etapa 4:**
- `ActorAdmin` pasará a ser el usuario del token, sin cambiar las rutas.
- Llegan login, renovación con rotación, cierre de sesión, códigos de restablecimiento, RBAC y autorización por unidad en REST.
- También el límite de tasa.
