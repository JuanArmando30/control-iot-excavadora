/**
 * DEMO que ejecuta el botón «Demo» de Control. Se elige en Administración
 * («Usar en Control») y se guarda en este navegador (el backend no tiene un
 * campo para esto). Si no hay elección válida se usa la primera DEMO activa.
 */
const llave = (idVehiculo) => `vehiculoIot.demoControl.${idVehiculo}`;

export const demoPreferida = {
  /** @returns {number|null} id guardado (puede no existir ya en la API) */
  obtener(idVehiculo) {
    try { return Number.parseInt(localStorage.getItem(llave(idVehiculo)) || "", 10) || null; } catch { return null; }
  },

  guardar(idVehiculo, idDemo) {
    try { localStorage.setItem(llave(idVehiculo), String(idDemo)); } catch { /* almacenamiento bloqueado */ }
  },

  /** DEMO a usar entre las ACTIVAS: la elegida si sigue activa; si no, la primera. */
  resolver(idVehiculo, demosActivas) {
    const id = this.obtener(idVehiculo);
    return demosActivas.find((d) => d.id_demo === id) || demosActivas[0] || null;
  },

  /** Avisa cuando otra pestaña (p. ej. Administración) cambia la elección. */
  alCambiar(idVehiculo, f) {
    window.addEventListener("storage", (e) => { if (e.key === llave(idVehiculo)) f(); });
  },
};
