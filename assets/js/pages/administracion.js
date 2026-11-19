/**
 * Página de ADMINISTRACIÓN (Etapa 5).
 *
 * Vistas según quién entra:
 * - Sin sesión ni clave → tarjeta de inicio de sesión.
 * - Comprador (rol usuario) → sus unidades (el resto llega en la Etapa 6).
 * - Administrador (token admin, o clave X-API-Key de admin en transición) →
 *   Panel, Inventario, Modelos, Clientes, Asignaciones, Bitácora y el
 *   catálogo técnico (Vehículos, Comandos, DEMO) y Configuración.
 * - Clave de operador (transición) → solo el catálogo técnico.
 *
 * Las pestañas se cargan al abrirlas (siempre con datos frescos de RDS).
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { auth } from "../api/auth-api.js";
import { claveStore } from "../core/clave-store.js";
import { sesionStore } from "../core/sesion-store.js";
import { abrirDialogoClave, inicializarClave } from "../ui/clave-dialog.js";
import { abrirModal, campo, confirmar, leerFormulario } from "../ui/modales.js";
import { montarAcceso, montarBotonSesion } from "../ui/sesion-ui.js";
import { $, el, icono, toast } from "../ui/dom.js";
import { fecha, insigniaEstado } from "../ui/admin-ui.js";
import { iniciarConectividad } from "./comun.js";
import { crearPanel } from "./admin/panel.js";
import { crearInventario } from "./admin/inventario.js";
import { crearModelos } from "./admin/modelos.js";
import { crearClientes } from "./admin/clientes.js";
import { crearAsignaciones } from "./admin/asignaciones.js";
import { crearBitacora } from "./admin/bitacora.js";

let vehiculos = [];
let vehiculoSel = CONFIG.vehiculoId;
let comandos = [];
let demos = [];
let demoSel = null;

/* ----------------------------- Utilidades ---------------------------- */
/** ¿Puede escribir en el catálogo técnico? Admin con sesión, o clave (transición). */
function requiereClave() {
  if (claveStore.obtener() || sesionStore.esAdmin()) return true;
  abrirDialogoClave({ motivo: "Esta operación requiere iniciar sesión como administrador o la clave de operador." });
  return false;
}

function boton(texto, ic, clase, onClick, etiqueta) {
  return el("button", {
    class: `btn btn-sm ${clase}`, attrs: { type: "button", "aria-label": etiqueta || texto, title: etiqueta || texto },
    on: { click: onClick },
  }, [icono(ic), el("span", { class: "d-none d-md-inline", text: texto })]);
}

function insignia(activo) {
  return el("span", { class: `badge ${activo ? "text-bg-success" : "text-bg-secondary"}`, text: activo ? "Activo" : "Inactivo" });
}

function filaVacia(tbody, columnas, texto) {
  tbody.replaceChildren(el("tr", {}, [el("td", { class: "vacio", text: texto, attrs: { colspan: columnas } })]));
}

/** Ejecuta una escritura, muestra el resultado y refresca. */
async function escribir(accion, mensajeOk, refrescar) {
  try {
    await accion();
    toast(mensajeOk, "ok");
    await refrescar();
  } catch (e) {
    toast(e.message, "error");
    if (e.status === 401 && !sesionStore.activa()) abrirDialogoClave({ motivo: e.message });
  }
}

/** Formulario modal: la promesa del envío lanza error para mostrarlo dentro del modal. */
function formulario(titulo, campos, guardar) {
  if (!requiereClave()) return;
  abrirModal({
    titulo,
    cuerpo: campos.map(campo),
    acciones: [
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Guardar", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          try {
            await guardar(leerFormulario(form));
          } catch (e) {
            if (e.status === 401 && claveStore.obtener()) { claveStore.olvidar(); }
            throw e;
          }
        },
      },
    ],
  });
}

/* ----------------------------- Vehículos ---------------------------- */
const camposVehiculo = (v = {}, edicion = false) => [
  { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80, valor: v.nombre },
  { nombre: "modelo", etiqueta: "Modelo", maxLength: 80, valor: v.modelo },
  { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: v.descripcion },
  { nombre: "microcontrolador", etiqueta: "Microcontrolador", maxLength: 50, valor: v.microcontrolador, ayuda: "Ej.: ESP32 o ESP8266" },
  ...(edicion ? [{ nombre: "activo", etiqueta: "Activo", tipo: "checkbox", valor: v.activo }] : []),
];

