/**
 * Vista del COMPRADOR (Etapa 6): sus unidades, sus DEMO y el soporte.
 *
 * - DEMO de fábrica: solo lectura y se pueden iniciar.
 * - DEMO propias: crear, renombrar, activar, editar/reordenar pasos, eliminar
 *   e iniciar. Todo pasa por el servidor con SU token (autorización por unidad).
 * - Mientras corre una DEMO se muestra el avance y un botón DETENER (cancela).
 * - Soporte: autorizar a la empresa por unas horas o revocarlo.
 */
import { auth, mio } from "../../api/auth-api.js";
import { abrirEditorDemo } from "../../ui/editor-demo.js";
import { abrirModal, campo, confirmar } from "../../ui/modales.js";
import { $, el, icono, toast } from "../../ui/dom.js";
import { boton, fecha, filaCargando, filaVacia, formulario, insignia, insigniaEstado } from "../../ui/admin-ui.js";

const seg = (ms) => `${(ms / 1000).toLocaleString("es-MX", { maximumFractionDigits: 1 })} s`;
const SONDEO_MS = 1000;

export function crearComprador() {
  let unidades = [];
  let sel = null;
  let comandos = [];
  let limites = null;
  let demos = [];
  let ejecucion = { en_ejecucion: false };
  let temporizador = 0;

  const unidad = () => unidades.find((u) => u.id_vehiculo === sel);

  /* ------------------------------ Unidades ------------------------------ */

  async function cargar() {
    const lista = $("listaMisVehiculos");
    try {
      unidades = await auth.misVehiculos();
    } catch (e) {
      lista.hidden = false;
      lista.replaceChildren(el("li", { class: "aviso aviso-error", text: e.message }));
      $("panelMio").hidden = true;
      return;
    }
    const select = $("selMiVehiculo");
    select.replaceChildren(...unidades.map((u) => el("option", { text: u.nombre, attrs: { value: u.id_vehiculo } })));
    select.disabled = unidades.length < 2;
    if (!unidades.length) {
      lista.hidden = false;
      lista.replaceChildren(el("li", { class: "vacio", text: "Todavía no tienes unidades asignadas. La empresa te las asigna al comprarlas." }));
      $("panelMio").hidden = true;
      return;
    }
    lista.hidden = true;
    $("panelMio").hidden = false;
    if (!unidades.some((u) => u.id_vehiculo === sel)) sel = unidades[0].id_vehiculo;
    select.value = String(sel);
    await cargarUnidad();
  }

  async function cargarUnidad() {
    detenerSondeo();
    filaCargando($("tbMisDemos"), 5);
    const [c, l, s, x] = await Promise.allSettled([mio.comandos(sel), mio.limites(sel), mio.soporte(sel), mio.ejecucion(sel)]);
    comandos = c.status === "fulfilled" ? c.value : [];
    limites = l.status === "fulfilled" ? l.value : null;
    ejecucion = x.status === "fulfilled" ? x.value : { en_ejecucion: false };
    pintarUnidad(l.status === "rejected" ? l.reason.message : "");
    pintarSoporte(s);
    await cargarDemos();
    if (ejecucion.en_ejecucion) iniciarSondeo();
  }

  function pintarUnidad(errorLimites) {
    const u = unidad();
    const datos = [
      ["Unidad", u.nombre], ["Número de serie", u.numero_serie || "—"], ["Modelo", u.modelo || "—"],
      ["Tuya desde", fecha(u.asignada_desde)],
      ["Último estado", u.conectado == null ? "Sin estado registrado" : `${u.conectado ? "Conectada" : "Sin conexión"} · ${fecha(u.fecha_actualizacion)}`],
    ];
    if (limites) {
      datos.push(["Movimiento individual", `hasta ${seg(limites.max_movimiento_ms)}`],
        ["Paso de DEMO", `hasta ${seg(limites.max_paso_ms)}`],
        ["DEMO completa", `hasta ${limites.max_pasos_demo} pasos y ${seg(limites.max_demo_ms)}`]);
    } else datos.push(["Límites", errorLimites || "No disponibles"]);
    $("dlMiUnidad").replaceChildren(...datos.flatMap(([k, v]) => [el("dt", { text: k }), el("dd", { text: v })]),
      el("dt", { text: "Estado comercial" }), el("dd", {}, [insigniaEstado(u.estado_comercial)]));
    const activos = comandos.filter((x) => x.activo);
    $("listaMisComandos").replaceChildren(...(activos.length
      ? activos.map((x) => el("li", { text: `${x.nombre} · ${x.codigo}` }))
      : [el("li", { class: "vacio", text: "Sin comandos activos." })]));
  }

  /* -------------------------------- DEMO -------------------------------- */

  async function cargarDemos() {
    const tb = $("tbMisDemos");
    try {
      demos = await mio.demos(sel);
    } catch (e) {
      filaVacia(tb, 5, e.message);
      $("btnNuevaMiDemo").disabled = true;
      return;
    }
    $("btnNuevaMiDemo").disabled = !limites;
    pintarDemos();
  }

  function pintarDemos() {
    const tb = $("tbMisDemos");
    pintarEjecucion();
    if (!demos.length) { filaVacia(tb, 5, "Esta unidad no tiene DEMO. Crea la tuya con «Nueva DEMO»."); return; }
    const corriendo = ejecucion.en_ejecucion;
    tb.replaceChildren(...demos.map((d) => {
      const enCurso = corriendo && ejecucion.id_demo === d.id_demo;
      const acciones = [
        boton(d.propia ? "Pasos" : "Ver", d.propia ? "i-list" : "i-info", "btn-outline-light", () => abrirPasos(d),
          `${d.propia ? "Editar los pasos de" : "Ver los pasos de"} ${d.nombre}`),
      ];
      if (d.propia) {
        acciones.push(boton("Editar", "i-edit", "btn-outline-info", () => editar(d), `Renombrar o activar ${d.nombre}`));
      }
      const iniciar = boton("Iniciar", "i-play", "btn-outline-success", () => iniciarDemo(d), `Iniciar ${d.nombre}`);
      iniciar.disabled = corriendo || !d.activo || !d.pasos;
      acciones.push(iniciar);
      if (d.propia) acciones.push(boton("Eliminar", "i-trash", "btn-outline-danger", () => eliminar(d), `Eliminar ${d.nombre}`));
      return el("tr", { class: `${d.activo ? "" : "inactiva"} ${enCurso ? "table-active" : ""}` }, [
        el("td", {}, [el("span", { class: "celda-principal", text: d.nombre }),
          el("small", { class: "celda-sec", text: d.descripcion || (enCurso ? "En ejecución" : "") })]),
        el("td", {}, [el("span", { class: `badge ${d.propia ? "text-bg-primary" : "text-bg-light"}`, text: d.propia ? "Propia" : "Fábrica" })]),
        el("td", { class: "d-none d-sm-table-cell" }, [el("small", { text: `${d.pasos} · ${seg(d.duracion_total_ms)}` })]),
        el("td", { class: "d-none d-md-table-cell" }, [insignia(d.activo, "Activa", "Inactiva")]),
        el("td", { class: "acciones" }, acciones),
      ]);
    }));
  }

  async function abrirPasos(d) {
    let detalle;
    try { detalle = await mio.demo(sel, d.id_demo); } catch (e) { toast(e.message, "error"); return; }
    if (!limites) { toast("Los límites de la unidad no están disponibles.", "error"); return; }
    abrirEditorDemo({
      titulo: d.propia ? `Pasos de «${d.nombre}»` : `«${d.nombre}» (de fábrica)`,
      comandos, limites, movimientos: detalle.movimientos,
      soloLectura: !d.propia || (ejecucion.en_ejecucion && ejecucion.id_demo === d.id_demo),
      nota: d.propia ? null : "Las DEMO de fábrica las prepara la empresa. Puedes iniciarla o crear una propia.",
      guardar: async (pasos) => {
        await mio.guardarPasos(sel, d.id_demo, pasos);
        toast("Pasos guardados.", "ok");
        await cargarDemos();
      },
    });
  }

  function editar(d) {
    formulario(`Editar «${d.nombre}»`, [
      { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80, valor: d.nombre },
      { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: d.descripcion },
      { nombre: "activo", etiqueta: "Activa (se puede iniciar)", tipo: "checkbox", valor: d.activo },
    ], async (x) => {
      await mio.actualizarDemo(sel, d.id_demo, x);
      toast("DEMO actualizada.", "ok");
      await cargarDemos();
    });
  }

  async function eliminar(d) {
    if (!(await confirmar("Eliminar DEMO", `Se eliminará «${d.nombre}» y sus ${d.pasos} pasos.`))) return;
    try {
      await mio.eliminarDemo(sel, d.id_demo);
      toast("DEMO eliminada.", "ok");
      await cargarDemos();
    } catch (e) { toast(e.message, "error"); }
  }

  /** Antes de mover la máquina: confirmación de seguridad física. */
  function iniciarDemo(d) {
    abrirModal({
      titulo: `Iniciar «${d.nombre}»`,
      cuerpo: [
        el("p", { text: `${d.pasos} pasos · unos ${seg(d.duracion_total_ms)}. La excavadora se moverá sola.` }),
        el("ul", { class: "small" }, [
          el("li", { text: "La zona está despejada y hay una persona supervisando." }),
          el("li", { text: "Nadie más está controlando esta unidad." }),
          el("li", { text: "DETENER (aquí o en Control) cancela la DEMO al instante." }),
        ]),
        campo({ nombre: "seguro", etiqueta: "Confirmo las condiciones de seguridad", tipo: "checkbox" }),
      ],
      acciones: [
        { texto: "Cancelar", clase: "btn-outline-secondary" },
        { texto: "Iniciar", clase: "btn-success", tipo: "submit", alPulsar: async ({ form }) => {
          if (!form.elements.seguro.checked) throw new Error("Confirma las condiciones de seguridad para iniciar.");
          const r = await mio.iniciarDemo(sel, d.id_demo);
          toast(`DEMO «${r.nombre}» en marcha.`, "ok");
          ejecucion = { en_ejecucion: true, id_demo: d.id_demo, nombre: r.nombre, total_movimientos: r.total_movimientos };
          pintarDemos();
          iniciarSondeo();
        } },
      ],
    });
  }

  /* ---------------------------- Ejecución ---------------------------- */

  function pintarEjecucion() {
    const caja = $("miEjecucion");
    if (!ejecucion.en_ejecucion) { caja.hidden = true; caja.replaceChildren(); return; }
    const avance = ejecucion.movimientos_emitidos != null ? ` · paso ${ejecucion.movimientos_emitidos}/${ejecucion.total_movimientos}` : "";
    const detener = el("button", { class: "btn btn-danger btn-detener", attrs: { type: "button" } },
      [icono("i-stop"), el("span", { text: " DETENER" })]);
    detener.addEventListener("click", async () => {
      detener.disabled = true;
      try {
        await mio.cancelarDemo(sel);
        toast("DEMO detenida.", "ok");
      } catch (e) { toast(e.message, "error"); }
      await sondear();
    });
    caja.hidden = false;
    caja.replaceChildren(
      el("span", { text: `DEMO «${ejecucion.nombre || "en curso"}» en ejecución${avance}.` }),
      detener,
    );
  }

  async function sondear() {
    try {
      const antes = ejecucion.en_ejecucion;
      ejecucion = await mio.ejecucion(sel);
      if (antes && !ejecucion.en_ejecucion) { detenerSondeo(); await cargarDemos(); return; }
    } catch { /* sin red: se reintenta en el siguiente ciclo */ }
    pintarDemos();
  }

  function iniciarSondeo() {
    detenerSondeo();
    temporizador = setInterval(sondear, SONDEO_MS);
  }

  function detenerSondeo() {
    clearInterval(temporizador);
    temporizador = 0;
  }

  /* ----------------------------- Soporte ----------------------------- */

  function pintarSoporte(resultado) {
    const tb = $("tbSoporte");
    if (resultado.status === "rejected") { filaVacia(tb, 4, resultado.reason.message); return; }
    const lista = resultado.value;
    $("btnRevocarSoporte").disabled = !lista.some((s) => s.vigente);
    if (!lista.length) { filaVacia(tb, 4, "Nunca has autorizado soporte en esta unidad."); return; }
    tb.replaceChildren(...lista.map((s) => el("tr", { class: s.vigente ? "" : "inactiva" }, [
      el("td", { text: s.administrador || "Cualquier administrador" }),
      el("td", { class: "d-none d-sm-table-cell", text: s.motivo || "—" }),
      el("td", {}, [el("small", { text: fecha(s.expira_en) })]),
      el("td", {}, [el("span", {
        class: `badge ${s.vigente ? "text-bg-warning" : "text-bg-secondary"}`,
        text: s.vigente ? "Vigente" : s.revocada_en ? "Revocada" : "Vencida" })]),
    ])));
  }

  async function recargarSoporte() {
    const [s] = await Promise.allSettled([mio.soporte(sel)]);
    pintarSoporte(s);
  }

  $("btnOtorgarSoporte").addEventListener("click", () => formulario("Autorizar soporte", [
    { nombre: "horas", etiqueta: "Durante", tipo: "select", requerido: true, entero: true, valor: "4",
      opciones: [["1", "1 hora"], ["2", "2 horas"], ["4", "4 horas"], ["8", "8 horas"], ["24", "1 día"], ["72", "3 días"]] },
    { nombre: "motivo", etiqueta: "Motivo", maxLength: 255, ayuda: "Ej.: revisión de la pala, ajuste de una DEMO." },
  ], async (d) => {
    await mio.otorgarSoporte(sel, d);
    toast(`Soporte autorizado por ${d.horas} h. Puedes revocarlo cuando quieras.`, "ok");
    await recargarSoporte();
  }, { textoGuardar: "Autorizar", nota: "La empresa podrá operar esta unidad (mover, DEMO) mientras la autorización esté vigente. No verá ni editará tus DEMO privadas." }));

  $("btnRevocarSoporte").addEventListener("click", async () => {
    if (!(await confirmar("Revocar soporte", "La empresa dejará de poder operar tu unidad de inmediato.", "Revocar"))) return;
    try {
      const r = await mio.revocarSoporte(sel);
      toast(`${r.revocadas} autorización(es) revocada(s).`, "ok");
      await recargarSoporte();
    } catch (e) { toast(e.message, "error"); }
  });

  $("btnNuevaMiDemo").addEventListener("click", () => formulario("Nueva DEMO", [
    { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80 },
    { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255 },
  ], async (d) => {
    const nueva = await mio.crearDemo(sel, d);
    toast("DEMO creada. Ahora agrega sus pasos.", "ok");
    await cargarDemos();
    setTimeout(() => abrirPasos({ ...nueva, propia: true }), 400);
  }, { textoGuardar: "Crear" }));

  $("selMiVehiculo").addEventListener("change", (e) => { sel = Number.parseInt(e.target.value, 10); cargarUnidad(); });
  $("btnRecargarMio").addEventListener("click", cargar);
  document.addEventListener("visibilitychange", () => { if (document.hidden) detenerSondeo(); else if (ejecucion.en_ejecucion) iniciarSondeo(); });

  return { cargar, detener: detenerSondeo };
}
