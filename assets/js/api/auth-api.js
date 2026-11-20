/**
 * Sesión de usuario: /auth/* y /mis-vehiculos (Etapa 4 del backend).
 * Importar este módulo registra la renovación automática en sesionStore.
 */
import { CONFIG } from "../config.js";
import { http } from "./vehiculo-api.js";
import { sesionStore } from "../core/sesion-store.js";
import * as V from "../core/validadores.js";

const R = CONFIG.rutas;

async function renovar() {
  const token = sesionStore.tokenRenovacion();
  if (!token) { sesionStore.limpiar(); throw Object.assign(new Error("Inicia sesión para continuar."), { status: 401 }); }
  try {
    const { data } = await http.post(R.authRenovar(), { token_renovacion: token });
    sesionStore.aplicar(V.sesionAuth(data));
  } catch (e) {
    // 401: el token caducó, se revocó o se reutilizó → hay que volver a entrar.
    // Sin red o 5xx: se conserva para reintentar.
    if ([400, 401, 422].includes(e.status)) sesionStore.limpiar();
    throw e;
  }
}
sesionStore.fijarRenovador(renovar);

export const auth = {
  /** Recupera la sesión al cargar la página (si la pestaña tenía una). */
  async recuperar() {
    if (!sesionStore.recuperable()) return null;
    if (sesionStore.activa() && sesionStore.token()) return sesionStore.usuario();   // ya está vigente
    try { await sesionStore.renovar(); } catch { /* sin sesión o sin red */ }
    return sesionStore.usuario();
  },

  async iniciar(correo, contrasena) {
    const { data } = await http.post(R.authLogin(), { correo, contrasena });
    sesionStore.aplicar(V.sesionAuth(data));
    return sesionStore.usuario();
  },

  /** Revoca la sesión en el servidor (si se puede) y la olvida aquí siempre. */
  async salir() {
    const token = sesionStore.tokenRenovacion();
    sesionStore.limpiar();
    if (!token) return;
    try { await http.post(R.authSalir(), { token_renovacion: token }); } catch { /* ya no sirve en este navegador */ }
  },

  restablecer: (correo, codigo, contrasena_nueva) =>
    http.post(R.authRestablecer(), { correo, codigo, contrasena_nueva }).then((r) => r.data),

  async cambiarContrasena(contrasena_actual, contrasena_nueva) {
    const { data } = await http.post(R.authCambiar(), { contrasena_actual, contrasena_nueva }, { auth: "sesion" });
    sesionStore.aplicar(V.sesionAuth(data));      // el servidor cerró las demás sesiones y entrega una nueva
  },

  misVehiculos: () => http.get(R.misVehiculos(), { auth: "sesion" }).then((r) => V.filas(r.data)),
};

/* ---------------- Comprador: su unidad (Etapa 6) ---------------- */
const S = { auth: "sesion" };
const id = (n) => {
  if (!Number.isInteger(n) || n <= 0) throw new TypeError("Identificador inválido");
  return n;
};
const get = (ruta) => http.get(ruta, S).then((r) => r.data);
const post = (ruta, cuerpo) => http.post(ruta, cuerpo, S).then((r) => r.data);

export const mio = {
  /* Lecturas de SU unidad, siempre con su token (funcionan también con LECTURA_ABIERTA=false) */
  comandos: (v) => get(R.comandos(id(v))).then(V.comandos),
  limites: (v) => get(R.limites(id(v))).then(V.fila),
  ejecucion: (v) => get(R.demoEjecucion(id(v))).then(V.demoEjecucion),
  /* DEMO: de fábrica (solo lectura) y propias */
  demos: (v) => get(R.misDemos(id(v))).then(V.filas),
  demo: (v, d) => get(R.miDemo(id(v), id(d))).then(V.fila),
  crearDemo: (v, cuerpo) => post(R.misDemos(id(v)), cuerpo).then(V.fila),
  actualizarDemo: (v, d, cuerpo) => post(R.miDemoActualizar(id(v), id(d)), cuerpo).then(V.fila),
  eliminarDemo: (v, d) => post(R.miDemoEliminar(id(v), id(d))),
  guardarPasos: (v, d, pasos) => post(R.miDemoPasos(id(v), id(d)), { pasos }).then(V.fila),
  /* Ejecución con SU token (autorización por unidad en el servidor) */
  iniciarDemo: (v, d) => post(R.demoIniciar(id(v), id(d))).then(V.demoIniciada),
  cancelarDemo: (v) => post(R.demoCancelar(id(v))).then(V.demoCancelada),
  /* Soporte: consentimiento temporal para que la empresa opere su unidad */
  soporte: (v) => get(R.miSoporte(id(v))).then(V.filas),
  otorgarSoporte: (v, cuerpo) => post(R.miSoporte(id(v)), cuerpo).then(V.fila),
  revocarSoporte: (v) => post(R.miSoporteRevocar(id(v))).then(V.fila),
};
