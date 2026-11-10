/**
 * Página de MONITOREO: conectividad, estado registrado, DEMO (seleccionar,
 * iniciar, cancelar y ver avance), historial, catálogo y eventos WSS.
 * Consultar no requiere clave; iniciar o cancelar una DEMO sí.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { WS } from "../core/ws-client.js";
import { claveStore } from "../core/clave-store.js";
import { DemoService } from "../domain/demo-service.js";
import { DemoPanel } from "../ui/demo-panel.js";
import { abrirDialogoClave, inicializarClave } from "../ui/clave-dialog.js";
import { $, el, fechaHora, fechaServidor, hora, toast } from "../ui/dom.js";
import { iniciarConectividad, pintarVehiculo, textoEvento } from "./comun.js";

const V = CONFIG.vehiculoId;
const MAX_FILAS = 200;
const GRUPO = {
  estado_inicial: "estado", estado_actualizado: "estado", movimiento_individual: "movimiento",
  demo_iniciada: "demo", demo_movimiento: "demo", demo_finalizada: "demo", demo_cancelada: "demo",
  error: "error", pong: "sistema",
};

const { ws } = iniciarConectividad();
const demo = new DemoService({ api, vehiculoId: V });
const demoPanel = new DemoPanel({ select: $("selDemo"), barra: $("barDemo"), barraPaso: $("barPaso"), texto: $("txtDemo") });
const contadores = { total: 0, movimiento: 0, demo: 0, error: 0 };
let pausado = false;
let filtro = "todos";
let wsAbierto = false;

/* ------------------------------- DEMO ------------------------------- */
function actualizarBotonesDemo() {
  const tieneClave = !!claveStore.obtener();
  const e = demo.estado;
  $("btnDemoIniciar").disabled = !(tieneClave && wsAbierto && !e.activa && !demo.solicitando && demoPanel.seleccion);
  $("btnDemoCancelar").disabled = !(tieneClave && e.activa && !demo.solicitando);
  $("btnDemoIniciar").setAttribute("aria-busy", String(demo.solicitando));
}

async function iniciarDemo() {
  const id = demoPanel.seleccion;
  if (!id) { toast("Selecciona una DEMO.", "error"); return; }
  if (!claveStore.obtener()) { abrirDialogoClave({ motivo: "Iniciar una DEMO requiere la clave de operador." }); return; }
  try {
    const r = await demo.iniciar(id);
    toast(`DEMO «${r.nombre}» aceptada (202) · ${r.total_movimientos} movimientos.`, "ok");
  } catch (e) {
    toast(e.message, "error");
    if (e.status === 401) abrirDialogoClave({ motivo: e.message });
  }
}

async function cancelarDemo() {
  if (!claveStore.obtener()) { abrirDialogoClave(); return; }
  try {
    await demo.cancelar();
    toast("Cancelación aceptada: el vehículo queda en DETENER.", "ok");
  } catch (e) {
    toast(e.message, "error");
  }
}

async function cargarDemos() {
  try { demoPanel.pintarLista(await demo.cargar()); }
  catch (e) { demoPanel.pintarLista([]); toast("DEMO: " + e.message, "error"); }
  actualizarBotonesDemo();
}

/* ------------------------------ Estado ------------------------------ */
function pintarEstado({ comando, codigo, fecha, conectado, fuente }) {
  $("monComando").textContent = comando || "—";
  $("monCodigo").textContent = codigo ?? "—";
  $("monFecha").textContent = fecha ? fechaHora(fecha) : "—";
  $("monFuente").textContent = fuente;
  const c = $("monConectado");
  c.textContent = conectado == null ? "—" : conectado ? "true (registrado en BD)" : "false (registrado en BD)";
}

async function cargarEstado() {
  try {
    const e = await api.estado(V);
    if (!e) { pintarEstado({ fuente: "El vehículo aún no tiene estado registrado" }); return; }
    pintarEstado({ comando: e.comando, codigo: e.codigo, fecha: fechaServidor(e.fecha_actualizacion), conectado: e.conectado, fuente: "GET /estado" });
  } catch (err) {
    $("monFuente").textContent = err.message;
  }
}

/* ----------------------------- Historial ---------------------------- */
let tHist = null;
async function cargarHistorial() {
  const ul = $("listaHistorial");
  try {
    const h = await api.historial(V);
    if (!h.movimientos.length) {
      ul.replaceChildren(el("li", { class: "vacio", text: "Aún no hay movimientos individuales." }));
    } else {
      ul.replaceChildren(...h.movimientos.map((m) => el("li", {}, [
        el("span", { class: "reg-txt", text: `${m.comando || "—"} (#${m.codigo ?? "—"})` }),
        el("span", { class: "reg-etq", text: m.origen }),
        el("time", { text: hora(fechaServidor(m.fecha_hora)) }),
      ])));
    }
    $("histTotal").textContent = `${h.total_devueltos} de máx. ${h.limite ?? 10}`;
  } catch (err) {
    ul.replaceChildren(el("li", { class: "vacio", text: err.message }));
  }
}
const programarHistorial = () => { clearTimeout(tHist); tHist = setTimeout(cargarHistorial, CONFIG.tiempos.historialRetrasoMs); };

