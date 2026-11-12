/**
 * Página de MONITOREO (solo lectura, no requiere clave):
 *  1. Nombre del vehículo (GET /vehiculos/{id}).
 *  2. Indicadores WSS · API AWS · Amazon RDS (mismos que en Control).
 *  3. Tarjeta del último movimiento REPORTADO: GET /estado al entrar y al
 *     reconectar; después, eventos WSS válidos del mismo vehículo (también de
 *     otras sesiones y pasos de DEMO). Nunca muestra datos más viejos que los
 *     que ya tiene (domain/monitoreo-estado.js).
 *  4. Tabla de los últimos diez movimientos PERSISTIDOS (GET /historial). Un
 *     evento WSS de movimiento individual dispara una consulta (agrupada y sin
 *     consultas simultáneas) que reconcilia la tabla sin recargar la página.
 *  + Registro técnico de eventos WSS, plegado.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { WS } from "../core/ws-client.js";
import { Catalogo } from "../domain/catalogo.js";
import { DemoService } from "../domain/demo-service.js";
import { UltimoMovimiento, HistorialReciente, FUENTE } from "../domain/monitoreo-estado.js";
import { inicializarClave } from "../ui/clave-dialog.js";
import { $, el, hora, icono } from "../ui/dom.js";
import { iniciarConectividad, textoEvento } from "./comun.js";

const V = CONFIG.vehiculoId;
const MAX_EVENTOS = 200;
const GRUPO = {
  estado_inicial: "estado", estado_actualizado: "estado", movimiento_individual: "movimiento",
  demo_iniciada: "demo", demo_movimiento: "demo", demo_finalizada: "demo", demo_cancelada: "demo",
  error: "error", pong: "sistema",
};
const FMT_FECHA = new Intl.DateTimeFormat("es-MX", { day: "2-digit", month: "short", year: "numeric" });
const FMT_HORA = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fecha = (ms) => (ms == null ? "—" : FMT_FECHA.format(ms));
const horaDe = (ms) => (ms == null ? "—" : FMT_HORA.format(ms));
const etiqueta = (nombre) => (nombre ? Catalogo.etiqueta({ nombre }) : "Comando sin nombre");

const { ws } = iniciarConectividad();
const demo = new DemoService({ api, vehiculoId: V });
const ultimo = new UltimoMovimiento();
const historial = new HistorialReciente(10);
let wsAbierto = false;
let vehiculo = null;

/* ------------------------------ 1. Vehículo ------------------------------ */
async function cargarVehiculo() {
  try {
    vehiculo = await api.vehiculo(V);
    $("monNombre").textContent = vehiculo.nombre;
    $("vehiculoNombre").textContent = `${vehiculo.nombre} · ${vehiculo.microcontrolador || "IoT"} · #${vehiculo.id_vehiculo}`;
    const partes = [vehiculo.modelo, vehiculo.microcontrolador, `Vehículo #${vehiculo.id_vehiculo}`, vehiculo.activo ? "Activo en la base de datos" : "Inactivo en la base de datos"];
    $("monVehiculoInfo").textContent = partes.filter(Boolean).join(" · ");
  } catch (e) {
    $("monNombre").textContent = `Vehículo #${V}`;
    $("monVehiculoInfo").textContent = "No se pudo consultar el nombre: " + e.message;
  }
  pintarUltimo();
}

/* ------------------------ 2. Último movimiento ------------------------ */
const tarjeta = { cargando: true, error: "" };

async function cargarEstado() {
  tarjeta.cargando = !ultimo.actual;
  pintarUltimo();
  try {
    ultimo.desdeEstado(await api.estado(V));          // ignorado si ya hay algo más reciente (p. ej. por WSS)
    tarjeta.error = "";
  } catch (e) {
    tarjeta.error = e.message;
  }
  tarjeta.cargando = false;
  pintarUltimo();
}

function frescura() {
  const a = ultimo.actual;
  if (!a && tarjeta.cargando) return { tipo: "medio", ic: "i-sync", txt: "Cargando…", gira: true };
  if (!a && tarjeta.error) return { tipo: "mal", ic: "i-x", txt: "Sin datos actualizados" };
  if (!a) return { tipo: "neutro", ic: "i-info", txt: wsAbierto ? "Esperando movimientos" : "Sin datos actualizados" };
  if (!wsAbierto) return { tipo: "medio", ic: "i-history", txt: "Último valor conocido · sin datos actualizados" };
  if (tarjeta.error && a.fuente === FUENTE.REST) return { tipo: "medio", ic: "i-history", txt: "Último valor conocido" };
  return { tipo: "ok", ic: "i-check", txt: "En vivo" };
}

