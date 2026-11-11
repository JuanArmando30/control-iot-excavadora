/**
 * Página de CONTROL: mando horizontal con dos controles (conducción a la
 * izquierda, brazo y pala a la derecha), bloque central (luz, sonido,
 * encendido y DETENER), tres modos de manejo (Pulso, Joystick, Voz) y panel
 * de conectividad, todo en una sola pantalla.
 * Estado, DEMO y mensajes están en Monitoreo. La DEMO se sigue vigilando
 * aquí para bloquear el mando mientras corre y para que DETENER la cancele.
 */
import { CONFIG } from "../config.js";
import { api } from "../api/vehiculo-api.js";
import { claveStore } from "../core/clave-store.js";
import { WS } from "../core/ws-client.js";
import { Catalogo, DIRECCIONES } from "../domain/catalogo.js";
import { ComandoService, FASE } from "../domain/comando-service.js";
import { DemoService } from "../domain/demo-service.js";
import { demoPreferida } from "../domain/demo-preferida.js";
import { interpretar, FRASES_EJEMPLO } from "../domain/interprete-voz.js";
import { Botonera } from "../ui/botonera.js";
import { Joystick } from "../ui/joystick.js";
import { ControlVoz, vozSoportada } from "../ui/voz.js";
import { Giroscopio } from "../ui/giroscopio.js";
import { abrirDialogoClave, inicializarClave } from "../ui/clave-dialog.js";
import { $, el, toast, vibrar, avisoEstado } from "../ui/dom.js";
import { abrirModal } from "../ui/modales.js";
import { iniciarConectividad, pintarVehiculo } from "./comun.js";

const V = CONFIG.vehiculoId;
const O = CONFIG.origen;
const MODOS = ["pulso", "joystick", "voz", "giro"];
const AYUDA = {
  pulso: "Pulso: cada toque envía una orden. Izquierda: conducción · derecha: brazo y pala.",
  joystick: "Joystick: arrastra una perilla (una a la vez); al soltar vuelve al centro y se envía DETENER.",
  voz: "Voz: habla con naturalidad; puedes encadenar órdenes con «y luego». Di «alto» para detener al instante.",
  giro: "Giroscopio: inclina el teléfono para conducir; el brazo, la pala y los accesorios van con botones (con el teléfono nivelado).",
};
const NOMBRE_MANDO = { conduccion: "Conducción", brazo: "Brazo y pala" };
const espera = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------ Estado ------------------------------ */
let catalogo = new Catalogo();
let wsAbierto = false;
let modo = leerModo();
/** Dirección sostenida (Joystick o Giroscopio). Solo un mando a la vez (una orden en vuelo). */
const mantener = { mando: null, dir: null, timer: null, origen: O.joystick };

const demo = new DemoService({ api, vehiculoId: V });
const comandos = new ComandoService({
  api, vehiculoId: V, obtenerCatalogo: () => catalogo, demoActiva: () => demo.activa, wsActivo: () => wsAbierto,
});
const { ws } = iniciarConectividad({ barra: true });
/** Una sola línea de retroalimentación (sustituye a la lista de mensajes). */
const log = (etq, txt) => {
  const p = $("lineaEstado");
  p.textContent = `${etq} · ${txt}`;
  p.dataset.tipo = etq === "Error" ? "error" : "";
};

/* ------------------------------ Vista ------------------------------- */
const mandoEl = $("mando");
const botonera = new Botonera({
  crucetas: { conduccion: $("cruceta"), brazo: $("crucetaBrazo"), brazoGiro: $("botonesGiro") },
  secundarios: $("secundarios"),
  onPulsar: (codigo, origenUi) => enviar(codigo, origenUi === "cruceta" ? O.pulso : O.boton),
});
const joysticks = {
  conduccion: new Joystick($("joystick"), $("joyPerilla"), { onDireccion: (d) => alCambiarDireccion("conduccion", d) }),
  brazo: new Joystick($("joystickBrazo"), $("joyPerillaBrazo"), { onDireccion: (d) => alCambiarDireccion("brazo", d) }),
};
const algunJoystickActivo = () => Object.values(joysticks).some((j) => j.activo);

