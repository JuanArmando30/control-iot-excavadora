/**
 * Página del INVITADO (Etapa 7): catálogo público y prueba temporal.
 *
 * - Catálogo: unidades en exhibición; se puede reservar si la empresa abrió la
 *   exhibición y nadie más la tiene.
 * - Prueba: reloj, DETENER (siempre), movimientos permitidos a invitados y DEMO
 *   de fábrica aptas. Latido cada 5 s: si deja de llegar, el servidor detiene la
 *   unidad y libera la reserva. El token vive en la pestaña (memoria y
 *   sessionStorage): al recargar se retoma la reserva en lugar de perderla.
 * - WSS: solo durante la reserva y solo a la unidad reservada (antes no hay
 *   permiso: el indicador queda en gris «Sin reserva», no en rojo).
 */
import { CONFIG } from "../config.js";
import { invitado } from "../api/invitado-api.js";
import { abrirModal, campo } from "../ui/modales.js";
import { $, el, icono, toast, vibrar } from "../ui/dom.js";
import { iniciarConectividad } from "./comun.js";

const T = CONFIG.tiempos;
const mmss = (s) => `${Math.floor(Math.max(s, 0) / 60)}:${String(Math.max(s, 0) % 60).padStart(2, "0")}`;
const seg = (ms) => `${(ms / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} s`;

let reserva = null;          // datos de la reserva (sin el token)
let unidad = null;
let finLocal = 0;            // reloj de este navegador (ms) en que termina la reserva
let total = 1;
let tLatido = 0;
let tReloj = 0;
let tCatalogo = 0;
let avisado30 = false;
let enDemo = false;
let detener = null;

/* ------------------------------ Catálogo ------------------------------ */

function textoEstado(u) {
  if (!u.exhibicion_abierta) return ["Exhibición cerrada", "text-bg-secondary"];
  if (!u.disponible) return [`Ocupada · libre en ${mmss(u.segundos_reserva)}`, "text-bg-warning"];
  return ["Disponible", "text-bg-success"];
}

function tarjeta(u) {
  const [estado, clase] = textoEstado(u);
  const boton = el("button", { class: "btn btn-primary", text: `Probar ${u.minutos_reserva} min`,
    attrs: { type: "button", disabled: !u.disponible, "aria-label": `Reservar ${u.nombre} durante ${u.minutos_reserva} minutos` },
    on: { click: () => confirmarReserva(u) } });
  return el("article", { class: "tarjeta unidad-cat" }, [
    el("div", { class: "unidad-cat-cab" }, [
      el("h3", { text: u.nombre }),
      el("span", { class: `badge ${clase}`, text: estado }),
    ]),
    el("p", { class: "unidad-cat-modelo", text: [u.modelo, u.microcontrolador].filter(Boolean).join(" · ") || "Modelo sin nombre" }),
    u.descripcion || u.modelo_descripcion ? el("p", { class: "ayuda", text: u.descripcion || u.modelo_descripcion }) : null,
    u.es_simulada ? el("p", { class: "ayuda", text: "Unidad simulada: no hay una máquina física detrás." }) : null,
    el("div", { class: "unidad-cat-pie" }, [boton]),
  ]);
}

async function cargarCatalogo() {
  const grid = $("gridCatalogo");
  try {
    const lista = await invitado.catalogo();
    grid.replaceChildren(...(lista.length ? lista.map(tarjeta)
      : [el("p", { class: "vacio", text: "Por ahora no hay unidades en exhibición. Vuelve más tarde." })]));
  } catch (e) {
    grid.replaceChildren(el("p", { class: "aviso aviso-error", text: e.message }));
  } finally {
    grid.removeAttribute("aria-busy");
  }
}