/** Categoría del comando (solo para la etiqueta y el color de acento). */
function categoria(a) {
  if (a.demo) return { cat: "demo", txt: `DEMO${a.demo.nombre ? ` «${a.demo.nombre}»` : ""} · paso ${a.demo.orden ?? "?"}${a.demo.total ? ` de ${a.demo.total}` : ""}` };
  if ((a.comando || "").toUpperCase() === CONFIG.nombreDetener) return { cat: "paro", txt: "Paro" };
  if (Object.values(CONFIG.direcciones).includes(a.codigo)) return { cat: "conduccion", txt: "Conducción" };
  if (Object.values(CONFIG.brazo).includes(a.codigo)) return { cat: "brazo", txt: "Brazo y pala" };
  if (CONFIG.interruptores[a.codigo]) return { cat: "accesorio", txt: "Accesorio" };
  return { cat: "otro", txt: "Comando" };
}

/** «hace 12 s» a partir de la hora del servidor (si el reloj del equipo difiere, se dice «hace instantes»). */
function hace(ms) {
  if (ms == null) return "";
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 10) return "hace instantes";
  if (s < 60) return `hace ${s} s`;
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  if (s < 86400) return `hace ${Math.floor(s / 3600)} h`;
  const d = Math.floor(s / 86400);
  return `hace ${d} día${d === 1 ? "" : "s"}`;
}

function paso(id, estado, texto, detalle = "") {
  const li = $(id);
  li.dataset.estado = estado;           // ok | no | sin | espera  (la marca ✓ · – · ? va por CSS, además del color)
  li.querySelector(".paso-txt").replaceChildren(texto, ...(detalle ? [el("small", { text: detalle })] : []));
}

function pintarUltimo() {
  const a = ultimo.actual;
  const f = frescura();
  const badge = $("ultFrescura");
  badge.dataset.tipo = f.tipo;
  badge.replaceChildren(icono(f.ic, f.gira ? "ico gira" : "ico"), el("span", { text: f.txt }));
  const card = $("tarjetaUltimo");
  card.dataset.estado = a ? (a.demo ? "demo" : "datos") : tarjeta.cargando ? "cargando" : "vacio";
  $("ultVehiculo").textContent = vehiculo?.nombre || `Vehículo #${V}`;

  if (!a) {
    card.dataset.cat = "";
    $("ultCategoria").textContent = tarjeta.cargando ? "Consultando…" : tarjeta.error ? "Sin datos actualizados" : "Sin registros";
    $("ultMov").textContent = tarjeta.cargando ? "Cargando…" : "Sin movimientos";
    $("ultTipo").textContent = tarjeta.cargando ? "Consultando el estado del vehículo (GET /estado)."
      : tarjeta.error ? `No se pudo consultar el estado: ${tarjeta.error}`
      : "El vehículo aún no tiene movimientos reportados.";
    for (const id of ["ultFecha", "ultHora", "ultFuente"]) $(id).textContent = "—";
    $("ultHace").textContent = "";
    $("ultFecha").removeAttribute("datetime");
    $("ultHora").removeAttribute("datetime");
    $("ultCodigoFila").hidden = true;
    $("ultOrigenFila").hidden = true;
    paso("pasoApi", "espera", "Registrado por la API");
    paso("pasoWss", "espera", "Difundido por WSS");
    paso("pasoFisico", "sin", "Ejecución física", "sin confirmación del ESP32");
    return;
  }

  const c = categoria(a);
  card.dataset.cat = c.cat;
  $("ultCategoria").textContent = c.txt;
  $("ultMov").textContent = etiqueta(a.comando);
  $("ultTipo").textContent = a.demo ? "Paso de una DEMO: no se guarda en el historial."
    : a.evento === "movimiento_individual" ? "Movimiento individual guardado en el historial."
    : "Último comando registrado del vehículo.";
  if (a.ms != null) {
    const iso = new Date(a.ms).toISOString();
    $("ultFecha").textContent = fecha(a.ms);
    $("ultHora").textContent = horaDe(a.ms);
    $("ultFecha").setAttribute("datetime", iso);
    $("ultHora").setAttribute("datetime", iso);
  } else {
    $("ultFecha").textContent = "Sin fecha registrada";
    $("ultHora").textContent = "—";
    $("ultFecha").removeAttribute("datetime");
    $("ultHora").removeAttribute("datetime");
  }
  $("ultHace").textContent = hace(a.ms);
  $("ultCodigoFila").hidden = a.codigo == null;
  $("ultCodigo").textContent = a.codigo ?? "—";
  $("ultOrigenFila").hidden = !a.origen;
  $("ultOrigen").textContent = (a.origen || "—").replace(/^WEB_/, "");
  $("ultOrigen").title = a.origen || "";
  $("ultFuente").textContent = a.fuente === FUENTE.WSS ? "WebSocket" : "API REST";
  $("ultFuente").title = a.fuente === FUENTE.WSS ? `Evento WSS «${a.evento}»` : "Consulta GET /vehiculos/{id}/estado";

  paso("pasoApi", "ok", a.demo ? "Emitido por la DEMO del backend" : "Registrado por la API");
  if (a.fuente === FUENTE.WSS) paso("pasoWss", "ok", "Difundido por WSS", "recibido en este navegador");
  else paso("pasoWss", "no", "Difundido por WSS", "no observado: dato de GET /estado");
  paso("pasoFisico", "sin", "Ejecución física", "sin confirmación del ESP32");
}
// «hace …» se mantiene al día sin repintar todo.
setInterval(() => { if (ultimo.actual) $("ultHace").textContent = hace(ultimo.actual.ms); }, 10000);