async function cargarVehiculos() {
  const tb = $("tbVehiculos");
  try {
    vehiculos = await api.vehiculos();
  } catch (e) {
    filaVacia(tb, 6, e.message);
    return;
  }
  if (!vehiculos.some((v) => v.id_vehiculo === vehiculoSel) && vehiculos.length) vehiculoSel = vehiculos[0].id_vehiculo;
  const sel = $("selVehiculo");
  sel.replaceChildren(...vehiculos.map((v) => el("option", { text: `#${v.id_vehiculo} · ${v.nombre}`, attrs: { value: v.id_vehiculo } })));
  sel.value = String(vehiculoSel);

  if (!vehiculos.length) { filaVacia(tb, 6, "No hay vehículos registrados."); return; }
  tb.replaceChildren(...vehiculos.map((v) => el("tr", {}, [
    el("td", { text: v.id_vehiculo }),
    el("td", { text: v.nombre }),
    el("td", { class: "d-none d-md-table-cell", text: v.modelo || "—" }),
    el("td", { class: "d-none d-sm-table-cell", text: v.microcontrolador || "—" }),
    el("td", {}, [insignia(v.activo)]),
    el("td", { class: "acciones" }, [
      boton("Editar", "i-edit", "btn-outline-info", () => formulario(`Editar vehículo #${v.id_vehiculo}`, camposVehiculo(v, true),
        async (d) => { await api.actualizarVehiculo(v.id_vehiculo, d); toast("Vehículo actualizado.", "ok"); await cargarVehiculos(); }),
      `Editar vehículo ${v.nombre}`),
      boton("Eliminar", "i-trash", "btn-outline-danger", async () => {
        if (!requiereClave()) return;
        if (!(await confirmar("Eliminar vehículo", `Se eliminará «${v.nombre}» con sus comandos y DEMO. Si tiene historial, la API lo rechaza para conservarlo: usa «Baja» en Inventario. Requiere administrador.`))) return;
        await escribir(() => api.eliminarVehiculo(v.id_vehiculo), "Vehículo eliminado.", recargarTodo);
      }, `Eliminar vehículo ${v.nombre}`),
    ]),
  ])));
}

/* ----------------------------- Comandos ----------------------------- */
const camposComando = (c = {}, edicion = false) => [
  { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 60, valor: c.nombre, ayuda: "Único por vehículo. DETENER es el nombre que usa el paro." },
  { nombre: "codigo", etiqueta: "Código", tipo: "number", requerido: true, min: 0, max: 65535, valor: c.codigo, ayuda: "Único por vehículo (0–65535)." },
  { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: c.descripcion },
  ...(edicion ? [{ nombre: "activo", etiqueta: "Activo", tipo: "checkbox", valor: c.activo }] : []),
];

async function cargarComandos() {
  const tb = $("tbComandos");
  try {
    comandos = (await api.comandos(vehiculoSel)).sort((a, b) => a.codigo - b.codigo);
  } catch (e) {
    comandos = [];
    filaVacia(tb, 5, e.message);
    return;
  }
  if (!comandos.length) { filaVacia(tb, 5, "Este vehículo no tiene comandos."); return; }
  tb.replaceChildren(...comandos.map((c) => el("tr", {}, [
    el("td", { text: c.codigo }),
    el("td", { text: c.nombre }),
    el("td", { class: "d-none d-md-table-cell", text: c.descripcion || "—" }),
    el("td", {}, [insignia(c.activo)]),
    el("td", { class: "acciones" }, [
      boton("Editar", "i-edit", "btn-outline-info", () => formulario(`Editar comando ${c.nombre}`, camposComando(c, true),
        async (d) => { await api.actualizarComando(vehiculoSel, c.id_comando, d); toast("Comando actualizado.", "ok"); await cargarComandos(); }),
      `Editar comando ${c.nombre}`),
      boton("Eliminar", "i-trash", "btn-outline-danger", async () => {
        if (!requiereClave()) return;
        if (!(await confirmar("Eliminar comando", `Se eliminará «${c.nombre}» (código ${c.codigo}). Si lo usa una DEMO, la API responderá 409.`))) return;
        await escribir(() => api.eliminarComando(vehiculoSel, c.id_comando), "Comando eliminado.", cargarComandos);
      }, `Eliminar comando ${c.nombre}`),
    ]),
  ])));
}

/* -------------------------------- DEMO ------------------------------ */
const camposDemo = (d = {}, edicion = false) => [
  { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80, valor: d.nombre },
  { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: d.descripcion },
  ...(edicion ? [{ nombre: "activo", etiqueta: "Activa", tipo: "checkbox", valor: d.activo }] : []),
];