/* ----------------------------- Catálogo ----------------------------- */
async function cargarCatalogo() {
  const tb = $("tablaCatalogo");
  try {
    const lista = (await api.comandos(V)).sort((a, b) => a.codigo - b.codigo);
    tb.replaceChildren(...lista.map((c) => el("tr", { class: c.activo ? "" : "text-body-tertiary" }, [
      el("td", { text: c.codigo }), el("td", { text: c.nombre }),
      el("td", { text: c.activo ? "Activo" : "Inactivo" }),
    ])));
  } catch (err) {
    tb.replaceChildren(el("tr", {}, [el("td", { text: err.message, attrs: { colspan: 3 } })]));
  }
}

/* ------------------------------ Eventos ----------------------------- */
function agregarFila(ev) {
  const grupo = GRUPO[ev.evento] || "sistema";
  const fila = el("tr", { dataset: { grupo } }, [
    el("td", { text: hora() }),
    el("td", {}, [el("span", { class: `badge ev-${grupo}`, text: ev.evento })]),
    el("td", { text: ev.comando ?? "—" }),
    el("td", { text: ev.codigo ?? "—" }),
    el("td", { class: "text-nowrap", text: ev.timestamp ? hora(ev.timestamp) : "—" }),
    el("td", { class: "detalle", text: textoEvento(ev) }),
  ]);
  fila.hidden = filtro !== "todos" && filtro !== grupo;
  const tb = $("tablaEventos");
  tb.prepend(fila);
  while (tb.children.length > MAX_FILAS) tb.lastChild.remove();
  $("eventosVacio").hidden = true;
}

function contar(ev) {
  contadores.total++;
  if (ev.evento === "movimiento_individual") contadores.movimiento++;
  if (ev.evento === "demo_movimiento") contadores.demo++;
  if (ev.evento === "error") contadores.error++;
  $("cntTotal").textContent = contadores.total;
  $("cntMov").textContent = contadores.movimiento;
  $("cntDemo").textContent = contadores.demo;
  $("cntError").textContent = contadores.error;
}

ws.addEventListener("mensaje", (e) => {
  const ev = e.detail;
  if (ev.evento === "pong") return;
  contar(ev);
  demo.procesarEvento(ev);
  if (["estado_inicial", "estado_actualizado", "movimiento_individual"].includes(ev.evento)) {
    pintarEstado({
      comando: ev.comando, codigo: ev.codigo, fecha: fechaServidor(ev.datos.fecha_actualizacion) || ev.timestamp,
      conectado: ev.datos.conectado, fuente: "WSS · " + ev.evento,
    });
  } else if (ev.evento === "demo_movimiento" || ev.evento === "demo_cancelada") {
    $("monComando").textContent = ev.comando || "—";
    $("monCodigo").textContent = ev.codigo ?? "—";
    $("monFecha").textContent = fechaHora(ev.timestamp);
    $("monFuente").textContent = "WSS · " + ev.evento + " (no se guarda en historial)";
  }
  if (ev.evento === "movimiento_individual") programarHistorial();
  if (!pausado) agregarFila(ev);
});
ws.addEventListener("estado", (e) => {
  wsAbierto = e.detail.estado === WS.ABIERTO;
  actualizarBotonesDemo();
  if (wsAbierto) {
    demo.sincronizar().catch(() => {});
    cargarEstado();
    programarHistorial();
  }
});
demo.addEventListener("cambio", (e) => { demoPanel.pintar(e.detail); actualizarBotonesDemo(); });
$("btnDemoIniciar").addEventListener("click", iniciarDemo);
$("btnDemoCancelar").addEventListener("click", cancelarDemo);
$("selDemo").addEventListener("change", actualizarBotonesDemo);
claveStore.alCambiar(actualizarBotonesDemo);

$("selFiltro").addEventListener("change", (e) => {
  filtro = e.target.value;
  for (const tr of $("tablaEventos").children) tr.hidden = filtro !== "todos" && filtro !== tr.dataset.grupo;
});
$("btnPausa").addEventListener("click", (e) => {
  pausado = !pausado;
  e.currentTarget.setAttribute("aria-pressed", String(pausado));
  e.currentTarget.querySelector("span").textContent = pausado ? "Reanudar" : "Pausar";
  toast(pausado ? "Lista en pausa (los contadores siguen)." : "Lista reanudada.");
});
$("btnLimpiar").addEventListener("click", () => { $("tablaEventos").replaceChildren(); $("eventosVacio").hidden = false; });
$("btnHistorial").addEventListener("click", cargarHistorial);
$("btnEstado").addEventListener("click", cargarEstado);
$("wsUrl").textContent = CONFIG.wsUrl(V);

(async function iniciar() {
  inicializarClave();
  await Promise.all([pintarVehiculo(), cargarEstado(), cargarHistorial(), cargarCatalogo(), cargarDemos(), demo.sincronizar().catch(() => {})]);
  ws.conectar();
})();