function confirmarReserva(u) {
  abrirModal({
    titulo: `Probar «${u.nombre}»`,
    cuerpo: [
      el("p", { text: `Tendrás la unidad para ti durante ${u.minutos_reserva} minutos.` }),
      el("ul", { class: "small" }, [
        el("li", { text: "Es una máquina real: hay una persona de la empresa supervisándola." }),
        el("li", { text: "DETENER la para al instante. Úsalo ante cualquier duda." }),
        el("li", { text: "Si cierras la pestaña o pierdes conexión, se detiene sola." }),
        el("li", { text: "Se abre el control completo: Pulso, Joystick, Voz, Giroscopio, IA y Táctil." }),
        el("li", { text: "Si la terminas tú, podrás volver a probarla pasados unos minutos." }),
      ]),
      campo({ nombre: "acepto", etiqueta: "Entiendo y quiero probarla", tipo: "checkbox" }),
    ],
    acciones: [
      { texto: "Cancelar", clase: "btn-outline-secondary" },
      { texto: "Empezar", clase: "btn-primary", tipo: "submit", alPulsar: async ({ form }) => {
        if (!form.elements.acepto.checked) throw new Error("Confirma que entiendes las condiciones.");
        await invitado.reservar(u.id_vehiculo);
        // Control completo con la reserva de esta pestaña (el token sigue en su sessionStorage).
        location.href = "index.html?invitado";
      } },
    ],
  });
}

/* ------------------------------ Prueba ------------------------------ */

function entrarPrueba(r, u, { retomada = false } = {}) {
  reserva = r;
  unidad = u;
  total = Math.max(r.segundos_restantes, 1);
  finLocal = Date.now() + r.segundos_restantes * 1000;
  avisado30 = false;
  clearInterval(tCatalogo);
  $("vistaCatalogo").hidden = true;
  $("vistaPrueba").hidden = false;
  $("tPrueba").textContent = u.nombre;
  $("pruebaModelo").textContent = [u.modelo, u.es_simulada ? "simulada" : null].filter(Boolean).join(" · ");
  detener = r.comandos.find((c) => c.tipo === "paro") || null;
  pintarMandos();
  pintarDemos();
  pintarReloj();
  tReloj = setInterval(pintarReloj, 500);
  tLatido = setInterval(latir, T.latidoInvitadoMs);
  // Eventos en vivo de SU unidad, con un ticket de su reserva (identidad propia de la reserva).
  ws.cambiar({ idVehiculo: u.id_vehiculo, identidad: `invitado-${r.id_reserva}`,
    obtenerTicket: () => invitado.ticketWs(u.id_vehiculo) });
  if (retomada) latir();
  $("btnDetener").focus();
  toast(retomada ? "Retomaste tu reserva." : "¡Listo! La unidad es tuya por un minuto.", "ok");
}

function pintarMandos() {
  const mandos = reserva.comandos.filter((c) => c.tipo !== "paro");
  $("gridMandos").replaceChildren(...(mandos.length ? mandos.map((c) => el("button", {
    class: "btn-mando-inv", attrs: { type: "button", "aria-label": c.nombre },
    on: { click: () => mover(c) },
  }, [icono(CONFIG.iconos[c.codigo] || "i-play"), el("span", { text: CONFIG.etiquetasCortas[c.codigo] || c.nombre })]))
    : [el("p", { class: "vacio", text: "Esta unidad no tiene movimientos habilitados para invitados." })]));
}

function pintarDemos() {
  const lista = $("listaDemos");
  if (!reserva.demos.length) {
    lista.replaceChildren(el("li", { class: "vacio", text: "No hay DEMO disponibles para invitados en esta unidad." }));
    return;
  }
  lista.replaceChildren(...reserva.demos.map((d) => {
    const b = el("button", { class: "btn btn-sm btn-outline-success", text: "Iniciar",
      attrs: { type: "button", disabled: enDemo, "aria-label": `Iniciar la DEMO ${d.nombre}` },
      on: { click: () => iniciarDemo(d) } });
    return el("li", {}, [
      el("div", {}, [el("strong", { text: d.nombre }), el("small", { class: "celda-sec", text: `${d.pasos} pasos · ${seg(d.duracion_total_ms)}` })]),
      b,
    ]);
  }));
}

function pintarEstadoDemo() {
  const p = $("estadoDemo");
  p.hidden = !enDemo;
  p.textContent = enDemo ? "DEMO en curso: la excavadora se mueve sola. DETENER la cancela." : "";
  pintarDemos();
}

