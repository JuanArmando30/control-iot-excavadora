/**
 * Interfaz de la sesión: tarjeta de inicio de sesión, restablecer con el
 * código del administrador, cambiar contraseña y botón de usuario.
 */
import { auth } from "../api/auth-api.js";
import { sesionStore } from "../core/sesion-store.js";
import { abrirDialogoClave } from "./clave-dialog.js";
import { abrirModal, campo } from "./modales.js";
import { $, el, icono, toast } from "./dom.js";

const ROL = { admin: "Administrador", usuario: "Comprador" };
const AYUDA_CLAVE = "Mínimo 10 caracteres, con letras y números, y sin tu correo.";

/* ----------------------------- Inicio de sesión ----------------------------- */

/** Construye la tarjeta de acceso dentro de `destino`. */
export function montarAcceso(destino) {
  const error = el("div", { class: "alert alert-danger py-2 small d-none", attrs: { role: "alert", id: "accesoError" } });
  const correo = el("input", { class: "form-control", attrs: {
    id: "accesoCorreo", name: "correo", type: "email", required: true, maxlength: 254, autocomplete: "username", inputmode: "email" } });
  const clave = el("input", { class: "form-control", attrs: {
    id: "accesoClave", name: "contrasena", type: "password", required: true, maxlength: 128, autocomplete: "current-password" } });
  const ver = el("button", { class: "btn btn-outline-secondary", text: "Ver",
    attrs: { type: "button", "aria-label": "Mostrar contraseña", "aria-pressed": "false" },
    on: { click: () => {
      const mostrar = clave.type === "password";
      clave.type = mostrar ? "text" : "password";
      ver.textContent = mostrar ? "Ocultar" : "Ver";
      ver.setAttribute("aria-pressed", String(mostrar));
      ver.setAttribute("aria-label", mostrar ? "Ocultar contraseña" : "Mostrar contraseña");
    } } });
  const entrar = el("button", { class: "btn btn-primary w-100", text: "Entrar", attrs: { type: "submit" } });

  const form = el("form", { class: "acceso-form", attrs: { novalidate: true, "aria-describedby": "accesoError" } }, [
    error,
    el("div", { class: "mb-3" }, [
      el("label", { class: "form-label", text: "Correo", attrs: { for: "accesoCorreo" } }), correo]),
    el("div", { class: "mb-3" }, [
      el("label", { class: "form-label", text: "Contraseña", attrs: { for: "accesoClave" } }),
      el("div", { class: "input-group" }, [clave, ver])]),
    entrar,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.classList.add("d-none");
    if (!form.checkValidity()) { form.classList.add("was-validated"); return; }
    entrar.disabled = true;
    entrar.textContent = "Entrando…";
    try {
      const u = await auth.iniciar(correo.value.trim(), clave.value);
      clave.value = "";
      toast(`Hola, ${u.nombre}.`, "ok");
    } catch (err) {
      error.textContent = err.message;
      error.classList.remove("d-none");
      clave.select();
    } finally {
      entrar.disabled = false;
      entrar.textContent = "Entrar";
    }
  });

  destino.replaceChildren(
    el("div", { class: "acceso-tarjeta" }, [
      el("div", { class: "acceso-cab" }, [icono("i-user"), el("h2", { text: "Iniciar sesión" })]),
      el("p", { class: "ayuda", text: "Administración es para la empresa. Si compraste una unidad, entra con la cuenta que te dio la empresa." }),
      form,
      el("div", { class: "acceso-enlaces" }, [
        el("button", { class: "btn btn-link btn-sm", text: "Tengo un código del administrador",
          attrs: { type: "button" }, on: { click: () => dialogoRestablecer(correo.value.trim()) } }),
        el("button", { class: "btn btn-link btn-sm", text: "Usar la clave X-API-Key (transición)",
          attrs: { type: "button" }, on: { click: () => abrirDialogoClave({ motivo: "Mientras dura la transición, la clave de administrador también abre Administración." }) } }),
      ]),
    ]),
  );
}

/** Primera contraseña o contraseña olvidada, con el código de un solo uso. */
export function dialogoRestablecer(correo = "") {
  abrirModal({
    titulo: "Poner contraseña con un código",
    cuerpo: [
      el("p", { class: "small", text: "El administrador te entrega un código XXXXX-XXXXX. Sirve una sola vez y caduca en 30 minutos." }),
      campo({ nombre: "correo", etiqueta: "Correo", tipo: "email", requerido: true, maxLength: 254, valor: correo }),
      campo({ nombre: "codigo", etiqueta: "Código", requerido: true, maxLength: 16, ayuda: "Mayúsculas o minúsculas, con o sin guion." }),
      campo({ nombre: "nueva", etiqueta: "Contraseña nueva", tipo: "password", requerido: true, maxLength: 128, ayuda: AYUDA_CLAVE }),
      campo({ nombre: "repetir", etiqueta: "Repite la contraseña", tipo: "password", requerido: true, maxLength: 128 }),
    ],
    acciones: [
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Guardar contraseña", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          const f = form.elements;
          if (f.nueva.value !== f.repetir.value) throw new Error("Las contraseñas no coinciden.");
          await auth.restablecer(f.correo.value.trim(), f.codigo.value.trim(), f.nueva.value);
          toast("Contraseña guardada. Ya puedes iniciar sesión.", "ok");
          const destino = $("accesoCorreo");
          if (destino) { destino.value = f.correo.value.trim(); $("accesoClave")?.focus(); }
        },
      },
    ],
    alAbrir: ({ form }) => {
      form.elements.nueva.setAttribute("autocomplete", "new-password");
      form.elements.repetir.setAttribute("autocomplete", "new-password");
      form.elements.codigo.setAttribute("autocomplete", "one-time-code");
    },
  });
}