async function cargarDemos() {
  const tb = $("tbDemos");
  try {
    demos = await api.demos(vehiculoSel);
  } catch (e) {
    demos = [];
    filaVacia(tb, 4, e.message);
    return;
  }
  if (!demos.some((d) => d.id_demo === demoSel)) demoSel = demos[0]?.id_demo ?? null;
  if (!demos.length) filaVacia(tb, 4, "Este vehículo no tiene DEMO.");
  else tb.replaceChildren(...demos.map((d) => el("tr", { class: d.id_demo === demoSel ? "table-active" : "" }, [
    el("td", { text: d.nombre }),
    el("td", { class: "d-none d-md-table-cell", text: d.descripcion || "—" }),
    el("td", {}, [insignia(d.activo)]),
    el("td", { class: "acciones" }, [
      boton("Pasos", "i-list", "btn-outline-light", () => { demoSel = d.id_demo; cargarDemos(); }, `Ver movimientos de ${d.nombre}`),
      boton("Editar", "i-edit", "btn-outline-info", () => formulario(`Editar DEMO ${d.nombre}`, camposDemo(d, true),
        async (x) => { await api.actualizarDemo(vehiculoSel, d.id_demo, x); toast("DEMO actualizada.", "ok"); await cargarDemos(); }),
      `Editar DEMO ${d.nombre}`),
      boton("Eliminar", "i-trash", "btn-outline-danger", async () => {
        if (!requiereClave()) return;
        if (!(await confirmar("Eliminar DEMO", `Se eliminará «${d.nombre}» y sus movimientos. Si está en ejecución, la API responderá 409.`))) return;
        await escribir(() => api.eliminarDemo(vehiculoSel, d.id_demo), "DEMO eliminada.", cargarDemos);
      }, `Eliminar DEMO ${d.nombre}`),
    ]),
  ])));
  await cargarMovimientos();
}

const camposMovimiento = (m = {}) => [
  {
    nombre: "id_comando", etiqueta: "Comando", tipo: "select", requerido: true, entero: true, valor: m.id_comando,
    opciones: comandos.filter((c) => c.activo).map((c) => [String(c.id_comando), `${c.nombre} (#${c.codigo})`]),
  },
  { nombre: "orden", etiqueta: "Orden", tipo: "number", requerido: true, min: 1, max: 10000, valor: m.orden, ayuda: "No puede repetirse dentro de la DEMO." },
  { nombre: "duracion_ms", etiqueta: "Duración (ms)", tipo: "number", requerido: true, min: 1, max: 600000, valor: m.duracion_ms },
  { nombre: "pausa_ms", etiqueta: "Pausa (ms)", tipo: "number", requerido: true, min: 0, max: 600000, valor: m.pausa_ms ?? 0 },
];

async function cargarMovimientos() {
  const tb = $("tbMovimientos");
  const d = demos.find((x) => x.id_demo === demoSel);
  $("tituloMovimientos").textContent = d ? `Movimientos de «${d.nombre}»` : "Movimientos de la DEMO";
  $("btnNuevoMovimiento").disabled = !d;
  if (!d) { filaVacia(tb, 5, "Selecciona una DEMO."); return; }
  let movs;
  try { movs = await api.movimientosDemo(vehiculoSel, d.id_demo); } catch (e) { filaVacia(tb, 5, e.message); return; }
  const total = movs.reduce((s, m) => s + m.duracion_ms + m.pausa_ms, 0);
  $("totalMovimientos").textContent = `${movs.length} pasos · ~${(total / 1000).toFixed(1)} s`;
  if (!movs.length) { filaVacia(tb, 5, "La DEMO no tiene movimientos (la API no permite iniciarla así)."); return; }
  tb.replaceChildren(...movs.map((m) => el("tr", {}, [
    el("td", { text: m.orden }),
    el("td", { text: `${m.comando} (#${m.codigo})` }),
    el("td", { text: m.duracion_ms }),
    el("td", { text: m.pausa_ms }),
    el("td", { class: "acciones" }, [
      boton("Editar", "i-edit", "btn-outline-info", () => formulario(`Editar paso ${m.orden}`, camposMovimiento(m),
        async (x) => { await api.actualizarMovimientoDemo(vehiculoSel, d.id_demo, m.id_demo_movimiento, x); toast("Paso actualizado.", "ok"); await cargarMovimientos(); }),
      `Editar paso ${m.orden}`),
      boton("Eliminar", "i-trash", "btn-outline-danger", async () => {
        if (!requiereClave()) return;
        if (!(await confirmar("Eliminar paso", `Se eliminará el paso ${m.orden} (${m.comando}).`))) return;
        await escribir(() => api.eliminarMovimientoDemo(vehiculoSel, d.id_demo, m.id_demo_movimiento), "Paso eliminado.", cargarMovimientos);
      }, `Eliminar paso ${m.orden}`),
    ]),
  ])));
}

