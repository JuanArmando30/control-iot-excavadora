/**
 * Página de CONTROL: tres modos de manejo (Pulso, Joystick, Voz), botones
 * del catálogo, DETENER, DEMO y panel de conectividad.
 * Aquí solo se conectan eventos de la vista con los servicios de dominio.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { claveStore } from "../core/clave-store.js";
import { WS } from "../core/ws-client.js";
import { Catalogo } from "../domain/catalogo.js";
import { ComandoService, FASE } from "../domain/comando-service.js";
import { DemoService } from "../domain/demo-service.js";
import { interpretar, FRASES_EJEMPLO } from "../domain/interprete-voz.js";
import { Botonera } from "../ui/botonera.js";
import { Joystick } from "../ui/joystick.js";
import { DemoPanel } from "../ui/demo-panel.js";
import { ControlVoz, vozSoportada } from "../ui/voz.js";
import { abrirDialogoClave, inicializarClave } from "../ui/clave-dialog.js";
import { $, el, hora, registrar, toast, vibrar } from "../ui/dom.js";
import { iniciarConectividad, pintarVehiculo, textoEvento } from "./comun.js";

const V = CONFIG.vehiculoId;
const O = CONFIG.origen;
const MODOS = ["pulso", "joystick", "voz"];
const AYUDA = {
  pulso: "Pulso: cada toque envía una orden; el vehículo la ejecuta un instante y se detiene solo.",
  joystick: "Joystick: arrastra la perilla; solo se envía una orden al cambiar de dirección. Al soltar vuelve al centro y se envía DETENER.",
  voz: "Voz: cada frase es una orden. Di «alto» para detener al instante.",
};

/* ------------------------------ Estado ------------------------------ */
let catalogo = new Catalogo();
let wsAbierto = false;
let modo = leerModo();
const mantener = { dir: null, timer: null };

const demo = new DemoService({ api, vehiculoId: V });
const comandos = new ComandoService({
  api, vehiculoId: V, obtenerCatalogo: () => catalogo, demoActiva: () => demo.activa,
});
const { ws } = iniciarConectividad({ compacto: true });
const lista = $("listaMensajes");
const log = (etq, txt) => registrar(lista, etq, txt);

/* ------------------------------ Vista ------------------------------- */
const botonera = new Botonera({
  cruceta: $("cruceta"),
  secundarios: $("secundarios"),
  onPulsar: (codigo, origenUi) => enviar(codigo, origenUi === "cruceta" ? O.pulso : O.boton),
  onDetener: () => detenerTodo(O.pulso),
});
const joystick = new Joystick($("joystick"), $("joyPerilla"), { onDireccion: alCambiarDireccion });
const demoPanel = new DemoPanel({ select: $("selDemo"), barra: $("barDemo"), barraPaso: $("barPaso"), texto: $("txtDemo") });

/* ------------------------- Envío de comandos ------------------------ */
function puedeMover() {
  return catalogo.cargado && !!claveStore.obtener() && !demo.activa && wsAbierto;
}

async function enviar(codigo, origen) {
  if (!puedeMover()) { explicarBloqueo(); return null; }
  const r = await comandos.enviar(codigo, origen);
  if (r.ok && r.estado === "aceptado") {
    const m = r.respuesta;
    log("API", `${m.comando} (#${m.codigo}) registrado · ${m.clientes_notificados} cliente(s) WSS notificados`);
  } else if (!r.ok && r.estado === "rechazado") {
    toast(r.mensaje, "error");
  }
  return r;
}

function detenerMovimiento(origen) {
  return comandos.detener(origen);
}

/** DETENER global: cancela la DEMO si corre; si no, envía DETENER. */
async function detenerTodo(origen = O.boton) {
  vibrar(40);
  clearInterval(mantener.timer);
  mantener.timer = null;
  mantener.dir = null;            // evita que soltar el joystick envíe un segundo DETENER
  joystick.soltar();
  if (!claveStore.obtener()) { abrirDialogoClave({ motivo: "Escribe la clave para poder enviar DETENER." }); return; }
  if (demo.activa) {
    try {
      await demo.cancelar();
      log("DEMO", "Cancelación aceptada por la API");
      return;
    } catch (e) {
      if (e.status !== 409) { toast(e.message, "error"); log("Error", e.message); }
    }
  }
  await detenerMovimiento(origen);
}

