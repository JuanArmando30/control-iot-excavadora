/**
 * Guarda la clave X-API-Key que escribe el operador.
 * - Por defecto en sessionStorage (se borra al cerrar la pestaña).
 * - En localStorage solo si el usuario marca "Recordar en este dispositivo".
 * La clave nunca forma parte del código publicado en GitHub Pages.
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
const oyentes = new Set();

export const claveStore = {
  obtener: () => memoria,
  rol: () => rol,
  recordada: () => !!leer(localStorage, LLAVE),
  formatoValido: (clave) => FORMATO.test(clave),

  guardar(clave, { recordar = false, rolValidado = "" } = {}) {
    memoria = clave;
    rol = rolValidado;
    escribir(sessionStorage, LLAVE, clave);
    escribir(sessionStorage, LLAVE_ROL, rolValidado);
    escribir(localStorage, LLAVE, recordar ? clave : "");
    oyentes.forEach((f) => f(memoria, rol));
  },

  olvidar() {
    memoria = "";
    rol = "";
    escribir(sessionStorage, LLAVE, "");
    escribir(sessionStorage, LLAVE_ROL, "");
    escribir(localStorage, LLAVE, "");
    oyentes.forEach((f) => f(memoria, rol));
  },

  alCambiar(f) { oyentes.add(f); return () => oyentes.delete(f); },
};