function anunciarUltimo() {
  const t = $("tarjetaUltimo");
  t.classList.remove("recien");
  void t.offsetWidth;
  t.classList.add("recien");
  const a = ultimo.actual;
  $("ultAnuncio").textContent = `${a.demo ? "Paso de DEMO" : "Nuevo movimiento reportado"}: ${etiqueta(a.comando)}, ${horaDe(a.ms)}`;
}

/* ------------------------- 3. Últimos 10 movimientos ------------------------- */
const consulta = { enCurso: false, pendiente: false, timer: null, error: "" };

/** Agrupa avisos seguidos (p. ej. joystick) en UNA consulta y nunca hace dos a la vez. */
function programarHistorial(ms = CONFIG.tiempos.historialRetrasoMs) {
  clearTimeout(consulta.timer);
  consulta.timer = setTimeout(cargarHistorial, ms);
}

async function cargarHistorial() {
  if (consulta.enCurso) { consulta.pendiente = true; return; }
  consulta.enCurso = true;
  consulta.pendiente = false;
  $("btnHistorial").disabled = true;
  $("btnHistorial").setAttribute("aria-busy", "true");
  if (historial.cargado) pintarEstadoHist("Actualizando…", "medio");
  const n = historial.nuevaSolicitud();
  try {
    const h = await api.historial(V);
    const r = historial.aplicar(n, h.movimientos);
    consulta.error = "";
    if (r) pintarTabla(r.filas, r.nuevas);
  } catch (e) {
    consulta.error = e.message;
    if (!historial.cargado) pintarTablaMensaje("error", "No se pudo cargar el historial", e.message);
  } finally {
    consulta.enCurso = false;
    $("btnHistorial").disabled = false;
    $("btnHistorial").setAttribute("aria-busy", "false");
    pintarEstadoHist();
    if (consulta.pendiente) programarHistorial(0);
  }
}

function pintarEstadoHist(texto, tipo) {
  const p = $("histEstado");
  if (!texto) {
    const total = historial.filas.length;
    if (consulta.error && historial.cargado) { texto = `No se pudo actualizar: ${consulta.error.replace(/\.$/, "")}. Se muestran los datos anteriores.`; tipo = "mal"; }
    else if (consulta.error) { texto = "Error al cargar el historial."; tipo = "mal"; }
    else { texto = `${total} de 10 · consultado a las ${hora()}${wsAbierto ? " · se actualiza solo" : " · sin WSS: pulsa «Actualizar»"}`; tipo = "ok"; }
  }
  p.textContent = texto;
  p.dataset.tipo = tipo;
}

function pintarTablaMensaje(tipo, titulo, detalle = "") {
  const ic = tipo === "error" ? "i-x" : tipo === "cargando" ? "i-sync" : "i-list";
  const contenido = [icono(ic, tipo === "cargando" ? "ico gira" : "ico"), el("strong", { text: titulo })];
  if (detalle) contenido.push(el("small", { text: detalle }));
  if (tipo === "error") {
    contenido.push(el("button", { class: "btn btn-sm btn-outline-info", text: "Reintentar", attrs: { type: "button" }, on: { click: () => cargarHistorial() } }));
  }
  $("tablaMov").replaceChildren(el("tr", { class: `fila-msg fila-${tipo}` }, [
    el("td", { attrs: { colspan: 6 } }, [el("div", { class: "tabla-msg" }, contenido)]),
  ]));
}

