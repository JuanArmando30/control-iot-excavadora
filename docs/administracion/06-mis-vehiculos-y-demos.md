# Etapa 6 · Mis vehículos y editor de DEMO

Estado: **lista y probada localmente** (backend 53 pruebas; navegador 23 + 28 comprobaciones).
Pendiente en el servidor: `probar` V011, snapshot, `aplicar`.

## 1. Qué cambia

| Quién | Qué puede hacer ahora |
|---|---|
| **Comprador** | En Administración › *Mis vehículos*: elegir su unidad; ver las DEMO de fábrica (solo lectura) e iniciarlas; **crear, renombrar, activar, editar, reordenar y eliminar sus DEMO**; iniciarlas con confirmación de seguridad y **DETENER**; ver datos, límites y comandos de su unidad; **autorizar o revocar el soporte** |
| **Empresa** | En la pestaña DEMO, botón **Editor**: la misma herramienta para las DEMO de fábrica (reordenar y validar todo de una vez). Nunca ve ni toca las DEMO privadas |
| **Todos** | Las rutas públicas y técnicas **solo muestran DEMO de fábrica**. **DETENER tiene prioridad** también en el servidor |

## 2. Reglas de seguridad física

| Regla | Dónde se aplica |
|---|---|
| Cada paso dura de 1 ms a `max_paso_ms` y la pausa de 0 a `max_paso_ms` | editor (en vivo) · servicio · SP `sp_guardar_pasos_demo` · al iniciar |
| Máx. `max_pasos_demo` pasos y `max_demo_ms` en total | ídem |
| El comando debe ser del catálogo de **esa** unidad y estar activo | ídem |
| Las rutas técnicas antiguas (agregar/editar paso) también respetan los límites | servicio (cierra **H9**: el firmware no pone tope) |
| Una DEMO creada antes con pasos fuera de límites **no se inicia** (409 con el motivo) | al iniciar |
| No se editan ni borran los pasos de una DEMO **en ejecución** | servicio (409) |
| **DETENER** durante una DEMO: la cancela y se registra (antes respondía 409) | ruta de movimiento |
| Antes de iniciar: confirmar zona despejada, supervisión y nadie más controlando | vista del comprador |

Límites por defecto del modelo actual (V001): paso 10 s, 50 pasos, 300 s. Se cambian en *Modelos*.

## 3. Privacidad de las DEMO

- `demos.ambito = 'privada'` con `id_propietario` (columnas de V004).
- Solo el **dueño vigente** de la unidad crea DEMO privadas (máx. 20 por unidad).
- Para cualquier otro, incluido el administrador y la clave X‑API‑Key, una DEMO privada
  **no existe** (404): no aparece en listados, pasos ni inicio.
- Si la unidad se revende, las DEMO privadas del dueño anterior siguen ocultas para el nuevo.

## 4. Backend

**Migración V011** (`db/migraciones/V011__demos_privadas.sql` + `.down.sql`). No crea ni modifica tablas.

| SP | Para qué |
|---|---|
| `sp_limites_unidad` | Límites del modelo de la unidad (valores por defecto si no tiene modelo) |
| `sp_crear_demo_privada` | Solo el comprador vigente; máx. 20 |
| `sp_guardar_pasos_demo` | Reemplaza **todos** los pasos en una transacción (JSON → `JSON_TABLE`); valida y conserva los anteriores si algo falla |
| `sp_version_esquema` | → 11 |

`probar_v011` prueba los casos que deben funcionar y los que deben fallar, y **reporta si las
DEMO reales ya cumplen los límites** (si alguna no, se verá en el informe).

**Rutas nuevas (8)** → Swagger: 68 operaciones.

| Ruta | Quién |
|---|---|
| `GET /vehiculos/{id}/limites` | lectura de la unidad (como comandos) |
| `GET/POST /mis-vehiculos/{id}/demos` | dueño |
| `GET /mis-vehiculos/{id}/demos/{d}` | dueño |
| `POST /mis-vehiculos/{id}/demos/{d}/actualizar` · `/eliminar` · `/pasos` | dueño, solo DEMO propias |
| `POST /admin/unidades/{id}/demos/{d}/pasos` | administrador, solo DEMO de fábrica |

