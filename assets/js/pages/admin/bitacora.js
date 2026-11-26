/**
 * Bitácora de auditoría (GET /admin/auditoria): altas, asignaciones, cambios
 * de rol, inicios de sesión, códigos, autorizaciones de soporte y TODO lo que
 * hace un invitado (cada orden con su modo, DEMO iniciadas/canceladas y el resumen al terminar).
 */
import { CONFIG } from "../../config.js";
import { admin } from "../../api/admin-api.js";
import { $, el } from "../../ui/dom.js";
import { fecha, filaCargando, filaVacia, pintarPaginador } from "../../ui/admin-ui.js";

const COLS = 6;
const MAX_DETALLE = 160;

const MODO = {
  WEB_PULSO: "Pulso", WEB_JOYSTICK: "Joystick", WEB_VOZ: "Voz", WEB_BOTON: "Botón", WEB_TECLADO: "Teclado",
  WEB_GIROSCOPIO: "Giroscopio", WEB_IA: "IA (gestos)", WEB_TACTIL: "Táctil", WEB_INVITADO: "Vista sencilla",
};
const MOTIVO_FIN = {
  cancelada: "la terminó el visitante", expirada: "se acabó el tiempo", desconexion: "se desconectó",
  admin: "la terminó la empresa", detenida: "reinicio de la API",
};
const modo = (o) => MODO[o] || o || "—";

/** Detalle legible para las acciones del invitado; el resto, como texto. */
function textoDetalle(accion, d) {
  if (d == null || d === "") return "";
  if (typeof d === "object") {
    switch (accion) {
      case "invitado.reservar": return `Reserva #${d.id_reserva ?? "?"} · ${d.minutos ?? "?"} min`;
      case "invitado.movimiento": return `${d.comando} (#${d.codigo}) · ${modo(d.origen)}`;
      case "invitado.demo": return `Inició la DEMO «${d.nombre || d.id_demo}» · ${d.pasos ?? "?"} pasos`;
      case "invitado.demo_cancelar": return `Canceló la DEMO · ${d.movimientos_emitidos ?? 0} pasos emitidos`;
      case "invitado.fin":
        return `Fin de la reserva #${d.id_reserva ?? "?"} (${MOTIVO_FIN[d.motivo] || d.motivo}) · `
          + `${d.movimientos ?? 0} órdenes · ${d.demos ?? 0} DEMO${d.duracion_s != null ? ` · ${d.duracion_s} s` : ""}`;
      default: break;
    }
  }
  const t = typeof d === "string" ? d : JSON.stringify(d);
  return t.length > MAX_DETALLE ? `${t.slice(0, MAX_DETALLE)}…` : t;
}

/** Quién: usuario con nombre; un invitado se identifica por su número de reserva. */
function quien(a) {
  const reserva = a.detalle && typeof a.detalle === "object" ? a.detalle.id_reserva : null;
  if (a.rol_actor === "invitado") return [`Invitado${reserva ? ` · reserva #${reserva}` : ""}`, "invitado"];
  if (a.rol_actor === "sistema" && reserva) return [`Sistema · reserva #${reserva}`, "sistema"];   // cierre de la reserva
  return [a.usuario || "—", a.rol_actor];
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
      const detalle = textoDetalle(a.accion, a.detalle);
      const [nombre, rol] = quien(a);
      return el("tr", {}, [
        el("td", {}, [el("small", { text: fecha(a.ocurrido_en) })]),
        el("td", {}, [
          el("span", { class: "celda-principal", text: nombre }),
          el("small", { class: "celda-sec", text: rol }),
        ]),
        el("td", {}, [
          el("code", { class: "accion", text: a.accion }),
          detalle ? el("small", { class: "celda-sec d-lg-none", text: detalle }) : null,   // sin columna Detalle
        ]),
        el("td", { class: "d-none d-md-table-cell", text: a.recurso_tipo ? `${a.recurso_tipo} ${a.recurso_id ?? ""}` : "—" }),
        el("td", {}, [el("span", { class: `badge ${a.resultado === "ok" ? "text-bg-success" : "text-bg-danger"}`, text: a.resultado })]),
        el("td", { class: "d-none d-lg-table-cell detalle", text: detalle || "—", attrs: { title: detalle } }),
      ]);
    }));
  }

  $("bitAccion").addEventListener("change", () => { estado.desplazamiento = 0; cargar(); });
  return { cargar };
}