function pintarTabla(filas, nuevas) {
  if (!filas.length) { pintarTablaMensaje("vacio", "Sin movimientos", "Este vehículo aún no tiene movimientos individuales guardados."); return; }
  $("tablaMov").replaceChildren(...filas.map((m, i) => {
    const iso = m.ms != null ? new Date(m.ms).toISOString() : null;
    const tr = el("tr", { class: nuevas.has(m.clave) ? "nueva" : "" }, [
      el("td", { class: "c-num", text: i + 1 }),
      el("th", { class: "c-mov", attrs: { scope: "row", title: m.comando || "" } }, [
        el("span", { class: "mov-nombre", text: etiqueta(m.comando) }),
        m.codigo != null ? el("span", { class: "mov-cod-movil", text: `#${m.codigo}`, attrs: { "aria-hidden": "true" } }) : "",
      ]),
      el("td", { class: "c-fecha" }, [m.ms != null ? el("time", { text: fecha(m.ms), attrs: { datetime: iso } }) : "—"]),
      el("td", { class: "c-hora" }, [m.ms != null ? el("time", { text: horaDe(m.ms), attrs: { datetime: iso } }) : "—"]),
      el("td", { class: "c-cod", text: m.codigo ?? "—" }),
      el("td", { class: "c-ori", text: (m.origen || "—").replace(/^WEB_/, "") }),
    ]);
    return tr;
  }));
}

/* ------------------------------ Eventos WSS ------------------------------ */
let pausado = false;
let filtro = "todos";
let totalEventos = 0;

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
  while (tb.children.length > MAX_EVENTOS) tb.lastChild.remove();
  $("eventosVacio").hidden = true;
}

ws.addEventListener("mensaje", (e) => {
  const ev = e.detail;                    // ya validado: evento conocido y del mismo vehículo
  if (ev.evento === "pong") return;
  totalEventos++;
  $("cntEventos").textContent = `${totalEventos} evento${totalEventos === 1 ? "" : "s"}`;
  demo.procesarEvento(ev);
  if (ultimo.desdeEvento(ev)) {
    if (ultimo.actual.demo) ultimo.actual.demo.nombre = demo.estado.nombre || "";    // se conserva aunque la DEMO termine
    pintarUltimo();
    anunciarUltimo();
  }
  // Solo los movimientos individuales se guardan en RDS: se reconcilia la tabla con el historial confirmado.
  if (ev.evento === "movimiento_individual" && ev.datos.registrado_en_historial !== false) programarHistorial();
  if (!pausado) agregarFila(ev);
});

ws.addEventListener("estado", (e) => {
  const antes = wsAbierto;
  wsAbierto = e.detail.estado === WS.ABIERTO;
  if (wsAbierto && !antes) {
    // Conexión nueva o recuperada: lo que pasó mientras tanto se recupera por REST.
    cargarEstado();
    programarHistorial(0);
    demo.sincronizar().catch(() => {});
  }
  pintarUltimo();
  if (!consulta.enCurso && historial.cargado) pintarEstadoHist();
});

$("selFiltro").addEventListener("change", (e) => {
  filtro = e.target.value;
  for (const tr of $("tablaEventos").children) tr.hidden = filtro !== "todos" && filtro !== tr.dataset.grupo;
});
$("btnPausa").addEventListener("click", (e) => {
  pausado = !pausado;
  e.currentTarget.setAttribute("aria-pressed", String(pausado));
  e.currentTarget.querySelector("span").textContent = pausado ? "Reanudar" : "Pausar";
});
$("btnLimpiar").addEventListener("click", () => { $("tablaEventos").replaceChildren(); $("eventosVacio").hidden = false; });
$("btnHistorial").addEventListener("click", () => cargarHistorial());
$("wsUrl").textContent = CONFIG.wsUrl(V);

(async function iniciar() {
  inicializarClave();
  pintarUltimo();
  pintarTablaMensaje("cargando", "Cargando historial…");
  ws.conectar();
  await Promise.all([cargarVehiculo(), cargarEstado(), cargarHistorial(), demo.sincronizar().catch(() => {})]);
})();