Iniciar y cancelar usan las rutas de siempre (`/vehiculos/{id}/demos/{d}/iniciar`, `/demos/cancelar`)
con el token del dueño. Auditoría: `demo.crear`, `demo.actualizar`, `demo.eliminar`, `demo.pasos`.

## 5. Frontend

| Archivo | Cambio |
|---|---|
| `assets/js/ui/editor-demo.js` | **Nuevo** · editor de pasos (agregar, quitar, editar, ↑ ↓), validación en vivo y totales |
| `assets/js/pages/admin/comprador.js` | **Nuevo** · vista del comprador: DEMO, Unidad, Soporte; avance y DETENER |
| `administracion.html` | Vista del comprador con pestañas; botón *Editor* en DEMO de la empresa |
| `assets/js/api/auth-api.js` | `mio.*`: DEMO, ejecución, soporte, comandos y límites con token |
| `assets/js/ui/modales.js` | Tamaño configurable y **corrección**: si la API respondía antes de terminar la animación, el modal no se cerraba y un segundo clic duplicaba la acción |
| `assets/css/app.css` | Estilos del editor y de la vista del comprador |

Errores encontrados por la prueba en navegador y corregidos: el modal que no se cerraba
(duplicaba DEMO), `step=100` en los campos de duración (el navegador rechazaba 1000 ms)
y un «null» visible en el resumen del editor.

## 6. Pruebas

- **Backend (53):** 8 nuevas (`tests/test_demos.py`): crear/editar/reordenar/eliminar;
  la DEMO privada no sale por ninguna ruta ajena; límites al guardar; fábrica solo la
  edita la empresa; iniciar privada solo su dueño; DEMO fuera de límites no inicia;
  **DETENER cancela la DEMO**; sin V011 → 503. Mutaciones: quitar el filtro de privadas
  o la prioridad de DETENER hace fallar las pruebas.
- **Navegador (23 ✓):** flujo completo del comprador y de la empresa, móvil sin desbordes,
  foco del teclado tras reordenar, bitácora. Etapa 5 (28 ✓) y Control/Monitoreo sin cambios.

## 7. Pasos en el servidor

1. Commit y push del backend y del frontend; en el servidor `deploy\actualizar_servidor.ps1`.
   Con V010 todo sigue funcionando; las rutas del editor responden 503 hasta V011.
2. `.\.venv\Scripts\python.exe -m app.db.migrar probar` → OK. **Revisa la línea de las DEMO existentes.**
3. Snapshot de RDS (Acciones › Realizar instantánea), p. ej. `antes-v011-AAAAMMDD`, hasta *Disponible*.
4. `.\.venv\Scripts\python.exe -m app.db.migrar aplicar --respaldo antes-v011-AAAAMMDD`
5. `.\.venv\Scripts\python.exe -m app.db.verificar_procedimientos` → `DEMO privadas (V011): 3 de 3`.

## 8. Criterios de aceptación

- [x] DEMO de fábrica y privadas: nombre, descripción, unidad, secuencia ordenada, comando validado y duración limitada.
- [x] Agregar, quitar, editar y reordenar pasos; se guardan y recuperan de RDS vía FastAPI.
- [x] Se ejecutan sin perder la prioridad de DETENER (también en el servidor).
- [x] El servidor valida capacidades, límites, cancelación y rechaza pasos incompatibles.
- [x] El comprador solo ve y edita lo suyo; la empresa no toma sus DEMO privadas.
- [ ] Aplicado en RDS y probado con la unidad real (tras los pasos del servidor).

## 9. Lo que queda para la Etapa 8

Control y Monitoreo siguen operando la unidad de exhibición (#1) con clave/CONTROL_ABIERTO.
En la Etapa 8 tomarán la unidad y el token del usuario (selector, WSS por unidad) y mostrarán
sus DEMO privadas en el botón «Demo» de Control.
