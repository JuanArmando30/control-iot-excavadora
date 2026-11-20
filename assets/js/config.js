/**
 * Configuración pública del frontend.
 * NO contiene secretos: la clave X-API-Key la escribe el operador en la página
 * y nunca se guarda en el repositorio.
 *
 * Si cambia el dominio, actualiza también la directiva connect-src de la
 * etiqueta <meta http-equiv="Content-Security-Policy"> de los tres HTML.
 */

const API_BASE_URL = "https://vehiculos-juan.duckdns.org";
const WS_BASE_URL = "wss://vehiculos-juan.duckdns.org";

/* Rutas reales del backend (app/api/routes/*.py). Todas usan GET o POST. */
const RUTAS = Object.freeze({
  // Sistema
  salud: () => "/health",                         // sistema.py → {"estado":"ok"}
  saludDb: () => "/health/db",                    // sistema.py → {"estado":"ok"} | 503
  sesion: () => "/sesion",                        // control.py → {"rol":"operador"|"admin", "acceso":"clave"|"abierto"}
  // Vehículos
  vehiculos: () => "/vehiculos",
  vehiculo: (v) => `/vehiculos/${v}`,
  vehiculoActualizar: (v) => `/vehiculos/${v}/actualizar`,
  vehiculoEliminar: (v) => `/vehiculos/${v}/eliminar`,
  // Catálogo de comandos
  comandos: (v) => `/vehiculos/${v}/comandos`,
  comandoActualizar: (v, c) => `/vehiculos/${v}/comandos/${c}/actualizar`,
  comandoEliminar: (v, c) => `/vehiculos/${v}/comandos/${c}/eliminar`,
  // Estado e historial
  estado: (v) => `/vehiculos/${v}/estado`,
  historial: (v) => `/vehiculos/${v}/historial`,
  // Movimiento individual
  movimientos: (v) => `/vehiculos/${v}/movimientos`,
  // DEMO
  demos: (v) => `/vehiculos/${v}/demos`,
  demoActualizar: (v, d) => `/vehiculos/${v}/demos/${d}/actualizar`,
  demoEliminar: (v, d) => `/vehiculos/${v}/demos/${d}/eliminar`,
  demoIniciar: (v, d) => `/vehiculos/${v}/demos/${d}/iniciar`,
  demoCancelar: (v) => `/vehiculos/${v}/demos/cancelar`,
  demoEjecucion: (v) => `/vehiculos/${v}/demos/ejecucion`,
  demoMovimientos: (v, d) => `/vehiculos/${v}/demos/${d}/movimientos`,
  demoMovActualizar: (v, d, m) => `/vehiculos/${v}/demos/${d}/movimientos/${m}/actualizar`,
  demoMovEliminar: (v, d, m) => `/vehiculos/${v}/demos/${d}/movimientos/${m}/eliminar`,
  // Sesión (Etapa 4 · app/api/routes/auth.py)
  authLogin: () => "/auth/login",
  authRenovar: () => "/auth/renovar",
  authSalir: () => "/auth/salir",
  authYo: () => "/auth/yo",
  authRestablecer: () => "/auth/restablecer",
  authCambiar: () => "/auth/cambiar-contrasena",
  misVehiculos: () => "/mis-vehiculos",
  // Comprador: soporte y DEMO propias (Etapas 4 y 6)
  miSoporte: (v) => `/mis-vehiculos/${v}/soporte`,
  miSoporteRevocar: (v) => `/mis-vehiculos/${v}/soporte/revocar`,
  misDemos: (v) => `/mis-vehiculos/${v}/demos`,
  miDemo: (v, d) => `/mis-vehiculos/${v}/demos/${d}`,
  miDemoActualizar: (v, d) => `/mis-vehiculos/${v}/demos/${d}/actualizar`,
  miDemoEliminar: (v, d) => `/mis-vehiculos/${v}/demos/${d}/eliminar`,
  miDemoPasos: (v, d) => `/mis-vehiculos/${v}/demos/${d}/pasos`,
  limites: (v) => `/vehiculos/${v}/limites`,
  adminDemoPasos: (v, d) => `/admin/unidades/${v}/demos/${d}/pasos`,
  // Invitados (Etapa 7 · app/api/routes/invitado.py)
  invCatalogo: () => "/invitado/catalogo",
  invReservar: () => "/invitado/reservar",
  invEstado: () => "/invitado/estado",
  invLatido: () => "/invitado/latido",
  invTerminar: () => "/invitado/terminar",
  adminExhibicion: (v) => `/admin/unidades/${v}/exhibicion`,
  adminExhibicionTerminar: (v) => `/admin/unidades/${v}/exhibicion/terminar`,
  // Tiempo real y dispositivo (Etapa 8)
  wsTicket: () => "/ws/ticket",
  adminDispositivo: (v) => `/admin/unidades/${v}/dispositivo`,
  adminDispositivoRevocar: (v) => `/admin/unidades/${v}/dispositivo/revocar`,
  // Administración (Etapa 3 · app/api/routes/admin.py)
  adminMetricas: () => "/admin/metricas",
  adminModelos: () => "/admin/modelos",
  adminModeloActualizar: (m) => `/admin/modelos/${m}/actualizar`,
  adminCapacidades: (m) => `/admin/modelos/${m}/capacidades`,
  adminCapacidadEliminar: (m, c) => `/admin/modelos/${m}/capacidades/${c}/eliminar`,
  adminUnidades: () => "/admin/unidades",
  adminUnidadActualizar: (v) => `/admin/unidades/${v}/actualizar`,
  adminUnidadBaja: (v) => `/admin/unidades/${v}/baja`,
  adminUsuarios: () => "/admin/usuarios",
  adminUsuarioActualizar: (u) => `/admin/usuarios/${u}/actualizar`,
  adminUsuarioCodigo: (u) => `/admin/usuarios/${u}/codigo-restablecimiento`,
  adminAsignaciones: () => "/admin/asignaciones",
  adminAsignacionFinalizar: (a) => `/admin/asignaciones/${a}/finalizar`,
  adminAuditoria: () => "/admin/auditoria",
});