/* --------------------------- Configuración -------------------------- */
function pintarConfiguracion() {
  const datos = [
    ["URL base de la API", CONFIG.apiBaseUrl],
    ["WebSocket (WSS)", CONFIG.wsUrl(CONFIG.vehiculoId)],
    ["Vehículo del control", `#${CONFIG.vehiculoId}`],
    ["Tiempo límite REST", `${CONFIG.tiempos.timeoutMs} ms`],
    ["Comprobación de salud", `cada ${CONFIG.tiempos.saludCadaMs / 1000} s`],
    ["Reenvío del joystick mantenido", CONFIG.tiempos.mantenerMs ? `${CONFIG.tiempos.mantenerMs} ms` : "desactivado"],
    ["Origen de la página", location.origin],
  ];
  $("dlConfig").replaceChildren(...datos.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]));
  const a = $("lnkDocs");
  a.href = CONFIG.docsUrl;
}

function pintarClave() {
  const rol = claveStore.rol();
  const u = sesionStore.usuario();
  if (u && !claveStore.obtener()) {
    $("estadoClave").textContent = `Sesión de ${u.nombre} (${u.rol === "admin" ? "administrador" : "comprador"}). No hace falta la clave X-API-Key.`;
    return;
  }
  $("estadoClave").textContent = claveStore.obtener()
    ? `Clave guardada en este navegador · rol: ${rol === "admin" ? "administrador (crear, actualizar y eliminar)" : rol === "operador" ? "operador (crear y actualizar; eliminar devolverá 403)" : "sin validar"}`
    : claveStore.esAbierto()
      ? "Control abierto: mover y la DEMO no piden clave, pero crear, editar y eliminar sí. Pulsa «Control abierto» para escribir la clave."
      : "Sin clave: solo puedes consultar. Pulsa «Sin clave» para escribirla.";
}

async function recargarTodo() {
  await cargarVehiculos();
  await Promise.all([cargarComandos(), cargarDemos()]);
}

/* ------------------------- Eventos del catálogo ------------------------- */
$("selVehiculo").addEventListener("change", async (e) => {
  vehiculoSel = Number.parseInt(e.target.value, 10);
  demoSel = null;
  await Promise.all([cargarComandos(), cargarDemos()]);
});
$("btnNuevoVehiculo").addEventListener("click", () => formulario("Nuevo vehículo", camposVehiculo(),
  async (d) => { const v = await api.crearVehiculo(d); vehiculoSel = v.id_vehiculo; toast("Vehículo creado.", "ok"); await recargarTodo(); }));
$("btnNuevoComando").addEventListener("click", () => formulario("Nuevo comando", camposComando(),
  async (d) => { await api.crearComando(vehiculoSel, d); toast("Comando creado.", "ok"); await cargarComandos(); }));
$("btnNuevaDemo").addEventListener("click", () => formulario("Nueva DEMO", camposDemo(),
  async (d) => { const x = await api.crearDemo(vehiculoSel, d); demoSel = x.id_demo; toast("DEMO creada.", "ok"); await cargarDemos(); }));
$("btnNuevoMovimiento").addEventListener("click", async () => {
  if (!comandos.length) await cargarComandos();
  formulario("Agregar paso a la DEMO", camposMovimiento(),
    async (d) => { await api.agregarMovimientoDemo(vehiculoSel, demoSel, d); toast("Paso agregado.", "ok"); await cargarMovimientos(); });
});

/* ------------------------ Secciones de la empresa ----------------------- */
// Si el inventario crea o cambia unidades, el selector del catálogo técnico se recarga al volver.
let vehiculosObsoletos = true;
const ctx = { alCambiar: () => { vehiculosObsoletos = true; } };

async function asegurarVehiculos() {
  if (!vehiculosObsoletos) return;
  await cargarVehiculos();
  vehiculosObsoletos = false;
}