comandos.addEventListener("fase", (e) => {
  botonera.aplicarFase(e.detail);
  if (e.detail.codigo === catalogo.detener?.codigo) pintarStop(e.detail.fase);
});
comandos.addEventListener("paro", (e) => {
  if (e.detail.ok) log("API", "DETENER registrado (no confirma ejecución física)");
  else { toast("DETENER falló: " + e.detail.mensaje, "error"); log("Error", "DETENER: " + e.detail.mensaje); }
});
comandos.addEventListener("fallo", (e) => {
  const err = e.detail.error;
  log("Error", err.message);
  if (err.status === 401) { claveStore.olvidar(); abrirDialogoClave({ motivo: err.message }); }
  else if (err.status === 409) demo.sincronizar().catch(() => {});
  else toast(err.message, "error");
});

function pintarStop(fase) {
  const b = $("btnStop");
  b.classList.toggle("is-sending", fase === FASE.ENVIANDO);
  b.classList.toggle("is-ok", fase === FASE.ACEPTADO);
  b.classList.toggle("is-error", fase === FASE.ERROR);
  $("stopEstado").textContent = { enviando: "Enviando…", aceptado: "Registrado", error: "Error" }[fase] || "";
  if (fase === FASE.ACEPTADO || fase === FASE.ERROR) {
    clearTimeout(pintarStop.t);
    pintarStop.t = setTimeout(() => pintarStop(""), 1500);
  }
}

/* ------------------------------ Joystick ---------------------------- */
function alCambiarDireccion(dir) {
  clearInterval(mantener.timer);
  mantener.timer = null;
  const cmd = dir ? catalogo.direccion(dir) : null;
  $("joyEstado").textContent = cmd ? `→ ${Catalogo.etiqueta(cmd)}` : "Neutral";

  if (!cmd) {
    if (mantener.dir) {                 // volvió al centro, se soltó o se perdió el puntero
      mantener.dir = null;
      detenerMovimiento(O.joystick);
    }
    actualizarControles();
    return;
  }
  mantener.dir = dir;
  vibrar(10);
  enviar(cmd.codigo, O.joystick);
  if (CONFIG.tiempos.mantenerMs > 0) {
    mantener.timer = setInterval(() => {
      if (mantener.dir === dir && puedeMover()) comandos.enviar(cmd.codigo, O.joystick);
    }, CONFIG.tiempos.mantenerMs);
  }
  actualizarControles();
}

/* ------------------------------- Voz -------------------------------- */
const voz = new ControlVoz({
  onFrase: (txt) => ejecutarFrase(txt),
  onParoInmediato: () => { pintarVoz("ALTO → DETENER", "ok"); log("Voz", "alto"); detenerTodo(O.voz); },
  onEstado: (txt) => { $("vozEstado").textContent = txt; },
  onTexto: (txt, final) => { const p = $("vozTexto"); p.textContent = txt; p.classList.toggle("interino", !final); },
  onCambio: (on) => {
    const b = $("btnMic");
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
    $("txtMic").textContent = on ? "Escuchando…" : "Toca y habla";
  },
});

function pintarVoz(texto, tipo = "") {
  const r = $("vozResultado");
  r.textContent = texto;
  r.className = "voz-res " + tipo;
}

