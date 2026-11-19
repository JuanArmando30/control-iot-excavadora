/**
 * Bitácora de auditoría (GET /admin/auditoria): altas, asignaciones, cambios
 * de rol, inicios de sesión, códigos y autorizaciones de soporte.
 */
import { CONFIG } from "../../config.js";
import { admin } from "../../api/admin-api.js";
import { $, el } from "../../ui/dom.js";
import { fecha, filaCargando, filaVacia, pintarPaginador } from "../../ui/admin-ui.js";

const COLS = 6;
const MAX_DETALLE = 160;

function textoDetalle(d) {
  if (d == null || d === "") return "";
  const t = typeof d === "string" ? d : JSON.stringify(d);
  return t.length > MAX_DETALLE ? `${t.slice(0, MAX_DETALLE)}…` : t;
}

export function crearBitacora() {
  const estado = { desplazamiento: 0 };

  async function cargar() {
    const tb = $("tbAuditoria");
    filaCargando(tb, COLS);
    let p;
    try {
      p = await admin.auditoria({
        accion: $("bitAccion").value || null,
        limite: CONFIG.paginaAdmin,
        desplazamiento: estado.desplazamiento,
      });
    } catch (e) {
      filaVacia(tb, COLS, e.message);
      $("pagAuditoria").replaceChildren();
      return;
    }
    pintarPaginador($("pagAuditoria"), p, (d) => { estado.desplazamiento = d; cargar(); });
    if (!p.elementos.length) { filaVacia(tb, COLS, "Sin registros para este filtro."); return; }
    tb.replaceChildren(...p.elementos.map((a) => {
      const detalle = textoDetalle(a.detalle);
      return el("tr", {}, [
        el("td", {}, [el("small", { text: fecha(a.ocurrido_en) })]),
        el("td", {}, [
          el("span", { class: "celda-principal", text: a.usuario || "—" }),
          el("small", { class: "celda-sec", text: a.rol_actor }),
        ]),
        el("td", {}, [el("code", { class: "accion", text: a.accion })]),
        el("td", { class: "d-none d-md-table-cell", text: a.recurso_tipo ? `${a.recurso_tipo} ${a.recurso_id ?? ""}` : "—" }),
        el("td", {}, [el("span", { class: `badge ${a.resultado === "ok" ? "text-bg-success" : "text-bg-danger"}`, text: a.resultado })]),
        el("td", { class: "d-none d-lg-table-cell detalle", text: detalle || "—", attrs: { title: detalle } }),
      ]);
    }));
  }

  $("bitAccion").addEventListener("change", () => { estado.desplazamiento = 0; cargar(); });
  return { cargar };
}