export const CONFIG = Object.freeze({
  app: Object.freeze({
    nombre: "Excavadora IoT",
    autor: "Juan Armando Castillo Rodríguez",
    anio: 2026,
  }),

  apiBaseUrl: API_BASE_URL,
  wsUrl: (idVehiculo) => `${WS_BASE_URL}/ws/vehiculos/${idVehiculo}`,
  docsUrl: `${API_BASE_URL}/docs`,
  rutas: RUTAS,

  /** Vehículo que controla y monitorea esta aplicación. */
  vehiculoId: 1,

  tiempos: Object.freeze({
    timeoutMs: 8000,             // límite por petición REST (AbortController)
    saludCadaMs: 30000,          // comprobación periódica de API y RDS
    wsPingMs: 25000,             // el backend responde "ping" con el evento "pong"
    wsPongMaxMs: 10000,          // sin respuesta tras el ping → se fuerza reconexión
    wsReconexionBaseMs: 1000,
    wsReconexionMaxMs: 15000,
    /**
     * Joystick mantenido: reenvía la MISMA dirección cada N ms (no por píxel).
     * El firmware previsto detiene el carrito si no recibe órdenes en ~3 s.
     * 0 = sin reenvío (solo se envía en cada cambio de dirección).
     */
    mantenerMs: 2400,
    historialRetrasoMs: 600,
    /** Se renueva el token de acceso este tiempo ANTES de que caduque (dura 10 min). */
    renovarAntesMs: 60000,
    /** Invitado: cada cuánto se avisa «sigo aquí» (el servidor detiene la unidad a los 15 s sin señal). */
    latidoInvitadoMs: 5000,
    catalogoInvitadoMs: 10000,
  }),

  /** Tamaño de página de las tablas de Administración (el backend admite 1–200). */
  paginaAdmin: 25,

  /** Valores de "origen" (backend: ^[A-Za-z0-9_-]{1,30}$). Se guardan en el historial. */
  origen: Object.freeze({
    pulso: "WEB_PULSO",
    joystick: "WEB_JOYSTICK",
    voz: "WEB_VOZ",
    boton: "WEB_BOTON",
    teclado: "WEB_TECLADO",
    giroscopio: "WEB_GIROSCOPIO",
    ia: "WEB_IA",
    tactil: "WEB_TACTIL",
  }),

  /**
   * Códigos del catálogo que corresponden a cada dirección (los usaba el
   * control anterior). Solo se habilita una dirección si su código existe y
   * está ACTIVO en GET /vehiculos/{id}/comandos.
   */
  direcciones: Object.freeze({ arriba: 1, abajo: 2, izquierda: 3, derecha: 4 }),

  /**
   * Mando derecho (brazo y pala): mismo criterio que `direcciones`.
   * arriba/abajo = subir/bajar brazo · izquierda/derecha = girar pala.
   */
  brazo: Object.freeze({ arriba: 5, abajo: 6, izquierda: 7, derecha: 8 }),

  /** Modo Voz: códigos de los accesorios y ritmo de las órdenes encadenadas. */
  voz: Object.freeze({
    luz: 10, sonido: 11, encender: 12,
    pasoMs: 1200,      // pausa entre órdenes de una misma frase ("avanza y luego gira")
    maxPasos: 6,       // tope de órdenes por frase (incluye repeticiones: "avanza tres veces")
  }),

  /**
   * Modo IA (gestos con la mano, MediaPipe en el navegador).
   * La librería se descarga de jsDelivr con versión fija (si cambia, revisa
   * la CSP de index.html) y el modelo se sirve desde este mismo sitio.
   * Se cargan SOLO al activar el modo IA.
   */
  ia: Object.freeze({
    libreria: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/vision_bundle.mjs",
    wasm: "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm",
    modelo: "assets/modelos/gesture_recognizer.task",
    fps: 15,                     // cuadros analizados por segundo (cuida batería y temperatura)
    /** Gestos que se SOSTIENEN para alternar un accesorio: forma → {código, ms}. */
    accesorios: Object.freeze({
      Thumb_Up: Object.freeze({ codigo: 10, ms: 1000 }),       // 👍 luz
      ILoveYou: Object.freeze({ codigo: 11, ms: 1000 }),       // 🤟 sonido
      Pointing_Up: Object.freeze({ codigo: 12, ms: 2000 }),    // ☝️ encender/apagar (más tiempo: es crítico)
    }),
  }),

  /**
   * Accesorios que funcionan como INTERRUPTOR (cada orden alterna el estado).
   * El botón muestra si quedó encendido y aparece un aviso breve. El estado se
   * deduce de las órdenes que difunde el servidor por WSS (sin confirmación del ESP).
   * `inicial`: estado con el que arranca el vehículo (luz, sonido y
   * excavadora arrancan encendidos).
   */
  interruptores: Object.freeze({
    10: Object.freeze({ on: "Luz encendida", off: "Luz apagada", botonOn: "Luz ON", inicial: true }),
    11: Object.freeze({ on: "Sonido activado", off: "Sonido desactivado", botonOn: "Sonido ON", inicial: true }),
    12: Object.freeze({ on: "Excavadora encendida", off: "Excavadora apagada", botonOn: "Encendida", inicial: true }),
  }),

  /**
   * Control sin clave. Con `true`, cada página pregunta al backend
   * (GET /sesion SIN clave) si tiene CONTROL_ABIERTO=true; si es así, Control
   * mueve el vehículo e inicia/cancela DEMO sin pedir la clave. Crear, editar
   * y eliminar (Administración) siguen pidiendo la clave de operador o admin.
   * No hay ninguna clave en este archivo: se abre o se cierra desde el `.env`
   * del servidor. Con `false` la página siempre pide la clave.
   */
  controlAbierto: false,

  /**
   * Etapa 9: la clave X-API-Key se RETIRÓ (el backend la rechaza con
   * CLAVE_API_HABILITADA=false). En false la página no la pide ni la envía y
   * borra la que hubiera quedado recordada. Volver a true solo junto con el
   * servidor (vuelta atrás).
   */
  claveApi: false,

  /** El backend identifica el paro por nombre (comando_service.buscar_detener). */
  nombreDetener: "DETENER",

  /** Icono opcional por código (solo estética). */
  iconos: Object.freeze({
    1: "i-up", 2: "i-down", 3: "i-left", 4: "i-right",
    5: "i-chev-up", 6: "i-chev-down", 7: "i-rot-l", 8: "i-rot-r",
    10: "i-bulb", 11: "i-sound", 12: "i-power",
  }),

  /**
   * Texto corto opcional por código para botones pequeños (solo estética).
   * El nombre completo del catálogo sigue en `title` y `aria-label`.
   */
  etiquetasCortas: Object.freeze({
    2: "Atrás", 3: "Izquierda", 4: "Derecha",
    5: "Subir", 6: "Bajar", 7: "Pala izq.", 8: "Pala der.",
    12: "On / Off",
  }),
});