async function ejecutarFrase(texto) {
  const i = interpretar(texto);
  if (!i) { pintarVoz(`No entendí: «${texto}»`, "no"); return; }
  if (i.tipo === "stop" || i.tipo === "cancelar") { pintarVoz("DETENER", "ok"); await detenerTodo(O.voz); return; }
  if (i.tipo === "demo") {
    pintarVoz("Iniciar DEMO seleccionada", "ok");
    await iniciarDemo();
    return;
  }
  const cmd = catalogo.porCodigo(i.codigo);
  if (!cmd || !cmd.activo) { pintarVoz("Esa orden no está en el catálogo del vehículo.", "no"); return; }
  if (!puedeMover()) { pintarVoz("Control bloqueado: " + motivoBloqueo(), "no"); return; }
  pintarVoz(`${Catalogo.etiqueta(cmd)} · enviando…`, "ok");
  const r = await enviar(cmd.codigo, O.voz);
  if (r?.ok) pintarVoz(`${Catalogo.etiqueta(cmd)} · registrado por la API ✓`, "ok");
  else if (r) pintarVoz(`${Catalogo.etiqueta(cmd)} · no se pudo enviar`, "no");
}

$("btnMic").addEventListener("click", () => {
  if (!claveStore.obtener()) { abrirDialogoClave(); return; }
  voz.alternar();
});
$("chkManosLibres").addEventListener("change", (e) => { voz.manosLibres = e.target.checked; });
$("formOrden").addEventListener("submit", (e) => {
  e.preventDefault();
  const t = $("txtOrden").value.trim().slice(0, 120);
  if (!t) return;
  $("txtOrden").value = "";
  $("vozTexto").textContent = t;
  ejecutarFrase(t);
});
$("chipsVoz").replaceChildren(...FRASES_EJEMPLO.map((f) =>
  el("button", { class: "chip", text: f, attrs: { type: "button" }, on: { click: () => { $("vozTexto").textContent = f; ejecutarFrase(f); } } })));
if (!vozSoportada()) {
  $("vozEstado").textContent = "Este navegador no tiene reconocimiento de voz. Escribe la orden o dicta con el teclado del teléfono.";
}

/* ------------------------------- DEMO ------------------------------- */
async function iniciarDemo() {
  const id = demoPanel.seleccion;
  if (!id) { toast("Selecciona una DEMO.", "error"); return; }
  if (!claveStore.obtener()) { abrirDialogoClave(); return; }
  if (!wsAbierto) { toast("Espera a que la sesión WSS esté en línea para ver el avance.", "error"); return; }
  try {
    const r = await demo.iniciar(id);
    log("DEMO", `«${r.nombre}» aceptada (202) · ${r.total_movimientos} movimientos · ${r.clientes_websocket} cliente(s) WSS`);
  } catch (e) {
    toast(e.message, "error");
    if (e.status === 401) abrirDialogoClave({ motivo: e.message });
  }
}

$("btnDemoIniciar").addEventListener("click", iniciarDemo);
$("btnDemoCancelar").addEventListener("click", () => detenerTodo(O.boton));
$("selDemo").addEventListener("change", actualizarControles);

demo.addEventListener("cambio", (e) => {
  demoPanel.pintar(e.detail);
  actualizarControles();
});

/* ---------------------------- WebSocket ----------------------------- */
ws.addEventListener("estado", (e) => {
  const antes = wsAbierto;
  wsAbierto = e.detail.estado === WS.ABIERTO;
  if (wsAbierto && !antes) {
    log("WSS", "En línea · " + e.detail.detalle);
    demo.sincronizar().catch(() => {});     // recupera eventos perdidos durante el corte
  } else if (!wsAbierto && antes) {
    log("WSS", "Sesión perdida · " + (e.detail.detalle || ""));
  }
  actualizarControles();
});
ws.addEventListener("registro", (e) => log("WSS", e.detail));
ws.addEventListener("mensaje", (e) => {
  const ev = e.detail;
  if (ev.evento === "pong") return;
  const deDemo = demo.procesarEvento(ev);
  if (ev.comando && ["estado_inicial", "estado_actualizado", "movimiento_individual", "demo_movimiento", "demo_cancelada"].includes(ev.evento)) {
    pintarEstado(ev);
    if (ev.evento === "movimiento_individual" || ev.evento === "demo_movimiento") botonera.marcarActivo(ev.codigo);
  }
  if (ev.evento === "error" && !deDemo) toast(ev.datos.detalle || "La API informó un error.", "error");
  log(deDemo ? "DEMO" : "WSS", textoEvento(ev));
});

