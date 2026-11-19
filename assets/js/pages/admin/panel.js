/**
 * Panel: métricas reales de GET /admin/metricas (sp_metricas_admin) y las
 * últimas acciones de la bitácora. Sin datos de ejemplo: si la API falla se
 * muestra el error, no números inventados.
 */
import { admin } from "../../api/admin-api.js";
import { $, el } from "../../ui/dom.js";
import { fecha } from "../../ui/admin-ui.js";

const n = (v) => (Number.isInteger(v) ? v.toLocaleString("es-MX") : "—");

function tarjeta(valor, etiqueta, detalle = "", clase = "") {
  return el("div", { class: `metrica ${clase}` }, [
    el("span", { class: "metrica-valor", text: valor }),
    el("span", { class: "metrica-etq", text: etiqueta }),
    detalle ? el("span", { class: "metrica-det", text: detalle }) : null,
  ]);
}

function pintarMetricas(m) {
  $("gridMetricas").replaceChildren(
    tarjeta(n(m.unidades), "Unidades", `${n(m.unidades_inventario)} inventario · ${n(m.unidades_exhibicion)} exhibición · ${n(m.unidades_vendidas)} vendidas · ${n(m.unidades_baja)} baja`, "ancha"),
    tarjeta(n(m.clientes_activos), "Clientes activos"),
    tarjeta(n(m.asignaciones_vigentes), "Asignaciones vigentes"),
    tarjeta(n(m.modelos_activos), "Modelos activos"),
    tarjeta(n(m.unidades_simuladas), "Unidades simuladas", "sin hardware"),
    tarjeta(n(m.administradores_activos), "Administradores"),
    tarjeta(n((m.demos_fabrica ?? 0) + (m.demos_privadas ?? 0)), "DEMO", `${n(m.demos_fabrica)} de fábrica · ${n(m.demos_privadas)} privadas`),
    // 12 columnas-unidad en total: 3 filas exactas de 4 (escritorio) o 6 de 2 (teléfono), sin huecos.
    tarjeta(n(m.movimientos_24h), "Movimientos 24 h", `${n(m.movimientos_7d)} en 7 días · ${n(m.movimientos_total)} en total`, "ancha"),
    tarjeta(n(m.reservas_vigentes), "Reservas de exhibición", "invitados (Etapa 7)"),
    tarjeta(m.ultimo_movimiento ? fecha(m.ultimo_movimiento) : "—", "Último movimiento", "guardado en el historial", "fecha"),
  );
  $("metricasFecha").textContent = `Datos de RDS · ${fecha(m.generado_en)}`;
}

function pintarUltimas(p) {
  const lista = $("listaUltimas");
  if (!p.elementos.length) {
    lista.replaceChildren(el("li", { class: "vacio", text: "Aún no hay acciones registradas." }));
    return;
  }
  lista.replaceChildren(...p.elementos.map((a) => el("li", {}, [
    el("time", { text: fecha(a.ocurrido_en) }),
    el("span", { class: "reg-etq", text: a.accion }),
    el("span", { class: "reg-txt", text: `${a.usuario || a.rol_actor}${a.recurso_tipo ? ` · ${a.recurso_tipo} ${a.recurso_id ?? ""}` : ""}${a.resultado !== "ok" ? ` · ${a.resultado}` : ""}` }),
  ])));
}

export function crearPanel() {
  async function cargar() {
    const grid = $("gridMetricas");
    grid.setAttribute("aria-busy", "true");
    const [m, u] = await Promise.allSettled([admin.metricas(), admin.auditoria({ limite: 8 })]);
    grid.removeAttribute("aria-busy");
    if (m.status === "fulfilled") pintarMetricas(m.value);
    else {
      grid.replaceChildren(el("p", { class: "aviso aviso-error", text: m.reason.message }));
      $("metricasFecha").textContent = "";
    }
    if (u.status === "fulfilled") pintarUltimas(u.value);
    else $("listaUltimas").replaceChildren(el("li", { class: "vacio", text: u.reason.message }));
  }
  return { cargar };
}
