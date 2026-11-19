/**
 * Sesión con correo y contraseña (Etapa 4 del backend).
 *
 * - Token de ACCESO (JWT, 10 min): SOLO en memoria. Al recargar o cambiar de
 *   página se pierde y se pide otro con el token de renovación.
 * - Token de RENOVACIÓN: en sessionStorage (se borra al cerrar la pestaña).
 *   Rota en cada uso; si alguien reutiliza uno viejo, el servidor cierra la
 *   sesión completa. Nunca en localStorage ni en cookies.
 * - La renovación se hace antes de que caduque el acceso y una sola vez aunque
 *   varias peticiones la pidan a la vez («vuelo único»).
 *
 * Este módulo solo guarda estado; las llamadas a /auth las hace api/auth-api.js,
 * que registra aquí la función de renovación (evita dependencias circulares).
 */
import { CONFIG } from "../config.js";

const LLAVE = "vehiculoIot.renovacion";
const MARGEN_MS = 5000;               // un token a 5 s de caducar ya no se usa
const REINTENTO_RED_MS = 15000;

function leer() {
  try { return sessionStorage.getItem(LLAVE) || ""; } catch { return ""; }
}
function escribir(valor) {
  try { valor ? sessionStorage.setItem(LLAVE, valor) : sessionStorage.removeItem(LLAVE); } catch { /* modo privado */ }
}

let acceso = "";
let caducaEn = 0;                     // reloj de ESTE navegador (no depende de la hora del servidor)
let usuario = null;
let renovador = null;
let enCurso = null;
let temporizador = 0;
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => { try { f(usuario); } catch { /* un oyente no rompe a los demás */ } });

function programar(msHastaCaducar) {
  clearTimeout(temporizador);
  const espera = Math.max(MARGEN_MS, msHastaCaducar - CONFIG.tiempos.renovarAntesMs);
  temporizador = setTimeout(() => {
    sesionStore.renovar().catch((e) => {
      // Sin red: se reintenta. 401: auth-api ya limpió la sesión.
      if (e?.tipo === "RED" || e?.tipo === "TIMEOUT") temporizador = setTimeout(() => programar(0), REINTENTO_RED_MS);
    });
  }, espera);
}

export const sesionStore = {
  usuario: () => usuario,
  activa: () => !!usuario,
  esAdmin: () => usuario?.rol === "admin",
  /** Token de acceso vigente o "" (si está por caducar, se considera caducado). */
  token: () => (acceso && Date.now() < caducaEn - MARGEN_MS ? acceso : ""),
  tokenRenovacion: leer,
  /** ¿Hay con qué recuperar la sesión (p. ej. tras recargar la página)? */
  recuperable: () => !!leer(),

  /** Aplica una respuesta ya validada de login / renovar / cambiar contraseña. */
  aplicar(s) {
    acceso = s.token_acceso;
    caducaEn = Date.now() + s.expira_en * 1000;
    usuario = Object.freeze({ ...s.usuario });
    escribir(s.token_renovacion);
    programar(s.expira_en * 1000);
    avisar();
  },

  /** Olvida la sesión en este navegador (no avisa al servidor). */
  limpiar() {
    const habia = !!usuario || !!leer();
    acceso = "";
    caducaEn = 0;
    usuario = null;
    escribir("");
    clearTimeout(temporizador);
    if (habia) avisar();
  },

  fijarRenovador(f) { renovador = f; },

  /** Renueva una sola vez aunque la pidan varias peticiones a la vez. */
  renovar() {
    if (!renovador) return Promise.reject(new Error("Sesión no disponible en esta página."));
    if (!enCurso) enCurso = Promise.resolve().then(renovador).finally(() => { enCurso = null; });
    return enCurso;
  },

  alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); },
};

/* Al volver a la pestaña tras suspender el equipo, los temporizadores pudieron no correr. */
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && usuario && !sesionStore.token() && leer()) {
    sesionStore.renovar().catch(() => { /* el oyente de sesión mostrará el cambio */ });
  }
});
