/**
 * Asignaciones de unidades a clientes (GET/POST /admin/asignaciones).
 * Una unidad tiene a lo sumo UNA asignación vigente (lo garantiza la base).
 */
import { CONFIG } from "../../config.js";
import { admin } from "../../api/admin-api.js";
import { $, el, toast } from "../../ui/dom.js";
import { boton, fecha, filaCargando, filaVacia, formulario, pintarPaginador } from "../../ui/admin-ui.js";
import { opcionesClientes } from "./inventario.js";

const COLS = 5;

export function crearAsignaciones({ alCambiar }) {
  const estado = { desplazamiento: 0 };

  async function cargar() {
    const tb = $("tbAsignaciones");
    filaCargando(tb, COLS);
    let p;
    try {
      p = await admin.asignaciones({
        vigentes: $("asgVigentes").checked ? true : null,
        limite: CONFIG.paginaAdmin,
        desplazamiento: estado.desplazamiento,
      });
    } catch (e) {
      filaVacia(tb, COLS, e.message);
      $("pagAsignaciones").replaceChildren();
      return;
    }
    pintarPaginador($("pagAsignaciones"), p, (d) => { estado.desplazamiento = d; cargar(); });
    if (!p.elementos.length) {
      filaVacia(tb, COLS, $("asgVigentes").checked ? "No hay unidades asignadas en este momento." : "Aún no hay asignaciones.");
      return;
    }
    tb.replaceChildren(...p.elementos.map((a) => el("tr", { class: a.vigente ? "" : "inactiva" }, [
      el("td", {}, [
        el("span", { class: "celda-principal", text: `#${a.id_vehiculo} · ${a.unidad}` }),
        el("small", { class: "celda-sec", text: a.numero_serie ? `Serie ${a.numero_serie}` : "Sin número de serie" }),
      ]),
      el("td", {}, [el("span", { class: "celda-principal", text: a.usuario }), el("small", { class: "celda-sec", text: a.correo })]),
      el("td", { class: "d-none d-md-table-cell" }, [
        el("small", { class: "d-block", text: `Desde ${fecha(a.desde)}` }),
        a.hasta ? el("small", { class: "d-block", text: `Hasta ${fecha(a.hasta)}` }) : null,
        a.asignado_por_nombre ? el("small", { class: "celda-sec", text: `por ${a.asignado_por_nombre}` }) : null,
      ]),
      el("td", {}, [a.vigente
        ? el("span", { class: "badge text-bg-success", text: "Vigente" })
        : el("span", { class: "badge text-bg-secondary", text: a.motivo_fin || "Finalizada" })]),
      el("td", { class: "acciones" }, [a.vigente ? boton("Finalizar", "i-x", "btn-outline-warning", () => finalizar(a), `Finalizar la asignación de ${a.unidad}`) : null]),
    ])));
  }

  function finalizar(a) {
    formulario(`Finalizar asignación de «${a.unidad}»`, [
      { nombre: "estado_resultante", etiqueta: "La unidad queda en", tipo: "select", requerido: true,
        opciones: [["inventario", "Inventario"], ["exhibicion", "Exhibición"], ["baja", "Baja"]] },
      { nombre: "motivo", etiqueta: "Motivo", maxLength: 30, ayuda: "Ej.: devolución, garantía (máx. 30 caracteres)." },
    ], async (d) => {
      await admin.finalizarAsignacion(a.id_asignacion, d);
      toast("Asignación finalizada.", "ok");
      await cargar();
      alCambiar();
    }, { textoGuardar: "Finalizar", nota: `${a.usuario} dejará de ver y operar la unidad. El historial se conserva.` });
  }

  async function nueva() {
    let unidades;
    let clientes;
    try {
      const [inv, exh] = await Promise.all([
        admin.unidades({ estado: "inventario", limite: 200 }),
        admin.unidades({ estado: "exhibicion", limite: 200 }),
      ]);
      unidades = [...inv.elementos, ...exh.elementos].filter((u) => u.activo)
        .map((u) => [String(u.id_vehiculo), `#${u.id_vehiculo} · ${u.nombre}${u.numero_serie ? ` (${u.numero_serie})` : ""}${u.estado_comercial === "exhibicion" ? " · exhibición" : ""}`]);
      clientes = await opcionesClientes();
    } catch (e) { toast(e.message, "error"); return; }
    if (!unidades.length) { toast("No hay unidades disponibles (en inventario o exhibición y activas).", "error"); return; }
    if (!clientes.length) { toast("No hay clientes activos. Regístralo en la pestaña Clientes.", "error"); return; }
    formulario("Nueva asignación", [
      { nombre: "id_vehiculo", etiqueta: "Unidad", tipo: "select", requerido: true, entero: true, opciones: unidades },
      { nombre: "id_usuario", etiqueta: "Cliente", tipo: "select", requerido: true, entero: true, opciones: clientes },
    ], async (d) => {
      await admin.asignar(d.id_vehiculo, d.id_usuario);
      toast("Unidad asignada.", "ok");
      await cargar();
      alCambiar();
    }, { textoGuardar: "Asignar", nota: "La unidad pasará a «vendida». La empresa necesitará la autorización de soporte del cliente para operarla." });
  }

  $("asgVigentes").addEventListener("change", () => { estado.desplazamiento = 0; cargar(); });
  $("btnNuevaAsignacion").addEventListener("click", nueva);

  return { cargar };
}
