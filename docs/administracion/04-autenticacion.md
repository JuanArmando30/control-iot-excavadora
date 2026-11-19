# Etapa 4 · Autenticación, roles y autorización por unidad

Estado: **backend listo y probado localmente** (44 pruebas). Pendiente en el
servidor: `TOKEN_SECRETO`, `probar`, snapshot, `aplicar` V010 y primer administrador.

## 1. Qué se construyó

| Pieza | Archivo (backend) | Qué hace |
|---|---|---|
| Migración V010 | `db/migraciones/V010__autenticacion.sql` (+ `.down.sql`) | 14 SP nuevos (login, tokens, códigos, soporte, acceso por unidad, historial con autor); `sp_version_esquema` → 10. No crea ni borra tablas (ya existen desde V002/V003/V006). |
| Tokens | `app/core/tokens.py` | JWT HS256 de acceso (10 min); token de renovación opaco de 256 bits; HMAC‑SHA256 para guardar tokens y códigos. |
| Contraseñas | `app/core/contrasenas.py` | Argon2id; política 10–128 caracteres, letras y números, sin el correo; hash ficticio para igualar tiempos. |
| Límite de tasa | `app/core/limite.py` | Ventana deslizante en memoria; IP real detrás de Caddy (`X-Forwarded-For` solo si llega de 127.0.0.1). |
| Servicio | `app/services/auth_service.py` | Login, renovar, salir, restablecer, cambiar contraseña, códigos, autorización por unidad, soporte. |
| Dependencias | `app/api/dependencies.py` | `Sesion`, `PrincipalOpcional`, `ActorAdmin` (token admin **o** clave), `ControlUnidad`, `LecturaUnidad`. |
| Rutas | `app/api/routes/auth.py`, `admin.py` | 10 rutas nuevas + 1 en `/admin`. |
| CLI | `app/db/primer_admin.py` | Crea el primer administrador y muestra un código de un solo uso. |
| Pruebas | `tests/test_autenticacion.py`, `pruebas_procedimientos.probar_v010` | 27 pruebas de API (repositorio falso) + prueba de los SP reales en la copia. |

## 2. Rutas nuevas

| Método y ruta | Quién | Respuesta |
|---|---|---|
| `POST /auth/login` | cualquiera | sesión (`token_acceso`, `token_renovacion`, `usuario`) |
| `POST /auth/renovar` | quien tenga el token de renovación | sesión nueva (rota el token) |
| `POST /auth/salir` | ídem | 204; revoca la familia |
| `GET /auth/yo` | con sesión | usuario (releído de la base) |
| `POST /auth/restablecer` | con código del admin | 200 / 400 genérico |
| `POST /auth/cambiar-contrasena` | con sesión | sesión nueva; cierra las demás |
| `GET /mis-vehiculos` | comprador | solo sus unidades vigentes |
| `GET /mis-vehiculos/{id}/soporte` | dueño o admin | autorizaciones |
| `POST /mis-vehiculos/{id}/soporte` | dueño | autoriza 1–72 h (a un admin o a cualquiera) |
| `POST /mis-vehiculos/{id}/soporte/revocar` | dueño | revoca de inmediato |
| `POST /admin/usuarios/{id}/codigo-restablecimiento` | admin | código XXXXX‑XXXXX, 30 min, se muestra una vez |

Swagger: 28 originales + 22 de `/admin` + 10 de sesión = **60 operaciones**.
Todas las rutas anteriores siguen igual.

## 3. Decisiones de seguridad

| Riesgo | Medida |
|---|---|
| Robo del token de acceso (XSS) | Vive solo en memoria y caduca en 10 min. |
| Robo del token de renovación | Rota en cada uso; si se presenta uno **ya usado** se revoca toda la familia (`sesion.reutilizacion` en la auditoría). |
| Copia de la base | Contraseñas en Argon2id; tokens y códigos solo como HMAC con `TOKEN_SECRETO` (que no está en la base). |
| Fuerza bruta | 5 fallos → bloqueo de 15 min (en la base) + 20 intentos/5 min por IP + 10/15 min por correo. Códigos: 5 intentos y 30 min. |
| Enumerar correos | Mismo mensaje y tiempo (hash ficticio) para correo inexistente y contraseña errónea. |
| Rol o baja desactualizados | En cada petición el usuario se relee de la base: desactivar o cambiar el rol tiene efecto inmediato; el rol del JWT se ignora. |
| BOLA / IDOR | `sp_acceso_unidad` + `exigir_acceso_unidad`: un comprador no opera ni lee (con lectura cerrada) unidades ajenas → 403. |
| La empresa opera una unidad vendida | Solo con **autorización de soporte vigente** dada por el comprador; caduca y se puede revocar; queda auditado. |
| Tokens en caché | `Cache-Control: no-store` en respuestas con tokens o códigos. |
| JWT manipulado, `alg: none`, otro secreto, vencido | 401 (algoritmo fijo HS256, emisor y `exp` obligatorios). |

