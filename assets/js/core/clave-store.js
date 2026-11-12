/**
 * Acceso a la API desde este navegador.
 *
 * - Clave X-API-Key escrita por el operador o el administrador: por defecto
 *   en sessionStorage (se borra al cerrar la pestaña); en localStorage solo si
 *   marca «Recordar en este dispositivo». Nunca forma parte del código publicado.
 * - Control abierto: si el backend tiene CONTROL_ABIERTO=true, GET /sesion
 *   sin clave responde {acceso:"abierto"} y este navegador puede CONTROLAR
 *   (mover, DEMO) sin clave. No se guarda nada: se comprueba en cada carga.
 *   Crear, editar y eliminar siguen necesitando una clave real.
 */
const LLAVE = "vehiculoIot.claveApi";
const LLAVE_ROL = "vehiculoIot.rol";
// Valor seguro para una cabecera HTTP: ASCII visible, sin espacios.
const FORMATO = /^[\x21-\x7E]{12,256}$/;

function leer(almacen, llave) {
  try { return almacen.getItem(llave) || ""; } catch { return ""; }
}
function escribir(almacen, llave, valor) {
  try { valor ? almacen.setItem(llave, valor) : almacen.removeItem(llave); } catch { /* modo privado */ }
}

let memoria = leer(sessionStorage, LLAVE) || leer(localStorage, LLAVE);
let rol = leer(sessionStorage, LLAVE_ROL);
let abierto = false;
const oyentes = new Set();
const avisar = () => oyentes.forEach((f) => f(memoria, rol));

export const claveStore = {
  /** Clave real escrita por el usuario ("" si no hay). */
  obtener: () => memoria,
  rol: () => rol,
  /** ¿Puede mover el vehículo e iniciar/cancelar DEMO? (clave real o control abierto) */
  puedeControlar: () => !!memoria || abierto,
  /** true si controla SIN clave porque el backend tiene el control abierto. */
  esAbierto: () => !memoria && abierto,
  fijarAbierto(valor) {
    if (abierto === !!valor) return;
    abierto = !!valor;
    avisar();
  },
  recordada: () => !!leer(localStorage, LLAVE),
  formatoValido: (clave) => FORMATO.test(clave),

  guardar(clave, { recordar = false, rolValidado = "" } = {}) {
    memoria = clave;
    rol = rolValidado;
    escribir(sessionStorage, LLAVE, clave);
    escribir(sessionStorage, LLAVE_ROL, rolValidado);
    escribir(localStorage, LLAVE, recordar ? clave : "");
    avisar();
  },

  olvidar() {
    memoria = "";             // si el control está abierto, se sigue pudiendo controlar sin clave
    rol = "";
    escribir(sessionStorage, LLAVE, "");
    escribir(sessionStorage, LLAVE_ROL, "");
    escribir(localStorage, LLAVE, "");
    avisar();
  },

  alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); },
};
