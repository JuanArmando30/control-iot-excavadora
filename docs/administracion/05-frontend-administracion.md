# Etapa 5 · Frontend de ADMINISTRACIÓN (panel, inventario, clientes)

Estado: **lista y probada en navegador** contra el backend real (FastAPI) con
datos de prueba en memoria. Pendiente: publicar (push del frontend y del backend).

## 1. Qué ve cada quien en `administracion.html`

| Quién entra | Vista |
|---|---|
| Nadie (sin sesión ni clave) | Tarjeta **Iniciar sesión** + «Tengo un código del administrador» + «Usar la clave X‑API‑Key (transición)» |
| Administrador (token) | Panel · Inventario · Modelos · Clientes · Asignaciones · Bitácora · Vehículos · Comandos · DEMO · Configuración |
| Comprador (token, rol usuario) | **Mis vehículos** (solo sus unidades). Su control/monitoreo/editor llega en la Etapa 6 |
| Clave de admin (transición) | Igual que el administrador (auditoría sin `id_usuario`) |
| Clave de operador (transición) | Solo Vehículos, Comandos, DEMO y Configuración |

Cambio de comportamiento: antes cualquiera podía **consultar** las tablas de
Administración sin clave; ahora la página pide iniciar sesión. Control y
Monitoreo **no cambian** en esta etapa.

## 2. Secciones nuevas

| Pestaña | Endpoints | Qué permite |
|---|---|---|
| Panel | `GET /admin/metricas`, `GET /admin/auditoria?limite=8` | Métricas reales de RDS (unidades por estado, clientes, asignaciones, DEMO, movimientos 24 h/7 d/total, último movimiento) y últimas acciones. Sin datos de ejemplo: si falla, se muestra el error |
| Inventario | `GET/POST /admin/unidades`, `…/actualizar`, `…/baja`, `POST /admin/asignaciones`, `…/finalizar` | Filtros (texto, estado, modelo), paginación, registrar (copia el catálogo del modelo), editar, **asignar** (vender), **liberar**, **baja** (en lugar de borrar) |
| Modelos | `GET/POST /admin/modelos`, `…/actualizar`, `…/capacidades`, `…/eliminar` | Límites de seguridad por modelo y sus capacidades (tipo, código, permitido a invitados). DETENER no se puede borrar |
| Clientes | `GET/POST /admin/usuarios`, `…/actualizar`, `…/codigo-restablecimiento` | Alta, edición (rol, activo), **código de un solo uso** mostrado una vez con botón Copiar. Nunca se escribe la contraseña de otro |
| Asignaciones | `GET/POST /admin/asignaciones`, `…/finalizar` | Vigentes / históricas, nueva asignación, finalizar con estado resultante |
| Bitácora | `GET /admin/auditoria` | Filtro por tipo de acción, paginación, detalle JSON |

Vehículos, Comandos, DEMO y Configuración se conservan. Ahora el administrador
con sesión **no necesita la clave** para editarlos (ajuste del backend: el token
admin equivale a la clave de admin en esas rutas; un token de comprador → 403).

## 3. Sesión en el navegador

| Dato | Dónde | Por qué |
|---|---|---|
| Token de acceso (JWT, 10 min) | **Solo en memoria** | Un XSS no lo encuentra en el almacenamiento; caduca pronto |
| Token de renovación | `sessionStorage` | Sobrevive a recargar/cambiar de página; se borra al cerrar la pestaña. Rota en cada uso y el servidor detecta la reutilización |
| Contraseña | En ningún lado | Solo viaja en `POST /auth/login` |

- Renovación automática 60 s antes de caducar, en **vuelo único** (varias
  peticiones simultáneas → una sola renovación).
- Ante un 401 con token: se renueva **una vez** y se repite la petición; si
  falla, se vuelve a la tarjeta de inicio de sesión.
