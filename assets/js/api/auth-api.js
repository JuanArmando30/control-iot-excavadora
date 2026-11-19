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
