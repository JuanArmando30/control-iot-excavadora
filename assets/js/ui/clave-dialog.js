/**
 * Gestión de la clave X-API-Key desde la interfaz.
 * La clave se valida con GET /sesion (no modifica datos) antes de guardarse.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { claveStore } from "../core/clave-store.js";
import { $, el, toast } from "./dom.js";
import { abrirModal, campo } from "./modales.js";
import { sesionStore } from "../core/sesion-store.js";

const ROLES = { operador: "Operador", admin: "Administrador" };

/** Pinta el botón de la barra superior según el estado de la clave. */
function pintarBoton() {
  const b = $("btnClave");
  if (!b) return;
  const u = sesionStore.usuario();
  if (!u && !CONFIG.claveApi) {
    // Etapa 9: sin clave; el botón lleva a iniciar sesión.
    b.querySelector("span").textContent = "Entrar";
    b.classList.remove("btn-outline-warning", "btn-outline-info", "btn-outline-success");
    b.classList.add("btn-outline-light");
    b.title = "Inicia sesión para controlar y monitorear tus unidades.";
    b.setAttribute("aria-label", "Iniciar sesión");
    return;
  }
  if (u && !b.closest(".pagina-admin")) {
    // Etapa 8: con sesión, Control y Monitoreo usan el token (el servidor decide por unidad).
    b.querySelector("span").textContent = u.nombre.split(" ")[0];
    b.classList.remove("btn-outline-warning", "btn-outline-info");
    b.classList.add("btn-outline-success");
    b.title = "Sesión iniciada. Pulsa para ver tu cuenta en Administración.";
    b.setAttribute("aria-label", `Sesión de ${u.nombre}. Abrir Administración`);
    return;
  }
  const rol = claveStore.rol();
  const tiene = !!claveStore.obtener();
  const libre = claveStore.esAbierto();
  b.querySelector("span").textContent = libre ? "Control abierto" : tiene ? (ROLES[rol] || "Clave guardada") : "Sin clave";
  b.classList.toggle("btn-outline-warning", !tiene);
  b.classList.toggle("btn-outline-success", tiene && !libre);
  b.classList.toggle("btn-outline-info", libre);
  b.title = libre ? "El servidor permite controlar sin clave. Para Administración escribe la clave." : "";
  b.setAttribute("aria-label", libre ? "Control abierto sin clave. Escribir una clave para Administración"
    : tiene ? `Clave de ${ROLES[rol] || "operador"} guardada. Cambiar clave` : "Escribir clave de operador");
}

/** Sin clave (Etapa 9): explica cómo seguir — iniciar sesión o probar como invitado. */
function abrirAvisoSesion(motivo = "") {
  // Una sola vez a la vista (Control lo abre al cargar si no hay sesión; «Entrar» no debe duplicarlo).
  if (document.querySelector(".modal.aviso-sesion")) return;
  const ctx = abrirModal({
    titulo: "Inicia sesión",
    cuerpo: [
      el("p", { text: motivo || "Para controlar o monitorear una unidad necesitas iniciar sesión con tu cuenta." }),
      el("p", { class: "small text-secondary-emphasis mb-0", text:
        "Si compraste una unidad, entra con la cuenta que te dio la empresa. Si solo quieres conocerla, pruébala unos minutos como invitado." }),
    ],
    acciones: [
      { texto: "Probar como invitado", clase: "btn-outline-info me-auto", alPulsar: () => { location.href = "invitado.html"; } },
      { texto: "Cerrar", clase: "btn-outline-secondary" },
      { texto: "Iniciar sesión", clase: "btn-primary", alPulsar: () => { location.href = "administracion.html"; } },
    ],
  });
  ctx.form.closest(".modal").classList.add("aviso-sesion");
}

export function abrirDialogoClave({ motivo = "" } = {}) {
  if (!CONFIG.claveApi) { abrirAvisoSesion(""); return; }
  const recordar = claveStore.recordada();
  abrirModal({
    titulo: "Clave de acceso",
    cuerpo: [
      motivo ? el("p", { class: "alert alert-info py-2 small", text: motivo }) : null,
      claveStore.esAbierto() ? el("p", { class: "alert alert-success py-2 small", text:
        "El servidor tiene el control abierto: mover y la DEMO funcionan sin clave. Escribe una clave solo para crear, editar o eliminar en Administración." }) : null,
      campo({ nombre: "clave", etiqueta: "Clave X-API-Key (operador o administrador)", tipo: "password", requerido: true, maxLength: 256 }),
      campo({ nombre: "recordar", etiqueta: "Recordar en este dispositivo", tipo: "checkbox", valor: recordar }),
      el("p", { class: "form-text mb-0", text:
        "La clave no está en el código de la página ni se envía a otro sitio: solo viaja por HTTPS a la API en la cabecera X-API-Key. " +
        "Sin «recordar» se borra al cerrar la pestaña. No uses «recordar» en equipos compartidos." }),
    ].filter(Boolean),
    acciones: [
      { texto: "Olvidar clave", clase: "btn-outline-danger me-auto", alPulsar: () => { claveStore.olvidar(); toast("Clave eliminada de este dispositivo."); } },
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Validar y guardar", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          const clave = form.elements.clave.value.trim();
          if (!claveStore.formatoValido(clave)) throw new Error("La clave debe tener entre 12 y 256 caracteres visibles, sin espacios.");
          const { rol } = await api.sesion(clave);
          claveStore.guardar(clave, { recordar: form.elements.recordar.checked, rolValidado: rol });
          toast(`Clave válida (${ROLES[rol]}).`, "ok");
        },
      },
    ],
    alAbrir: ({ form }) => { form.elements.clave.setAttribute("autocomplete", "current-password"); },
  });
}

/** Revalida la clave guardada al cargar la página. Si la API responde 401, se descarta. */
export async function inicializarClave() {
  if (!CONFIG.claveApi && claveStore.obtener()) {
    claveStore.olvidar();          // la clave se retiró: no se vuelve a enviar (el servidor la rechazaría)
  }
  pintarBoton();
  claveStore.alCambiar(pintarBoton);
  sesionStore.alCambiar(pintarBoton);
  $("btnClave")?.addEventListener("click", () => {
    if ((sesionStore.usuario() || !CONFIG.claveApi) && !$("btnClave").closest(".pagina-admin")) {
      if (sesionStore.usuario()) { location.href = "administracion.html"; return; }
      abrirAvisoSesion("");
      return;
    }
    abrirDialogoClave();
  });
  const clave = claveStore.obtener();
  if (!CONFIG.claveApi) { if (CONFIG.controlAbierto) await comprobarControlAbierto(); return; }
  if (!clave) { await comprobarControlAbierto(); return; }
  try {
    const { rol } = await api.sesion();
    claveStore.guardar(clave, { recordar: claveStore.recordada(), rolValidado: rol });
  } catch (e) {
    if (e.status === 401) {
      claveStore.olvidar();
      toast("La clave guardada ya no es válida.", "error");
      await comprobarControlAbierto();
    }
  }
}

/** Sin clave: pregunta al backend si permite controlar sin ella (CONTROL_ABIERTO=true). */
async function comprobarControlAbierto() {
  if (!CONFIG.controlAbierto) return;
  try {
    const r = await api.sesionSinClave();
    claveStore.fijarAbierto(r.acceso === "abierto");
  } catch {
    claveStore.fijarAbierto(false);        // 401: el servidor exige clave (o no respondió)
  }
}