const giroscopio = new Giroscopio($("nivel"), {
  onDireccion: (d) => alCambiarDireccion("conduccion", d, O.giroscopio),
  onEstado: (txt, tipo = "") => { const p = $("giroEstado"); p.textContent = txt; p.dataset.tipo = tipo; },
  onCambio: (on) => {
    const b = $("btnGiro");
    b.setAttribute("aria-pressed", String(on));
    b.querySelector("use").setAttribute("href", `assets/icons/sprite.svg#${on ? "i-pause" : "i-play"}`);
    b.querySelector("span").textContent = on ? "Pausar" : "Activar";
    $("btnCentrar").disabled = !on;
  },
});
$("btnGiro").addEventListener("click", () => {
  if (giroscopio.activo) { giroscopio.pausar(); return; }
  if (!puedeMover()) { explicarBloqueo(); return; }
  giroscopio.activar();               // primera llamada dentro del toque: iOS exige gesto del usuario
});
$("btnCentrar").addEventListener("click", () => giroscopio.centrar());

function soltarMantenido() {
  clearInterval(mantener.timer);
  mantener.timer = null;
  mantener.dir = null;
  mantener.mando = null;
}

/* ------------------------- Envío de comandos ------------------------ */
function puedeMover() {
  return catalogo.cargado && !!claveStore.obtener() && !demo.activa && wsAbierto;
}