export function dialogoCambiarContrasena() {
  abrirModal({
    titulo: "Cambiar mi contraseña",
    cuerpo: [
      campo({ nombre: "actual", etiqueta: "Contraseña actual", tipo: "password", requerido: true, maxLength: 128 }),
      campo({ nombre: "nueva", etiqueta: "Contraseña nueva", tipo: "password", requerido: true, maxLength: 128, ayuda: AYUDA_CLAVE }),
      campo({ nombre: "repetir", etiqueta: "Repite la contraseña nueva", tipo: "password", requerido: true, maxLength: 128 }),
      el("p", { class: "form-text mb-0", text: "Se cerrarán tus sesiones en otros dispositivos." }),
    ],
    acciones: [
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Cambiar", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          const f = form.elements;
          if (f.nueva.value !== f.repetir.value) throw new Error("Las contraseñas nuevas no coinciden.");
          await auth.cambiarContrasena(f.actual.value, f.nueva.value);
          toast("Contraseña cambiada.", "ok");
        },
      },
    ],
    alAbrir: ({ form }) => {
      form.elements.actual.setAttribute("autocomplete", "current-password");
      form.elements.nueva.setAttribute("autocomplete", "new-password");
      form.elements.repetir.setAttribute("autocomplete", "new-password");
    },
  });
}

/** Inicio de sesión en ventana: cuando la tarjeta de acceso no está a la vista
 *  (p. ej. se entró con la clave de operador guardada). */
export function dialogoAcceso() {
  abrirModal({
    titulo: "Iniciar sesión",
    cuerpo: [
      campo({ nombre: "correo", etiqueta: "Correo", tipo: "email", requerido: true, maxLength: 254 }),
      campo({ nombre: "contrasena", etiqueta: "Contraseña", tipo: "password", requerido: true, maxLength: 128 }),
    ],
    acciones: [
      { texto: "Tengo un código", clase: "btn-outline-info me-auto", alPulsar: ({ form }) => {
        const correo = form.elements.correo.value.trim();
        setTimeout(() => dialogoRestablecer(correo), 350);
      } },
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Entrar", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          const u = await auth.iniciar(form.elements.correo.value.trim(), form.elements.contrasena.value);
          toast(`Hola, ${u.nombre}.`, "ok");
        },
      },
    ],
    alAbrir: ({ form }) => {
      form.elements.correo.setAttribute("autocomplete", "username");
      form.elements.contrasena.setAttribute("autocomplete", "current-password");
    },
  });
}

/* ----------------------------- Botón de usuario ----------------------------- */

function menuUsuario() {
  const u = sesionStore.usuario();
  if (!u) return;
  abrirModal({
    titulo: "Mi sesión",
    cuerpo: [
      el("dl", { class: "kv mb-0" }, [
        el("dt", { text: "Nombre" }), el("dd", { text: u.nombre }),
        el("dt", { text: "Correo" }), el("dd", { text: u.correo }),
        el("dt", { text: "Rol" }), el("dd", { text: ROL[u.rol] || u.rol }),
      ]),
      el("p", { class: "form-text mt-3 mb-0", text:
        "La sesión se renueva sola mientras la pestaña esté abierta y se cierra al cerrarla." }),
    ],
    acciones: [
      { texto: "Cambiar contraseña", clase: "btn-outline-info me-auto", alPulsar: () => { setTimeout(dialogoCambiarContrasena, 350); } },
      { texto: "Cerrar", clase: "btn-outline-secondary" },
      { texto: "Cerrar sesión", clase: "btn-danger", alPulsar: async () => { await auth.salir(); toast("Sesión cerrada."); } },
    ],
  });
}

/** Botón de la barra superior: «Entrar» o el nombre del usuario. */
export function montarBotonSesion(boton) {
  if (!boton) return;
  const pintar = () => {
    const u = sesionStore.usuario();
    boton.replaceChildren(icono(u ? "i-user" : "i-key"), el("span", { text: u ? u.nombre.split(" ")[0] : "Entrar" }));
    boton.classList.toggle("btn-outline-success", !!u);
    boton.classList.toggle("btn-outline-light", !u);
    boton.setAttribute("aria-label", u ? `Sesión de ${u.nombre} (${ROL[u.rol] || u.rol}). Abrir menú` : "Iniciar sesión");
  };
  boton.addEventListener("click", () => {
    if (sesionStore.usuario()) { menuUsuario(); return; }
    const correo = $("accesoCorreo");
    if (correo && correo.offsetParent !== null) correo.focus();     // la tarjeta de acceso está a la vista
    else dialogoAcceso();
  });
  sesionStore.alCambiar(pintar);
  pintar();
}
