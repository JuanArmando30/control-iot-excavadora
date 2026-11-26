/**
 * Modelos comerciales y sus capacidades (comandos permitidos y límites de
 * seguridad). Las unidades nuevas copian el catálogo de su modelo; las ya
 * registradas conservan el suyo (pestaña Comandos).
 */
import { admin } from "../../api/admin-api.js";
import { confirmar } from "../../ui/modales.js";
import { $, el, toast } from "../../ui/dom.js";
import { boton, filaCargando, filaVacia, formulario, insignia } from "../../ui/admin-ui.js";

const TIPOS = { movimiento: "Movimiento", accesorio: "Accesorio", paro: "Paro" };
const seg = (ms) => (ms >= 1000 ? `${(ms / 1000).toLocaleString("es-MX")} s` : `${ms} ms`);

const camposModelo = (m = {}, edicion = false) => [
  { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80, valor: m.nombre },
  { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: m.descripcion },
  { nombre: "microcontrolador", etiqueta: "Microcontrolador", maxLength: 50, valor: m.microcontrolador, ayuda: "Ej.: ESP32" },
  { nombre: "max_movimiento_ms", etiqueta: "Máx. movimiento individual (ms)", tipo: "number", requerido: true, min: 100, max: 60000,
    valor: m.max_movimiento_ms ?? 3000, ayuda: "El firmware detiene el carrito a los ~3000 ms sin órdenes." },
  { nombre: "max_paso_ms", etiqueta: "Máx. por paso de DEMO (ms)", tipo: "number", requerido: true, min: 100, max: 600000, valor: m.max_paso_ms ?? 10000 },
  { nombre: "max_pasos_demo", etiqueta: "Máx. pasos por DEMO", tipo: "number", requerido: true, min: 1, max: 500, valor: m.max_pasos_demo ?? 50 },
  { nombre: "max_demo_ms", etiqueta: "Máx. duración de una DEMO (ms)", tipo: "number", requerido: true, min: 1000, max: 3600000,
    valor: m.max_demo_ms ?? 300000, ayuda: "No puede ser menor que el máximo por paso." },
  ...(edicion ? [{ nombre: "activo", etiqueta: "Activo (se puede usar para unidades nuevas)", tipo: "checkbox", valor: m.activo }] : []),
];