const ETQ_EVENTO = {
  estado_inicial: "Estado inicial (RDS)",
  estado_actualizado: "Estado actualizado",
  movimiento_individual: "Movimiento individual",
  demo_movimiento: "Movimiento de DEMO",
  demo_cancelada: "DEMO cancelada",
};
function pintarEstado(ev) {
  $("estComando").textContent = ev.comando || "—";
  $("estCodigo").textContent = ev.codigo ?? "—";
  $("estHora").textContent = hora(ev.timestamp);
  $("estFuente").textContent = ETQ_EVENTO[ev.evento] || ev.evento;
}

/* ---------------------------- Controles ----------------------------- */
function motivoBloqueo() {
  if (!claveStore.obtener()) return "falta la clave de operador.";
  if (!catalogo.cargado) return "el catálogo de comandos no se pudo cargar.";
  if (demo.activa) return "hay una DEMO en ejecución.";
  if (!wsAbierto) return "la sesión WSS no está en línea.";
  return "";
}

function explicarBloqueo() {
  const m = motivoBloqueo();
  if (!claveStore.obtener()) abrirDialogoClave({ motivo: "Escribe la clave de operador para controlar el vehículo." });
  else if (m) toast("Control bloqueado: " + m, "error");
}

function actualizarControles() {
  const listo = puedeMover();
  const tieneClave = !!claveStore.obtener();
  const disponibles = new Set(["arriba", "abajo", "izquierda", "derecha"].filter((d) => catalogo.direccion(d)));

  // Si el control se bloquea con una dirección mantenida por teclado, se suelta y se detiene.
  if (!listo && mantener.dir && !joystick.activo) {
    clearInterval(mantener.timer);
    mantener.timer = null;
    mantener.dir = null;
    $("joyEstado").textContent = "Neutral";
    if (!demo.activa && tieneClave) detenerMovimiento(O.joystick);
  }

  botonera.setHabilitado(listo, { bloquearSecundarios: !!mantener.dir });
  joystick.configurar(listo, disponibles);
  $("btnMic").disabled = !tieneClave || !vozSoportada();   // «alto» por voz funciona también durante una DEMO
  $("txtOrden").disabled = !tieneClave;
  $("btnOrden").disabled = !tieneClave;

  const est = demo.estado;
  $("btnDemoIniciar").disabled = !(tieneClave && wsAbierto && !est.activa && !demo.solicitando && demoPanel.seleccion);
  $("btnDemoCancelar").disabled = !(tieneClave && est.activa && !demo.solicitando);
  $("btnDemoIniciar").setAttribute("aria-busy", String(demo.solicitando));

  const aviso = $("aviso");
  let texto = "", tipo = "info";
  if (!tieneClave) texto = "Falta la clave de operador. Pulsa «Sin clave» en la parte superior.";
  else if (!catalogo.cargado) { texto = "No se pudo cargar el catálogo de comandos. Revisa el panel de conectividad."; tipo = "error"; }
  else if (est.activa) texto = "DEMO en ejecución: los controles están bloqueados. DETENER la cancela.";
  else if (!wsAbierto) { texto = "Sin sesión WSS: el movimiento está bloqueado hasta reconectar. DETENER sigue disponible."; tipo = "error"; }
  aviso.textContent = texto;
  aviso.className = `aviso aviso-${tipo}`;
  aviso.hidden = !texto;
}

/* ---------------------------- Modos --------------------------------- */
function leerModo() {
  try { const m = localStorage.getItem("vehiculoIot.modo"); return MODOS.includes(m) ? m : "pulso"; } catch { return "pulso"; }
}