const secciones = {
  "pnl-panel": crearPanel(),
  "pnl-inv": crearInventario(ctx),
  "pnl-mod": crearModelos(ctx),
  "pnl-cli": crearClientes(ctx),
  "pnl-asg": crearAsignaciones(ctx),
  "pnl-bit": crearBitacora(),
  "pnl-veh": { cargar: async () => { vehiculosObsoletos = true; await asegurarVehiculos(); } },
  "pnl-cmd": { cargar: async () => { await asegurarVehiculos(); await cargarComandos(); } },
  "pnl-demo": { cargar: async () => { await asegurarVehiculos(); await Promise.all([cargarComandos(), cargarDemos()]); } },
  "pnl-conf": { cargar: async () => { pintarConfiguracion(); pintarClave(); } },
};

const panelActivo = () => document.querySelector("#vistaAdmin .tab-pane.active")?.id;

async function cargarActiva() {
  const id = panelActivo();
  // El selector de vehículo solo aplica a Comandos y DEMO.
  $("barraVehiculo").classList.toggle("d-none", !["pnl-cmd", "pnl-demo"].includes(id));
  await secciones[id]?.cargar();
}

document.querySelectorAll('#vistaAdmin [data-bs-toggle="tab"]').forEach((b) => b.addEventListener("shown.bs.tab", cargarActiva));
$("btnRecargar").addEventListener("click", cargarActiva);

/* -------------------------------- Vistas -------------------------------- */
let vistaActual = "";

async function pintarMisVehiculos() {
  const lista = $("listaMisVehiculos");
  lista.replaceChildren(el("li", { class: "vacio", text: "Cargando…" }));
  try {
    const mias = await auth.misVehiculos();
    if (!mias.length) {
      lista.replaceChildren(el("li", { class: "vacio", text: "Todavía no tienes unidades asignadas. La empresa te las asigna al comprarlas." }));
      return;
    }
    lista.replaceChildren(...mias.map((v) => el("li", { class: "mi-vehiculo" }, [
      el("div", {}, [
        el("strong", { text: v.nombre }),
        el("small", { class: "celda-sec", text: `${v.modelo || "Modelo sin nombre"}${v.numero_serie ? ` · Serie ${v.numero_serie}` : ""}` }),
      ]),
      el("div", { class: "text-end" }, [
        insigniaEstado(v.estado_comercial),
        el("small", { class: "celda-sec", text: `Tuya desde ${fecha(v.asignada_desde)}` }),
      ]),
    ])));
  } catch (e) {
    lista.replaceChildren(el("li", { class: "aviso aviso-error", text: e.message }));
  }
}

/** Decide qué vista mostrar según la sesión y la clave guardada. */
async function aplicarVista() {
  const u = sesionStore.usuario();
  const rolClave = claveStore.obtener() ? claveStore.rol() : "";
  let vista = "acceso";
  if (u && u.rol === "usuario" && !rolClave) vista = "comprador";
  else if ((u && u.rol === "admin") || rolClave === "admin") vista = "admin";
  else if (rolClave === "operador") vista = "operador";

  $("btnClave").classList.toggle("d-none", !!u);          // con sesión la clave no hace falta
  pintarClave();
  if (vista === vistaActual) return;
  vistaActual = vista;

  $("vistaAcceso").hidden = vista !== "acceso";
  $("vistaComprador").hidden = vista !== "comprador";
  $("vistaAdmin").hidden = !["admin", "operador"].includes(vista);
  document.querySelectorAll("#vistaAdmin .solo-admin").forEach((n) => n.classList.toggle("d-none", vista === "operador"));
  $("contenido").removeAttribute("aria-busy");

  if (vista === "acceso") { setTimeout(() => $("accesoCorreo")?.focus(), 50); return; }
  if (vista === "comprador") { await pintarMisVehiculos(); return; }

  // Operador: no ve las pestañas de la empresa → empieza en Vehículos.
  const inicial = location.hash === "#demo" ? "tab-demo" : vista === "operador" ? "tab-veh" : "tab-panel";
  const boton = $(inicial);
  if (boton.classList.contains("active")) await cargarActiva();
  else window.bootstrap.Tab.getOrCreateInstance(boton).show();     // dispara shown.bs.tab → carga
}

/* Indicadores WSS · AWS · RDS en el menú (igual que Control), con la conexión WSS compartida. */
const { ws } = iniciarConectividad({ barra: true });

(async function iniciar() {
  ws.conectar();
  montarAcceso($("vistaAcceso"));
  montarBotonSesion($("btnSesion"));
  sesionStore.alCambiar(() => { aplicarVista(); });
  claveStore.alCambiar(() => { aplicarVista(); });
  await Promise.all([auth.recuperar(), inicializarClave()]);
  await aplicarVista();
})();