Reglas de autorización por unidad:

| Rol | inventario / exhibición | vendida | baja |
|---|---|---|---|
| usuario (comprador) | solo si es el dueño vigente | solo si es el dueño | solo si es el dueño |
| admin | ✅ | solo con soporte vigente | ❌ |

## 4. Transición (lo que sigue abierto hasta la Etapa 9)

Se conservan a propósito, como acordamos:

- **`X-API-Key`** sigue aceptándose en escrituras, control y `/admin` (sin
  autorización por unidad, y en la auditoría `id_usuario = NULL`).
- **`CONTROL_ABIERTO=true`** sigue permitiendo mover sin nada, también una
  unidad vendida. Esto choca con la autorización por unidad; se cierra en la Etapa 9.
- **`LECTURA_ABIERTA=true`** (por defecto): estado, historial, comandos y
  DEMO se leen sin sesión, como hoy. Con `false` exigen dueño/admin/soporte o clave.
- El **WebSocket** sigue público (H1) hasta la Etapa 8.

## 5. Variables nuevas en `.env`

| Variable | Valor | Nota |
|---|---|---|
| `TOKEN_SECRETO` | 48+ caracteres aleatorios | Obligatoria para sesiones. Sin ella `/auth/*` da 503 y el resto funciona. Cambiarla cierra todas las sesiones e invalida los códigos pendientes. |
| `TOKEN_ACCESO_MIN` | 10 | 1–60 |
| `TOKEN_RENOVACION_DIAS` | 3 | 1–30 |
| `LECTURA_ABIERTA` | true | false al terminar la transición |

## 6. Pasos en el servidor

1. Actualizar el código: `deploy\actualizar_servidor.ps1` (instala PyJWT y
   argon2‑cffi porque cambió `requirements.txt` y reinicia el servicio).
   Con V009 la API sigue funcionando; `/auth/*` responde 503 hasta V010.
2. Generar el secreto y agregarlo al `.env` (no lo compartas en el chat):
   `python -c "import secrets; print(secrets.token_urlsafe(48))"` →
   `TOKEN_SECRETO=...`. Reiniciar el servicio.
3. `python -m app.db.migrar probar` → debe terminar en OK (aplica V010 a la
   copia, ejecuta `probar_v010`, revierte y vuelve a aplicar).
4. Crear un **snapshot manual** de RDS en la consola de AWS y anotar su nombre
   real (no el de la instancia).
5. `python -m app.db.migrar aplicar --respaldo NOMBRE-DEL-SNAPSHOT` (sin `< >`).
6. `python -m app.db.verificar_procedimientos` → `Autenticación (V010): 14 de 14`.
7. `python -m app.db.primer_admin --correo TU-CORREO --nombre "Administración"` →
   muestra un código de un solo uso.
8. En `/docs`: `POST /auth/restablecer` (correo, código, contraseña nueva) →
   `POST /auth/login` → botón **Authorize** → `HTTPBearer` con el `token_acceso`
   → `GET /auth/yo` debe responder tu usuario con rol `admin`.

## 7. Criterios de aceptación

- [x] Login correcto devuelve acceso (10 min) + renovación; error genérico sin enumerar correos.
- [x] 5 fallos bloquean 15 min; límite por IP responde 429.
- [x] La renovación rota; reutilizar un token viejo revoca toda la sesión.
- [x] Cerrar sesión, cambiar o restablecer la contraseña y desactivar la cuenta invalidan las sesiones.
- [x] Códigos: un solo uso, caducan, se agotan con 5 intentos, el nuevo invalida el anterior, solo se guarda su HMAC.
- [x] Comprador A no opera ni lee (lectura cerrada) la unidad de B → 403; `/mis-vehiculos` solo lista las suyas.
- [x] Admin sin soporte en unidad vendida → 403; con soporte → 201; al revocar → 403.
- [x] El historial guarda el autor (`id_usuario`) cuando hay sesión y V010.
- [x] Las acciones del admin con token quedan en la auditoría con su `id_usuario`.
- [x] `X-API-Key` y `CONTROL_ABIERTO` siguen funcionando; sin V010 o sin secreto, solo `/auth/*` da 503.
- [x] CORS permite la cabecera `Authorization`.
- [ ] En el servidor: `probar` OK, snapshot, `aplicar`, primer administrador e inicio de sesión real.

## 8. Lo que usará la Etapa 5 (frontend)

- Token de acceso en memoria (variable JS), renovación ~1 min antes de `acceso_expira`.
- El token de renovación tiene que sobrevivir a recargar la página: la Etapa 5
  propondrá `sessionStorage` (se borra al cerrar la pestaña), con la rotación y la
  detección de reutilización como defensa ante robo.
- Ante 401: intentar `/auth/renovar` una vez; si falla, volver al inicio de sesión.