- Al volver a la pestaña tras suspender el equipo se renueva si hace falta.
- «Cerrar sesión» revoca la familia en el servidor y borra todo localmente.
- Límite conocido: «Duplicar pestaña» copia el `sessionStorage`; la primera
  pestaña que renueve invalida a la otra (se pide iniciar sesión de nuevo). Es
  el comportamiento seguro de la rotación.

## 4. Archivos

| Archivo | Cambio |
|---|---|
| `administracion.html` | Tres vistas (acceso, comprador, admin), 6 pestañas nuevas, botón de sesión |
| `assets/js/core/sesion-store.js` | **Nuevo** · estado de la sesión, renovación programada y de vuelo único |
| `assets/js/core/http-client.js` | `auth: "sesion"` (Bearer), token admin como alternativa a la clave, reintento tras 401, mensajes del servidor en 401/403/429/503 |
| `assets/js/core/validadores.js` | Validación de sesión, páginas y código |
| `assets/js/api/auth-api.js`, `admin-api.js` | **Nuevos** · `/auth/*`, `/mis-vehiculos`, `/admin/*` |
| `assets/js/ui/sesion-ui.js`, `admin-ui.js` | **Nuevos** · acceso, restablecer, cambiar contraseña; tablas, paginador, formularios |
| `assets/js/pages/admin/*.js` | **Nuevos** · panel, inventario, modelos, clientes, asignaciones, bitácora |
| `assets/js/pages/administracion.js` | Vistas por rol, carga perezosa por pestaña |
| `assets/js/config.js` | Rutas de sesión y administración, `renovarAntesMs`, `paginaAdmin` |
| `assets/css/app.css`, `assets/icons/sprite.svg` | Estilos de la etapa e iconos (usuario, salir, asignar, gráfica) |
| Backend `app/api/dependencies.py` | `obtener_rol` acepta el token de administrador (+1 prueba) |

## 5. Pruebas realizadas

**Backend:** 45 pruebas (`python -m pytest -q`), incluida la nueva del token admin en el catálogo técnico.

**Navegador** (Chrome sin ventana, backend real con repositorio en memoria), 28 comprobaciones ✓:

- Sin sesión: solo la tarjeta de acceso; contraseña errónea → mensaje genérico.
- Admin entra: panel con 10 métricas; token de acceso fuera del almacenamiento;
  renovación en `sessionStorage`; botón con su nombre; clave oculta.
- Las 8 pestañas cargan datos sin errores; filtro por estado; selector de vehículo solo en Comandos/DEMO.
- Generar código → `XXXXX-XXXXX`; el usuario nuevo pone su contraseña con él y entra.
- Recargar la página recupera la sesión; cerrar sesión borra el token de renovación.
- Comprador: no ve Administración; sin unidades → estado vacío; con unidad → **solo la suya**.
- Teléfono 390 px: sin desplazamiento horizontal; formularios y tablas usables.
- Regresión: Control (13 botones) y Monitoreo (10 filas de historial) sin errores.

## 6. Criterios de aceptación

- [x] Navegación CONTROL | MONITOREO | ADMINISTRACIÓN conservada, vistas por rol.
- [x] Panel con métricas reales; inventario, modelos, clientes, asignaciones, comandos, DEMO y bitácora.
- [x] Estados vacíos, de carga y de error en cada tabla; paginación.
- [x] Teclado: pestañas, formularios y modales accesibles; `aria-live` en listas; contraste del tema.
- [x] Pantallas pequeñas sin scroll horizontal.
- [x] Sin datos ficticios en la página publicada; sin secretos en el código.
- [ ] Publicado y probado contra RDS real (tras el push).

## 7. Publicación

1. **Backend** (un cambio pequeño en `dependencies.py` + prueba): commit y push, luego en el
   servidor `deploy\actualizar_servidor.ps1`. No hay migraciones nuevas.
2. **Frontend:** commit y push a GitHub Pages.
3. Abrir `https://juanarmando30.github.io/control-iot-excavadora/administracion.html`, iniciar
   sesión con tu cuenta de administrador y recorrer las pestañas.
