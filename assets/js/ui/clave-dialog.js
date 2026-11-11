/**
 * Gestión de la clave X-API-Key desde la interfaz.
 * La clave se valida con GET /sesion (no modifica datos) antes de guardarse.
 */
import { api } from "../api/vehiculo-api.js";
import { claveStore } from "../core/clave-store.js";
import { $, el, toast } from "./dom.js";
import { abrirModal, campo } from "./modales.js";

const ROLES = { operador: "Operador", admin: "Administrador" };

/** Pinta el botón de la barra superior según el estado de la clave. */
function pintarBoton() {
  const b = $("btnClave");
  if (!b) return;
  const rol = claveStore.rol();
  const tiene = !!claveStore.obtener();
  const libre = claveStore.esLibre();
  b.querySelector("span").textContent = libre ? "Acceso de prueba" : tiene ? (ROLES[rol] || "Clave guardada") : "Sin clave";
  b.classList.toggle("btn-outline-warning", !tiene);
  b.classList.toggle("btn-outline-success", tiene && !libre);
  b.classList.toggle("btn-outline-info", libre);
  b.setAttribute("aria-label", libre ? "Acceso de prueba sin clave activo. Escribir otra clave"
    : tiene ? `Clave de ${ROLES[rol] || "operador"} guardada. Cambiar clave` : "Escribir clave de operador");
}

export function abrirDialogoClave({ motivo = "" } = {}) {
  const recordar = claveStore.recordada();
  abrirModal({
    titulo: "Clave de acceso",
    cuerpo: [
      motivo ? el("p", { class: "alert alert-info py-2 small", text: motivo }) : null,
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
  pintarBoton();
  claveStore.alCambiar(pintarBoton);
  $("btnClave")?.addEventListener("click", () => abrirDialogoClave());
  const clave = claveStore.obtener();
  if (!clave) return;
  try {
    const { rol } = await api.sesion();
    if (claveStore.esLibre()) { claveStore.fijarRol(rol); return; }      // acceso de prueba: no se guarda la clave
    claveStore.guardar(clave, { recordar: claveStore.recordada(), rolValidado: rol });
  } catch (e) {
    if (e.status === 401) {
      claveStore.olvidar();
      toast("La clave guardada ya no es válida.", "error");
    }
  }
}