function pintarReloj() {
  const resta = Math.max(Math.round((finLocal - Date.now()) / 1000), 0);
  $("reloj").textContent = mmss(resta);
  $("relojBarra").style.width = `${Math.min(100, (resta / total) * 100)}%`;
  $("reloj").classList.toggle("poco", resta <= 30);
  if (resta <= 30 && !avisado30 && resta > 0) { avisado30 = true; toast("Quedan 30 segundos.", "info"); }
  if (resta <= 0) salir("Se acabó tu tiempo. ¡Gracias por probarla!");
}

async function latir() {
  try {
    const r = await invitado.latido();
    finLocal = Date.now() + r.segundos_restantes * 1000;
    if (r.en_demo !== enDemo) { enDemo = r.en_demo; pintarEstadoDemo(); }
  } catch (e) {
    if (e.status === 401) salir("Tu reserva terminó.");
  }
}

async function mover(c) {
  vibrar();
  try {
    await invitado.mover(unidad.id_vehiculo, c.codigo);
  } catch (e) {
    toast(e.message, "error");
    if (e.status === 401) salir("Tu reserva terminó.");
  }
}

async function iniciarDemo(d) {
  try {
    await invitado.iniciarDemo(unidad.id_vehiculo, d.id_demo);
    enDemo = true;
    pintarEstadoDemo();
    toast(`DEMO «${d.nombre}» en marcha.`, "ok");
  } catch (e) { toast(e.message, "error"); }
}

/** DETENER: cancela la DEMO si corre y envía DETENER (el servidor siempre lo deja pasar). */
async function pararTodo() {
  vibrar(40);
  if (enDemo) {
    try { await invitado.cancelarDemo(unidad.id_vehiculo); } catch { /* ya terminó */ }
    enDemo = false;
    pintarEstadoDemo();
  }
  if (detener) await mover(detener);
}

async function terminar() {
  try { await pararTodo(); await invitado.terminar(); } catch { /* el servidor la cierra igual */ }
  salir("Reserva terminada. ¡Gracias por probarla!");
}

function salir(mensaje) {
  if (!reserva) return;
  clearInterval(tLatido);
  clearInterval(tReloj);
  reserva = null;
  enDemo = false;
  invitado.olvidar();
  ws.cambiar(null, SIN_RESERVA);
  $("vistaPrueba").hidden = true;
  $("vistaCatalogo").hidden = false;
  toast(mensaje, "info");
  cargarCatalogo();
  tCatalogo = setInterval(cargarCatalogo, T.catalogoInvitadoMs);
}

/* ------------------------------ Eventos ------------------------------ */

$("btnActualizar").addEventListener("click", cargarCatalogo);
$("btnTerminar").addEventListener("click", terminar);
$("btnDetener").addEventListener("pointerdown", (e) => { e.preventDefault(); pararTodo(); });
$("btnDetener").addEventListener("click", (e) => { if (e.detail === 0) pararTodo(); });      // teclado
document.addEventListener("keydown", (e) => {
  if (reserva && (e.key === " " || e.key === "Escape") && !e.target.closest("input,select,textarea,.modal")) {
    e.preventDefault();
    pararTodo();
  }
});
document.addEventListener("visibilitychange", () => { if (!document.hidden && reserva) latir(); });

const SIN_RESERVA = "Sin reserva: los eventos en vivo empiezan al reservar una unidad";
const { ws } = iniciarConectividad({ barra: true, idVehiculo: null, textoSinDestino: SIN_RESERVA });
ws.conectar();

/** ¿Había una reserva en esta pestaña (recargó la página)? Se retoma; si no, catálogo. */
async function arrancar() {
  const previa = await invitado.recuperar();
  if (previa) {
    let u = null;
    try { u = (await invitado.catalogo()).find((x) => x.id_vehiculo === previa.id_vehiculo) || null; } catch { /* sin catálogo */ }
    entrarPrueba(previa, u || { id_vehiculo: previa.id_vehiculo, nombre: `Unidad #${previa.id_vehiculo}`, modelo: "", es_simulada: false },
      { retomada: true });
    return;
  }
  cargarCatalogo();
  tCatalogo = setInterval(cargarCatalogo, T.catalogoInvitadoMs);
}
arrancar();
