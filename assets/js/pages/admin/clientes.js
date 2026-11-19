/**
 * Clientes y administradores (GET/POST /admin/usuarios).
 * La contraseña NUNCA la escribe el administrador: genera un código de un
 * solo uso (30 min) que el usuario canjea en «Tengo un código del administrador».
 */
import { CONFIG } from "../../config.js";
import { admin } from "../../api/admin-api.js";
import { sesionStore } from "../../core/sesion-store.js";
import { abrirModal, confirmar } from "../../ui/modales.js";
import { $, el, fechaHora, toast } from "../../ui/dom.js";
import { boton, fecha, filaCargando, filaVacia, formulario, insignia, pintarPaginador, retrasar } from "../../ui/admin-ui.js";

const COLS = 6;
const ROLES = [["usuario", "Cliente (comprador)"], ["admin", "Administrador"]];

/** Muestra el código UNA vez, con botón para copiarlo. */
function mostrarCodigo(r) {
  const codigo = el("output", { class: "codigo-unico", text: r.codigo, attrs: { "aria-label": `Código ${r.codigo.split("").join(" ")}` } });
  abrirModal({
    titulo: "Código de un solo uso",
    cuerpo: [
      el("p", { class: "small", text: `Para ${r.correo || "el usuario"}. Caduca en ${r.minutos ?? 30} minutos (${fechaHora(r.expira_en)}).` }),
      codigo,
      el("p", { class: "alert alert-warning py-2 small mt-3 mb-0", text:
        "Se muestra solo ahora: en la base únicamente queda su huella. Entrégalo por un canal privado. " +
        "El usuario lo usa en Administración › «Tengo un código del administrador» para poner su contraseña." }),
    ],
    acciones: [
      { texto: "Copiar", clase: "btn-outline-info me-auto", alPulsar: async () => {
        try { await navigator.clipboard.writeText(r.codigo); toast("Código copiado.", "ok"); } catch { toast("No se pudo copiar: selecciónalo a mano.", "error"); }
        return false;
      } },
      { texto: "Listo", clase: "btn-primary" },
    ],
  });
}

export function crearClientes({ alCambiar }) {
  const estado = { desplazamiento: 0 };
  const filtros = () => ({
    rol: $("cliRol").value || null,
    activo: $("cliActivo").value || null,
    q: $("cliBuscar").value.trim() || null,
    limite: CONFIG.paginaAdmin,
    desplazamiento: estado.desplazamiento,
  });

  async function cargar() {
    const tb = $("tbUsuarios");
    filaCargando(tb, COLS);
    let p;
    try { p = await admin.usuarios(filtros()); } catch (e) {
      filaVacia(tb, COLS, e.message);
      $("pagUsuarios").replaceChildren();
      return;
    }
    pintarPaginador($("pagUsuarios"), p, (d) => { estado.desplazamiento = d; cargar(); });
    if (!p.elementos.length) { filaVacia(tb, COLS, "Ningún usuario coincide. Registra uno con «Nuevo»."); return; }
    tb.replaceChildren(...p.elementos.map(fila));
  }

  function fila(u) {
    const yo = sesionStore.usuario()?.id_usuario === u.id_usuario;
    return el("tr", { class: u.activo ? "" : "inactiva" }, [
      el("td", {}, [
        el("span", { class: "celda-principal", text: u.nombre + (yo ? " (tú)" : "") }),
        el("small", { class: "celda-sec", text: u.correo }),
      ]),
      el("td", {}, [el("span", { class: `badge ${u.rol === "admin" ? "text-bg-warning" : "text-bg-light"}`, text: u.rol === "admin" ? "Admin" : "Cliente" })]),
      el("td", { class: "d-none d-sm-table-cell text-center", text: u.rol === "usuario" ? u.unidades : "—" }),
      el("td", { class: "d-none d-md-table-cell" }, [u.tiene_contrasena
        ? el("small", { text: `Último acceso: ${fecha(u.ultimo_acceso)}` })
        : el("span", { class: "badge text-bg-secondary", text: "Sin contraseña", attrs: { title: "Genera un código para que la ponga" } })]),
      el("td", {}, [insignia(u.activo)]),
      el("td", { class: "acciones" }, [
        boton("Editar", "i-edit", "btn-outline-info", () => editar(u), `Editar ${u.nombre}`),
        u.activo ? boton("Código", "i-key", "btn-outline-warning", () => generar(u), `Generar código de acceso para ${u.nombre}`) : null,
      ]),
    ]);
  }

  async function generar(u) {
    const texto = u.tiene_contrasena
      ? `Se generará un código para que ${u.nombre} ponga una contraseña NUEVA. Los códigos anteriores dejan de servir; su contraseña actual sigue valiendo hasta que use el código.`
      : `Se generará el código para que ${u.nombre} ponga su primera contraseña.`;
    if (!(await confirmar("Generar código", texto, "Generar"))) return;
    try {
      mostrarCodigo(await admin.codigoRestablecimiento(u.id_usuario));
      await cargar();
    } catch (e) { toast(e.message, "error"); }
  }

  function editar(u) {
    formulario(`Editar ${u.correo}`, [
      { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 100, valor: u.nombre },
      { nombre: "rol", etiqueta: "Rol", tipo: "select", requerido: true, valor: u.rol, opciones: ROLES,
        ayuda: "Un cliente con unidades asignadas no puede pasar a administrador." },
      { nombre: "activo", etiqueta: "Activo (desactivar cierra sus sesiones al instante)", tipo: "checkbox", valor: u.activo },
    ], async (d) => {
      await admin.actualizarUsuario(u.id_usuario, d);
      toast("Usuario actualizado.", "ok");
      await cargar();
      alCambiar();
    });
  }

  $("btnNuevoCliente").addEventListener("click", () => formulario("Registrar usuario", [
    { nombre: "correo", etiqueta: "Correo", tipo: "email", requerido: true, maxLength: 254 },
    { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 100 },
    { nombre: "rol", etiqueta: "Rol", tipo: "select", requerido: true, opciones: ROLES },
  ], async (d) => {
    const u = await admin.crearUsuario(d);
    toast("Usuario registrado.", "ok");
    await cargar();
    alCambiar();
    // Sin contraseña todavía: se ofrece el código de inmediato.
    setTimeout(() => generar(u), 400);
  }, { nota: "No escribas contraseñas: al guardar podrás generar un código de un solo uso para que el usuario ponga la suya." }));

  const reiniciar = () => { estado.desplazamiento = 0; cargar(); };
  $("cliRol").addEventListener("change", reiniciar);
  $("cliActivo").addEventListener("change", reiniciar);
  $("cliBuscar").addEventListener("input", retrasar(reiniciar));

  return { cargar };
}
