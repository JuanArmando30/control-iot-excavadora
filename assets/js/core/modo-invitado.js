/**
 * Modo invitado en la navegación.
 *
 * Mientras ESTA pestaña tiene una reserva de invitado, el menú solo ofrece
 * «Control» (que lleva a su control completo, index.html?invitado): Monitoreo y
 * Administración no son para invitados y se ocultan. Si las abre escribiendo la
 * URL, `bloquearSiInvitado()` lo devuelve a su control antes de cargar la página.
 *
 * Al terminar la prueba (o si caducó), el token se borra de la pestaña y el menú
 * vuelve a ser el normal: desde Administración inician sesión los clientes.
 */

const LLAVE = "vehiculoIot.invitado";            // la misma que usa api/invitado-api.js
const CONTROL_INVITADO = "index.html?invitado";
const SOLO_CUENTAS = ["monitoreo.html", "administracion.html"];

/** ¿Hay una reserva de invitado guardada en esta pestaña? (sin red: la valida la página de Control) */
export function hayReservaInvitado() {
  try { return !!sessionStorage.getItem(LLAVE); } catch { return false; }
}

/**
 * Oculta (activo=true) o vuelve a mostrar Monitoreo y Administración en el menú,
 * y apunta «Control» y el logotipo al control del invitado.
 */
export function navInvitado(activo) {
  for (const a of document.querySelectorAll(".nav-sec a")) {
    const destino = (a.getAttribute("href") || "").split("?")[0];
    if (SOLO_CUENTAS.includes(destino)) {
      a.hidden = activo;
      a.style.display = activo ? "none" : "";        // .nav-sec a define display: el atributo solo no basta
      if (activo) a.setAttribute("aria-hidden", "true"); else a.removeAttribute("aria-hidden");
      a.tabIndex = activo ? -1 : 0;
    } else if (destino === "index.html") {
      a.setAttribute("href", activo ? CONTROL_INVITADO : "index.html");
    }
  }
  const marca = document.querySelector("a.marca");
  if (marca) marca.setAttribute("href", activo ? CONTROL_INVITADO : "index.html");
}

/**
 * Para Monitoreo y Administración: con una reserva de invitado en la pestaña,
 * regresa a su control y DETIENE la carga de la página (la promesa nunca se resuelve,
 * así que el módulo de la página no llega a ejecutarse).
 */
export function bloquearSiInvitado() {
  if (!hayReservaInvitado()) return Promise.resolve();
  location.replace(CONTROL_INVITADO);
  return new Promise(() => {});
}