async function enviar(codigo, origen) {
  if (!puedeMover()) { explicarBloqueo(); return null; }
  const r = await comandos.enviar(codigo, origen);
  if (r.ok && r.estado === "aceptado") {
    const m = r.respuesta;
    log(m.comando, `registrado por la API · ${m.clientes_notificados} cliente(s) WSS`);
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
  soltarMantenido();              // evita que soltar el joystick envíe un segundo DETENER
  cancelarSecuenciaVoz("cancelada con DETENER");
  for (const j of Object.values(joysticks)) j.soltar();
  giroscopio.pausar("Pausado por DETENER. Toca «Activar» para seguir.");
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
  if (e.detail.ok) log("DETENER", "registrado por la API (no confirma ejecución física)");
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
function alCambiarDireccion(mando, dir, origen = O.joystick) {
  if (mantener.mando && mantener.mando !== mando) return;    // el otro mando tiene el control
  clearInterval(mantener.timer);
  mantener.timer = null;
  const cmd = dir ? catalogo.direccion(dir, mando) : null;
  if (modo === "joystick" || modo === "giro") log(NOMBRE_MANDO[mando], cmd ? Catalogo.etiqueta(cmd) : "neutral");

  if (!cmd) {
    if (mantener.dir) {                 // volvió al centro, se soltó, se niveló o se perdió el sensor
      const o = mantener.origen;
      soltarMantenido();
      detenerMovimiento(o);
    }
    actualizarControles();
    return;
  }
  mantener.mando = mando;
  mantener.dir = dir;
  mantener.origen = origen;
  vibrar(10);
  enviar(cmd.codigo, origen);
  if (CONFIG.tiempos.mantenerMs > 0) {
    mantener.timer = setInterval(() => {
      if (mantener.mando === mando && mantener.dir === dir && puedeMover()) comandos.enviar(cmd.codigo, origen);
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
    $("txtMic").textContent = on ? "Escuchando… habla ahora" : "Toca el micrófono y habla";
  },
});

function pintarVoz(texto, tipo = "") {
  const r = $("vozResultado");
  r.textContent = texto;
  r.className = "voz-res " + tipo;
}

/** Secuencia de voz en curso: cambiar `id` la cancela (DETENER, otra frase o cambio de modo). */
const vozSecuencia = { id: 0, ultima: [], plan: "" };

/** Corta la secuencia de voz en curso (si hay) y lo dice en pantalla. */
function cancelarSecuenciaVoz(motivo) {
  if (vozSecuencia.plan) pintarVoz(`${vozSecuencia.plan} · ${motivo}.`, "no");
  vozSecuencia.plan = "";
  vozSecuencia.id++;
}
const nombreCodigo = (c) => Catalogo.etiqueta(catalogo.porCodigo(c));

/**
 * @param {string|string[]} entrada frase escrita o alternativas del reconocedor.
 * Se usa la primera alternativa que se entienda; "alto" en cualquiera gana.
 */
async function ejecutarFrase(entrada) {
  const opciones = [].concat(entrada).map((t) => String(t).trim()).filter(Boolean);
  if (!opciones.length) return;
  const lecturas = opciones.map((t) => ({ texto: t, i: interpretar(t) }));
  const paro = lecturas.find((l) => l.i && (l.i.tipo === "stop" || l.i.tipo === "cancelar"));
  const util = paro || lecturas.find((l) => l.i && (l.i.tipo !== "secuencia" || l.i.pasos.length)) || lecturas[0];
  const { texto, i } = util;
  if (util !== lecturas[0]) $("vozTexto").textContent = texto;     // muestra la alternativa que se usó

  if (!i) { pintarVoz(`No entendí «${texto}». Prueba: «avanza», «sube el brazo», «prende la luz».`, "no"); return; }
  if (i.tipo === "stop" || i.tipo === "cancelar") { pintarVoz("DETENER", "ok"); await detenerTodo(O.voz); return; }
  if (i.tipo === "demo") {
    const d = demoElegida();
    if (!d) { pintarVoz("No hay DEMO activas: créalas en Administración.", "no"); return; }
    if (demo.activa) { pintarVoz("Ya hay una DEMO en ejecución. Di «alto» para cancelarla.", "no"); return; }
    if (!puedeMover()) { pintarVoz("Control bloqueado: " + motivoBloqueo(), "no"); return; }
    pintarVoz(`Iniciando DEMO «${d.nombre}»…`, "ok");
    await iniciarDemoElegida(d);
    return;
  }

  let pasos = i.pasos || [];
  if (i.tipo === "repetir") {
    if (!vozSecuencia.ultima.length) { pintarVoz("No hay una orden anterior para repetir.", "no"); return; }
    pasos = vozSecuencia.ultima;
  }
  if (!pasos.length) {
    const negada = i.partes?.some((p) => p.negada);
    pintarVoz(negada ? "Entendido: no hago nada." : `No entendí «${texto}». Prueba: «gira a la izquierda» o «baja la pala».`, negada ? "ok" : "no");
    return;
  }

  // Valida todo contra el catálogo antes de mover nada.
  const faltan = pasos.filter((c) => !catalogo.esActivo(c));
  if (faltan.length) { pintarVoz(`No disponible en el catálogo: ${[...new Set(faltan)].map(nombreCodigo).join(", ")}.`, "no"); return; }
  if (!puedeMover()) { pintarVoz("Control bloqueado: " + motivoBloqueo(), "no"); return; }

  const ignorado = i.partes?.filter((p) => p.codigo == null && !p.negada).map((p) => `«${p.texto}»`) || [];
  const plan = pasos.map(nombreCodigo).join(" → ");
  const nota = ignorado.length ? ` (no entendí ${ignorado.join(", ")})` : "";
  vozSecuencia.ultima = pasos;
  await ejecutarSecuencia(pasos, plan, nota);
}

async function ejecutarSecuencia(pasos, plan, nota) {
  const id = ++vozSecuencia.id;
  vozSecuencia.plan = plan;
  for (let k = 0; k < pasos.length; k++) {
    if (id !== vozSecuencia.id) return;                                // cancelada
    if (!puedeMover()) { vozSecuencia.plan = ""; pintarVoz(`${plan} · detenido: ${motivoBloqueo()}`, "no"); return; }
    const avance = pasos.length > 1 ? ` (${k + 1}/${pasos.length})` : "";
    pintarVoz(`${plan}${avance} · enviando ${nombreCodigo(pasos[k])}…${nota}`, "ok");
    const r = await enviar(pasos[k], O.voz);
    if (id !== vozSecuencia.id) return;
    if (!r?.ok) { vozSecuencia.plan = ""; pintarVoz(`${plan} · no se pudo enviar ${nombreCodigo(pasos[k])}.`, "no"); return; }
    if (k < pasos.length - 1) await espera(CONFIG.voz.pasoMs);
  }
  if (id !== vozSecuencia.id) return;
  vozSecuencia.plan = "";
  pintarVoz(`${plan} · registrado por la API ✓${nota}`, "ok");
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
/* Botón «Demo» (fila central, visible en todos los modos). Abre un panel para
   elegir la DEMO e iniciarla (el panel es la confirmación). Mientras corre
   muestra el avance y tocarlo la cancela (igual que DETENER). Crear o editar
   DEMO se hace en Administración (enlace desde el panel). */
const btnDemo = $("btnDemo");

const demoElegida = () => demoPreferida.resolver(V, demo.demos);

async function cargarDemos() {
  try { await demo.cargar(); } catch (e) { log("Error", "DEMO: " + e.message); }
  pintarBotonDemo();
}

function pintarBotonDemo() {
  const e = demo.estado;
  const tieneClave = !!claveStore.obtener();
  btnDemo.classList.toggle("is-demo", e.activa);
  btnDemo.style.setProperty("--avance", e.activa && e.total ? `${Math.round((e.orden / e.total) * 100)}%` : "0%");
  btnDemo.querySelector("use").setAttribute("href", `assets/icons/sprite.svg#${e.activa ? "i-stop" : "i-play"}`);
  btnDemo.querySelector(".cbtn-txt").textContent = e.activa ? (e.total ? `Demo ${e.orden}/${e.total}` : "Demo…") : "Demo";
  const titulo = e.activa ? `DEMO «${e.nombre || "en curso"}» en ejecución. Toca para cancelarla.` : "Elegir e iniciar una DEMO";
  btnDemo.title = titulo;
  btnDemo.setAttribute("aria-label", titulo);
  btnDemo.setAttribute("aria-haspopup", e.activa ? "false" : "dialog");
  btnDemo.disabled = demo.solicitando
    || (e.activa ? !tieneClave : !(tieneClave && wsAbierto && catalogo.cargado && !mantener.dir));
}

async function iniciarDemoElegida(d) {
  // Nada más debe estar moviendo el carrito cuando arranca la DEMO.
  for (const j of Object.values(joysticks)) j.soltar();
  giroscopio.pausar("Pausado: DEMO en ejecución.");
  cancelarSecuenciaVoz("cancelada: inicia una DEMO");
  try {
    const r = await demo.iniciar(d.id_demo);
    demoPreferida.guardar(V, d.id_demo);                     // la próxima vez aparece preseleccionada
    log("DEMO", `«${r.nombre}» aceptada · ${r.total_movimientos} movimientos`);
    toast(`DEMO «${r.nombre}» en ejecución. DETENER la cancela.`, "ok");
    return true;
  } catch (e) {
    log("Error", "DEMO: " + e.message);
    if (e.status === 401) { claveStore.olvidar(); abrirDialogoClave({ motivo: e.message }); }
    else toast("DEMO: " + e.message, "error");
    return false;
  } finally {
    pintarBotonDemo();
  }
}

/** Panel para elegir la DEMO (radio) e iniciarla; enlace a Administración para crear o editar. */
function abrirPanelDemo() {
  const demos = demo.demos;
  const elegida = demoElegida();
  const crear = { texto: demos.length ? "Crear o editar" : "Crear DEMO", clase: "btn-outline-light me-auto",
    alPulsar: () => { location.href = "administracion.html#demo"; } };
  if (!demos.length) {
    abrirModal({
      titulo: "DEMO",
      cuerpo: [el("p", { class: "mb-0", text: "No hay DEMO activas para este vehículo. Créalas (y agrega sus pasos) en Administración." })],
      acciones: [crear, { texto: "Cerrar", clase: "btn-outline-secondary" }],
    });
    return;
  }
  const pasos = new Map();
  const opciones = demos.map((d) => {
    const txtPasos = el("small", { class: "demo-pasos", text: "Consultando pasos…" });
    pasos.set(d.id_demo, txtPasos);
    return el("label", { class: "demo-opcion" }, [
      el("input", { attrs: { type: "radio", name: "demo", value: d.id_demo, checked: d.id_demo === elegida?.id_demo, required: true } }),
      el("span", { class: "demo-opcion-txt" }, [
        el("strong", { text: d.nombre }),
        el("small", { text: d.descripcion || "Sin descripción" }),
        txtPasos,
      ]),
    ]);
  });
  abrirModal({
    titulo: "Elegir DEMO",
    cuerpo: [
      el("p", { class: "small text-secondary-emphasis", text: "La DEMO mueve la excavadora sola, paso a paso. DETENER la cancela en cualquier momento." }),
      el("div", { class: "demo-lista", attrs: { role: "radiogroup", "aria-label": "DEMO disponibles" } }, opciones),
    ],
    acciones: [
      crear,
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      {
        texto: "Iniciar DEMO", clase: "btn-primary", tipo: "submit",
        alPulsar: async ({ form }) => {
          const d = demos.find((x) => x.id_demo === Number(form.elements.demo.value));
          if (!d) throw new Error("Elige una DEMO.");
          if (!puedeMover()) throw new Error("Control bloqueado: " + motivoBloqueo());
          if (!(await iniciarDemoElegida(d))) throw new Error("No se pudo iniciar la DEMO.");
        },
      },
    ],
    alAbrir: () => {
      // Número de pasos y duración aproximada de cada DEMO (consulta sin clave).
      for (const d of demos) {
        api.movimientosDemo(V, d.id_demo).then((m) => {
          const seg = m.reduce((t, x) => t + x.duracion_ms + x.pausa_ms, 0) / 1000;
          const n = pasos.get(d.id_demo);
          if (!m.length) {
            n.textContent = "Sin pasos: agrégalos en Administración";
            n.closest("label").querySelector("input").disabled = true;
          } else n.textContent = `${m.length} paso${m.length === 1 ? "" : "s"} · ~${seg.toFixed(seg < 10 ? 1 : 0)} s`;
        }).catch(() => { pasos.get(d.id_demo).textContent = "No se pudieron consultar los pasos"; });
      }
    },
  });
}

btnDemo.addEventListener("click", async () => {
  if (demo.activa) { await detenerTodo(O.boton); return; }
  if (!claveStore.obtener()) { abrirDialogoClave({ motivo: "Iniciar una DEMO requiere la clave de operador." }); return; }
  abrirPanelDemo();
});
demoPreferida.alCambiar(V, pintarBotonDemo);

/* ------------------------ Accesorios interruptor ------------------------ */
/* Luz, sonido y encendido alternan su estado con cada orden. El estado se toma
   de lo que difunde el servidor por WSS (incluye órdenes de otros clientes y de
   la DEMO) y se recuerda en este navegador. No hay confirmación del ESP. */
// v3: los estados guardados antes suponían otro estado inicial (quedaron invertidos); se descartan.
const LLAVE_INTERRUPTORES = `vehiculoIot.interruptores.v3.${V}`;
try {
  localStorage.removeItem(`vehiculoIot.interruptores.${V}`);
  localStorage.removeItem(`vehiculoIot.interruptores.v2.${V}`);
} catch { /* */ }
const interruptores = (() => {
  let guardado = {};
  try { guardado = JSON.parse(localStorage.getItem(LLAVE_INTERRUPTORES) || "{}") || {}; } catch { /* */ }
  // Sin dato guardado, cada accesorio arranca con su estado inicial (luz y excavadora encendidas).
  return Object.fromEntries(Object.entries(CONFIG.interruptores)
    .map(([c, t]) => [c, typeof guardado[c] === "boolean" ? guardado[c] : !!t.inicial]));
})();
for (const [c, on] of Object.entries(interruptores)) botonera.setInterruptor(Number(c), on);

function alternarInterruptor(codigo, { avisar }) {
  const txt = CONFIG.interruptores[codigo];
  if (!txt) return;
  interruptores[codigo] = !interruptores[codigo];
  try { localStorage.setItem(LLAVE_INTERRUPTORES, JSON.stringify(interruptores)); } catch { /* */ }
  botonera.setInterruptor(codigo, interruptores[codigo]);
  const on = interruptores[codigo];
  const mensaje = on ? txt.on : txt.off;
  log(catalogo.porCodigo(codigo)?.nombre || "Accesorio", mensaje);
  if (avisar) {
    avisoEstado({
      icono: CONFIG.iconos[codigo] || "i-bolt", titulo: mensaje, encendido: on,
      detalle: on ? "El botón queda encendido; tócalo de nuevo para apagar." : "Toca el botón de nuevo para encender.",
    });
  }
}

demo.addEventListener("cambio", (e) => {
  pintarBotonDemo();
  if (e.detail.evento === "demo_iniciada") log("DEMO", `«${e.detail.nombre}» en ejecución`);
  if (e.detail.fin) log("DEMO", e.detail.fin);
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
  if (ev.evento === "movimiento_individual" && ev.codigo != null) comandos.registrarEventoServidor(ev.codigo);
  if ((ev.evento === "movimiento_individual" || ev.evento === "demo_movimiento") && CONFIG.interruptores[ev.codigo]) {
    alternarInterruptor(ev.codigo, { avisar: ev.evento === "movimiento_individual" });   // la DEMO no llena de avisos
  }
  if (ev.evento === "movimiento_individual" || ev.evento === "demo_movimiento") botonera.marcarActivo(ev.codigo);
  if (ev.evento === "demo_movimiento") log("DEMO", `paso ${ev.datos.orden}/${ev.datos.total_movimientos}: ${ev.comando}`);
  if (ev.evento === "error" && !deDemo) toast(ev.datos.detalle || "La API informó un error.", "error");
});

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

  // Si el control se bloquea con una dirección mantenida por teclado, se suelta y se detiene.
  if (!listo && mantener.dir && !algunJoystickActivo()) {
    const o = mantener.origen;
    soltarMantenido();
    if (!demo.activa && tieneClave) detenerMovimiento(o);
  }

  // Con una dirección sostenida (joystick o teléfono inclinado) no se aceptan otras órdenes: una a la vez.
  botonera.setHabilitado(listo, { bloquearSecundarios: !!mantener.dir, bloquearBrazo: !!mantener.dir });
  giroscopio.configurar(listo, new Set(DIRECCIONES.filter((d) => catalogo.direccion(d, "conduccion"))));
  if (!listo && giroscopio.activo) giroscopio.pausar("Pausado: " + motivoBloqueo());
  $("btnGiro").disabled = !listo && !giroscopio.activo;
  for (const [mando, j] of Object.entries(joysticks)) {
    j.pausado = !!mantener.mando && mantener.mando !== mando;     // un joystick sostenido a la vez
    j.configurar(listo, new Set(DIRECCIONES.filter((d) => catalogo.direccion(d, mando))));
  }
  pintarBotonDemo();
  $("btnMic").disabled = !tieneClave || !vozSoportada();   // «alto» por voz funciona también durante una DEMO
  $("txtOrden").disabled = !tieneClave;
  $("btnOrden").disabled = !tieneClave;

  const est = demo.estado;

  const aviso = $("aviso");
  let texto = "", tipo = "info";
  if (!tieneClave) texto = "Falta la clave de operador: pulsa «Sin clave».";
  else if (!catalogo.cargado) { texto = "No se pudo cargar el catálogo de comandos."; tipo = "error"; }
  else if (est.activa) texto = `DEMO «${est.nombre || "en curso"}»${est.total ? ` (${est.orden}/${est.total})` : ""}: mando bloqueado. DETENER la cancela.`;
  else if (!wsAbierto) { texto = "Sin sesión WSS: mando bloqueado hasta reconectar. DETENER sigue activo."; tipo = "error"; }
  aviso.textContent = texto;
  aviso.className = `aviso aviso-linea aviso-${tipo}`;
  aviso.hidden = !texto;
}

/* ---------------------------- Modos --------------------------------- */
const botonesModo = [...document.querySelectorAll(".mando-modos [data-modo]")];

function leerModo() {
  try { const m = localStorage.getItem("vehiculoIot.modo"); return MODOS.includes(m) ? m : "pulso"; } catch { return "pulso"; }
}

function setModo(nuevo) {
  if (!MODOS.includes(nuevo)) nuevo = "pulso";
  if (modo === "voz" && nuevo !== "voz") { voz.detener(); cancelarSecuenciaVoz("cancelada al cambiar de modo"); }
  if (nuevo !== "giro") giroscopio.pausar();
  for (const j of Object.values(joysticks)) j.soltar();
  modo = nuevo;
  try { localStorage.setItem("vehiculoIot.modo", nuevo); } catch { /* */ }
  mandoEl.dataset.modo = nuevo;
  for (const b of botonesModo) b.setAttribute("aria-pressed", String(b.dataset.modo === nuevo));
  for (const n of mandoEl.querySelectorAll("[data-vista]")) n.hidden = !n.dataset.vista.split(" ").includes(nuevo);
  $("ayudaModo").textContent = AYUDA[nuevo];
  $("lineaEstado").textContent = AYUDA[nuevo];
  actualizarControles();
}

for (const b of botonesModo) b.addEventListener("click", () => setModo(b.dataset.modo));

/* ------------------------- Teclado y seguridad ---------------------- */
/** Flechas y WASD: conducción. IJKL: brazo (I/K) y pala (J/L). */
const TECLAS_DIR = {
  arrowup: ["conduccion", "arriba"], w: ["conduccion", "arriba"],
  arrowdown: ["conduccion", "abajo"], s: ["conduccion", "abajo"],
  arrowleft: ["conduccion", "izquierda"], a: ["conduccion", "izquierda"],
  arrowright: ["conduccion", "derecha"], d: ["conduccion", "derecha"],
  i: ["brazo", "arriba"], k: ["brazo", "abajo"], j: ["brazo", "izquierda"], l: ["brazo", "derecha"],
};
const presionadas = new Set();

document.addEventListener("keydown", (e) => {
  if (document.querySelector(".modal.show")) return;
  const t = e.target;
  if (t.closest?.("input,select,textarea,.joy") || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === "escape" || (k === " " && !t.closest?.("button,a"))) {
    e.preventDefault();
    detenerTodo(O.teclado);
    return;
  }
  if (!TECLAS_DIR[k] || e.repeat || presionadas.has(k)) return;
  if (t.closest?.("button,a") && k.startsWith("arrow")) return;
  const [mando, dir] = TECLAS_DIR[k];
  e.preventDefault();
  presionadas.add(k);
  const cmd = catalogo.direccion(dir, mando);
  if (!cmd) return;
  if (modo === "joystick") { if (puedeMover()) alCambiarDireccion(mando, dir); }
  else enviar(cmd.codigo, O.teclado);
});
document.addEventListener("keyup", (e) => {
  const k = e.key.toLowerCase();
  if (!presionadas.delete(k)) return;
  const [mando, dir] = TECLAS_DIR[k];
  if (modo === "joystick" && mantener.mando === mando && mantener.dir === dir) alCambiarDireccion(mando, null);
});
window.addEventListener("blur", () => {
  presionadas.clear();
  if (mantener.dir && !algunJoystickActivo()) alCambiarDireccion(mantener.mando, null);
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

async function sincronizarDemo() {
  try { await demo.sincronizar(); } catch (e) { log("Error", "DEMO: " + e.message); }
  actualizarControles();
}

(async function iniciar() {
  setModo(modo);
  botonera.render(catalogo);
  await inicializarClave();
  await Promise.all([pintarVehiculo(), cargarCatalogo(), sincronizarDemo(), cargarDemos()]);
  ws.conectar();
  if (!claveStore.obtener()) abrirDialogoClave({ motivo: "Para mover el vehículo necesitas la clave de operador." });
})();