function setModo(nuevo) {
  if (!MODOS.includes(nuevo)) nuevo = "pulso";
  if (modo === "voz" && nuevo !== "voz") voz.detener();
  joystick.soltar();
  modo = nuevo;
  try { localStorage.setItem("vehiculoIot.modo", nuevo); } catch { /* */ }
  for (const b of document.querySelectorAll("[data-modo]")) {
    const on = b.dataset.modo === nuevo;
    b.setAttribute("aria-selected", String(on));
    b.tabIndex = on ? 0 : -1;
  }
  $("vistaPulso").hidden = nuevo !== "pulso";
  $("vistaJoystick").hidden = nuevo !== "joystick";
  $("vistaVoz").hidden = nuevo !== "voz";
  $("ayudaModo").textContent = AYUDA[nuevo];
  actualizarControles();
}

const tabs = [...document.querySelectorAll("[data-modo]")];
tabs.forEach((b, i) => {
  b.addEventListener("click", () => setModo(b.dataset.modo));
  b.addEventListener("keydown", (e) => {
    const paso = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!paso) return;
    e.preventDefault();
    const sig = tabs[(i + paso + tabs.length) % tabs.length];
    sig.focus();
    setModo(sig.dataset.modo);
  });
});

/* ------------------------- Teclado y seguridad ---------------------- */
const TECLAS_DIR = { arrowup: "arriba", w: "arriba", arrowdown: "abajo", s: "abajo", arrowleft: "izquierda", a: "izquierda", arrowright: "derecha", d: "derecha" };
const presionadas = new Set();

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal.show")) return;
  const t = e.target;
  if (t.closest?.("input,select,textarea,[role=tab],#joystick") || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape" || (k === " " && !t.closest?.("button,a"))) {
    e.preventDefault();
    detenerTodo(O.teclado);
    return;
  }
  const dir = TECLAS_DIR[k];
  if (!dir || e.repeat || presionadas.has(k)) return;
  if (t.closest?.("button,a") && k.startsWith("arrow")) return;
  e.preventDefault();
  presionadas.add(k);
  const cmd = catalogo.direccion(dir);
  if (!cmd) return;
  if (modo === "joystick") { if (puedeMover()) alCambiarDireccion(dir); }
  else enviar(cmd.codigo, O.teclado);
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (!presionadas.delete(k)) return;
  if (modo === "joystick" && mantener.dir === TECLAS_DIR[k]) alCambiarDireccion(null);
});
window.addEventListener("blur", () => {
  presionadas.clear();
  if (mantener.dir && !joystick.activo) alCambiarDireccion(null);
});

const btnStop = $("btnStop");
btnStop.addEventListener("pointerdown", (e) => { e.preventDefault(); detenerTodo(O.boton); });
btnStop.addEventListener("click", (e) => { if (e.detail === 0) detenerTodo(O.boton); });

claveStore.alCambiar(actualizarControles);
window.addEventListener("unhandledrejection", (e) => {
  e.preventDefault();
  toast("Error inesperado: " + (e.reason?.message || "sin detalle"), "error");
});

/* ------------------------------ Arranque ---------------------------- */
async function cargarCatalogo() {
  try {
    catalogo = new Catalogo(await api.comandos(V));
    if (!catalogo.detener) toast("El catálogo no tiene un comando DETENER activo.", "error");
  } catch (e) {
    catalogo = new Catalogo();
    log("Error", "Catálogo: " + e.message);
  }
  botonera.render(catalogo);
  actualizarControles();
}

async function cargarDemos() {
  try {
    demoPanel.pintarLista(await demo.cargar());
    await demo.sincronizar();
  } catch (e) {
    demoPanel.pintarLista([]);
    log("Error", "DEMO: " + e.message);
  }
  actualizarControles();
}

(async function iniciar() {
  setModo(modo);
  botonera.render(catalogo);
  await inicializarClave();
  await Promise.all([pintarVehiculo(), cargarCatalogo(), cargarDemos()]);
  ws.conectar();
  if (!claveStore.obtener()) abrirDialogoClave({ motivo: "Para mover el vehículo necesitas la clave de operador." });
})();