export function crearModelos({ alCambiar }) {
  let modelos = [];
  let seleccion = null;

  async function cargar() {
    const tb = $("tbModelos");
    filaCargando(tb, 5);
    try {
      modelos = await admin.modelos();
    } catch (e) {
      filaVacia(tb, 5, e.message);
      filaVacia($("tbCapacidades"), 5, "—");
      return;
    }
    if (!modelos.some((m) => m.id_modelo === seleccion)) seleccion = modelos[0]?.id_modelo ?? null;
    if (!modelos.length) filaVacia(tb, 5, "Aún no hay modelos. Crea el primero con «Nuevo».");
    else tb.replaceChildren(...modelos.map(filaModelo));
    await cargarCapacidades();
  }

  function filaModelo(m) {
    return el("tr", { class: m.id_modelo === seleccion ? "table-active" : "" }, [
      el("td", {}, [
        el("span", { class: "celda-principal", text: m.nombre }),
        el("small", { class: "celda-sec", text: m.microcontrolador || "Sin microcontrolador" }),
        el("small", { class: "celda-sec", text:
          `Mov. ${seg(m.max_movimiento_ms)} · paso ${seg(m.max_paso_ms)} · ${m.max_pasos_demo} pasos · DEMO ${seg(m.max_demo_ms)}` }),
      ]),
      el("td", { class: "text-center text-nowrap", text: `${m.unidades} / ${m.capacidades}`, attrs: { title: `${m.unidades} unidades · ${m.capacidades} capacidades` } }),
      el("td", {}, [insignia(m.activo)]),
      el("td", { class: "acciones" }, [
        boton("Capacidades", "i-list", "btn-outline-light", () => { seleccion = m.id_modelo; cargar(); }, `Ver capacidades de ${m.nombre}`),
        boton("Editar", "i-edit", "btn-outline-info", () => formulario(`Editar modelo «${m.nombre}»`, camposModelo(m, true), async (d) => {
          await admin.actualizarModelo(m.id_modelo, d);
          toast("Modelo actualizado.", "ok");
          await cargar();
          alCambiar();
        }), `Editar modelo ${m.nombre}`),
      ]),
    ]);
  }

  async function cargarCapacidades() {
    const tb = $("tbCapacidades");
    const m = modelos.find((x) => x.id_modelo === seleccion);
    $("tituloCapacidades").textContent = m ? `Capacidades de «${m.nombre}»` : "Capacidades del modelo";
    $("btnNuevaCapacidad").disabled = !m;
    if (!m) { filaVacia(tb, 5, "Selecciona un modelo."); return; }
    filaCargando(tb, 5);
    let caps;
    try { caps = await admin.capacidades(m.id_modelo); } catch (e) { filaVacia(tb, 5, e.message); return; }
    if (!caps.length) { filaVacia(tb, 5, "Sin capacidades: las unidades de este modelo no tendrían comandos."); return; }
    tb.replaceChildren(...caps.map((c) => el("tr", {}, [
      el("td", { text: c.codigo }),
      el("td", {}, [el("span", { class: "celda-principal", text: c.nombre }),
        c.descripcion ? el("small", { class: "celda-sec", text: c.descripcion }) : null]),
      el("td", { class: "d-none d-sm-table-cell" }, [el("span", {
        class: `badge ${c.tipo === "paro" ? "text-bg-danger" : c.tipo === "accesorio" ? "text-bg-warning" : "text-bg-info"}`,
        text: TIPOS[c.tipo] || c.tipo })]),
      el("td", {}, [insignia(c.permitido_invitado, "Sí", "No")]),
      el("td", { class: "acciones" }, [
        boton("Editar", "i-edit", "btn-outline-info", () => editarCapacidad(m, c), `Editar capacidad ${c.nombre}`),
        c.tipo === "paro" ? null : boton("Eliminar", "i-trash", "btn-outline-danger", async () => {
          if (!(await confirmar("Eliminar capacidad", `Se quitará «${c.nombre}» (código ${c.codigo}) del modelo. Las unidades ya registradas conservan su catálogo.`))) return;
          try {
            await admin.eliminarCapacidad(m.id_modelo, c.codigo);
            toast("Capacidad eliminada.", "ok");
            await cargar();
          } catch (e) { toast(e.message, "error"); }
        }, `Eliminar capacidad ${c.nombre}`),
      ]),
    ])));
  }

  function editarCapacidad(m, c = null) {
    const campos = [
      { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 60, valor: c?.nombre,
        ayuda: "Letras, números y guion bajo (se guarda en mayúsculas). El paro se llama DETENER." },
      ...(c ? [] : [{ nombre: "codigo", etiqueta: "Código", tipo: "number", requerido: true, min: 0, max: 65535,
        ayuda: "El número que recibe el firmware. Único en el modelo." }]),
      { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: c?.descripcion },
      { nombre: "tipo", etiqueta: "Tipo", tipo: "select", requerido: true, valor: c?.tipo ?? "movimiento",
        opciones: Object.entries(TIPOS) },
      { nombre: "permitido_invitado", etiqueta: "Permitido a invitados (movimientos; el paro y los accesorios siempre lo están)", tipo: "checkbox", valor: c?.permitido_invitado },
    ];
    formulario(c ? `Editar ${c.nombre} (código ${c.codigo})` : `Nueva capacidad para «${m.nombre}»`, campos, async (d) => {
      await admin.guardarCapacidad(m.id_modelo, { ...d, codigo: c ? c.codigo : d.codigo, nombre: (d.nombre || "").toUpperCase() });
      toast("Capacidad guardada.", "ok");
      await cargar();
    }, { nota: "El paro (DETENER) y los accesorios (luz, sonido, encender/apagar) siempre quedan permitidos a invitados. DETENER no se puede eliminar." });
  }

  $("btnNuevoModelo").addEventListener("click", () => formulario("Nuevo modelo", camposModelo(), async (d) => {
    const m = await admin.crearModelo(d);
    seleccion = m.id_modelo;
    toast("Modelo creado. Agrega sus capacidades.", "ok");
    await cargar();
    alCambiar();
  }));
  $("btnNuevaCapacidad").addEventListener("click", () => {
    const m = modelos.find((x) => x.id_modelo === seleccion);
    if (m) editarCapacidad(m);
  });

  return { cargar };
}
