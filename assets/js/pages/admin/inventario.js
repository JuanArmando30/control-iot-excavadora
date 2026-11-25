/**
 * Inventario de unidades físicas (GET/POST /admin/unidades).
 * Vender = asignar a un cliente (la unidad pasa a «vendida» en la base);
 * liberar = finalizar la asignación. «Baja» sustituye a borrar: conserva el historial.
 * Una unidad YA dada de baja se puede «Eliminar» para siempre (con su historial; V015).
 */
import { CONFIG } from "../../config.js";
import { admin } from "../../api/admin-api.js";
import { api } from "../../api/vehiculo-api.js";
import { abrirModal, confirmar } from "../../ui/modales.js";
import { $, el, fechaHora, toast } from "../../ui/dom.js";
import {
  boton, fecha, filaCargando, filaVacia, formulario, insigniaEstado, NOMBRE_ESTADO, pintarPaginador, retrasar,
} from "../../ui/admin-ui.js";

const COLS = 6;

export async function opcionesClientes() {
  const p = await admin.usuarios({ rol: "usuario", activo: true, limite: 200 });
  return p.elementos.map((u) => [String(u.id_usuario), `${u.nombre} · ${u.correo}`]);
}

export async function opcionesModelos({ soloActivos = true } = {}) {
  const lista = await admin.modelos();
  return lista.filter((m) => !soloActivos || m.activo).map((m) => [String(m.id_modelo), m.nombre]);
}

export function crearInventario({ alCambiar }) {
  const estado = { desplazamiento: 0 };
  const filtros = () => ({
    estado: $("invEstado").value || null,
    id_modelo: $("invModelo").value || null,
    q: $("invBuscar").value.trim() || null,
    limite: CONFIG.paginaAdmin,
    desplazamiento: estado.desplazamiento,
  });

  async function cargarModelosFiltro() {
    const sel = $("invModelo");
    const actual = sel.value;
    try {
      const ops = await opcionesModelos({ soloActivos: false });
      sel.replaceChildren(el("option", { text: "Todos los modelos", attrs: { value: "" } }),
        ...ops.map(([v, t]) => el("option", { text: t, attrs: { value: v } })));
      sel.value = ops.some(([v]) => v === actual) ? actual : "";
    } catch { /* el listado mostrará el error */ }
  }

  async function cargar() {
    const tb = $("tbUnidades");
    filaCargando(tb, COLS);
    let p;
    try {
      p = await admin.unidades(filtros());
    } catch (e) {
      filaVacia(tb, COLS, e.message);
      $("pagUnidades").replaceChildren();
      return;
    }
    pintarPaginador($("pagUnidades"), p, (d) => { estado.desplazamiento = d; cargar(); });
    if (!p.elementos.length) {
      filaVacia(tb, COLS, p.total || filtros().estado || filtros().q ? "Ninguna unidad coincide con los filtros." : "Aún no hay unidades. Registra la primera con «Nueva».");
      return;
    }
    tb.replaceChildren(...p.elementos.map(fila));
  }

  /**
   * Movimientos de la unidad: su catálogo (lo que puede hacer, copiado de su modelo)
   * y su historial reciente en RDS. En una unidad VENDIDA el catálogo se ve siempre
   * (ficha del producto), pero el historial y el control piden el soporte del cliente.
   * BLOQUEAR un movimiento sí se puede en cualquier unidad, sin soporte (la empresa es la dueña inicial).
   */
  async function movimientos(u) {
    const [c, h] = await Promise.allSettled([api.comandos(u.id_vehiculo), api.historial(u.id_vehiculo)]);
    const tabla = (cabeceras, filas, vacio) => el("div", { class: "table-responsive", attrs: { tabindex: "0", role: "region", "aria-label": cabeceras.titulo } }, [
      el("table", { class: "table table-sm tabla-admin mb-0" }, [
        el("thead", {}, [el("tr", {}, cabeceras.columnas.map((t) => el("th", { attrs: { scope: "col" }, text: t })))]),
        el("tbody", {}, filas.length ? filas
          : [el("tr", {}, [el("td", { class: "vacio", text: vacio, attrs: { colspan: cabeceras.columnas.length } })])]),
      ]),
    ]);
    // La empresa puede BLOQUEAR movimientos de cualquier unidad (también vendida) sin el soporte del cliente.
    const esDetener = (x) => x.nombre.toUpperCase() === "DETENER";
    const filaComando = (x) => {
      const accion = esDetener(x)
        ? el("span", { class: "small text-secondary-emphasis", text: "Parada de seguridad" })
        : el("button", {
          class: `btn btn-sm ${x.activo ? "btn-outline-warning" : "btn-outline-success"}`,
          text: x.activo ? "Bloquear" : "Desbloquear",
          attrs: { type: "button", "aria-label": `${x.activo ? "Bloquear" : "Desbloquear"} ${x.nombre} en ${u.nombre}` },
          on: { click: async (e) => {
            const b = e.currentTarget;             // tras el await currentTarget ya es null
            b.disabled = true;
            try {
              const nuevo = await admin.bloquearComando(u.id_vehiculo, x.id_comando, x.activo);
              tr.replaceWith(filaComando(nuevo));
              toast(`${nuevo.nombre} ${nuevo.activo ? "desbloqueado" : "bloqueado"} en ${u.nombre}.`, nuevo.activo ? "ok" : "info");
            } catch (err) {
              b.disabled = false;
              toast(err.message, "error");
            }
          } },
        });
      const tr = el("tr", { class: x.activo ? "" : "inactiva", dataset: { comando: x.id_comando } }, [
        el("td", { text: x.codigo }),
        el("td", {}, [el("strong", { text: x.nombre }), x.descripcion ? el("div", { class: "small text-secondary-emphasis", text: x.descripcion }) : null]),
        el("td", {}, [el("span", { class: `badge ${x.activo ? "text-bg-success" : "text-bg-danger"}`, text: x.activo ? "Activo" : "Bloqueado" })]),
        el("td", { class: "text-end" }, [accion]),
      ]);
      return tr;
    };
    const catalogo = c.status === "fulfilled"
      ? tabla({ titulo: "Catálogo de la unidad", columnas: ["Código", "Comando", "Estado", ""] },
        c.value.slice().sort((a, b) => a.codigo - b.codigo).map(filaComando),
        "La unidad no tiene comandos: revisa las capacidades de su modelo.")
      : el("p", { class: "aviso aviso-error", text: c.reason.message });
    const historial = h.status === "fulfilled"
      ? tabla({ titulo: "Historial reciente", columnas: ["Fecha", "Comando", "Origen"] },
        h.value.movimientos.map((m) => el("tr", {}, [
          el("td", { class: "text-nowrap", text: m.fecha_hora ? fechaHora(m.fecha_hora) : "—" }),
          el("td", { text: m.comando ? `${m.comando} (#${m.codigo})` : "—" }),
          el("td", { class: "small", text: m.origen }),
        ])), "Sin movimientos registrados todavía.")
      : el("p", { class: "aviso", text: h.reason.status === 403
        ? "Historial reservado: la unidad pertenece a un cliente. Se ve con su autorización de soporte vigente."
        : h.reason.message });
    abrirModal({
      titulo: `Movimientos · ${u.nombre}`,
      tamano: "lg modal-fullscreen-sm-down",
      cuerpo: [
        el("p", { class: "small text-secondary-emphasis", text:
          "El catálogo viene del modelo al registrar la unidad (pestaña Modelos › Capacidades). Como empresa puedes bloquear un movimiento en cualquier unidad, también en una vendida y sin la autorización del cliente: nadie podrá usarlo (cliente, invitado ni DEMO) hasta que lo desbloquees. DETENER nunca se bloquea. El historial son las órdenes reales guardadas en RDS (las más recientes)." }),
        el("h3", { class: "subtitulo", text: "Catálogo de la unidad" }),
        catalogo,
        el("h3", { class: "subtitulo mt-3", text: "Historial reciente" }),
        historial,
      ],
      acciones: [{ texto: "Cerrar", clase: "btn-outline-secondary" }],
    });
  }

  function fila(u) {
    const acciones = [boton("Editar", "i-edit", "btn-outline-info", () => editar(u), `Editar ${u.nombre}`)];
    if (u.estado_comercial !== "baja") {
      acciones.push(boton("Movimientos", "i-list", "btn-outline-light", () => movimientos(u), `Movimientos de ${u.nombre}`));
    }
    if (u.estado_comercial === "vendida" && u.id_asignacion) {
      acciones.push(boton("Liberar", "i-x", "btn-outline-warning", () => liberar(u), `Finalizar la asignación de ${u.nombre}`));
    } else if (u.activo && ["inventario", "exhibicion"].includes(u.estado_comercial)) {
      acciones.push(boton("Asignar", "i-link", "btn-outline-success", () => asignar(u), `Asignar ${u.nombre} a un cliente`));
    }
    if (u.estado_comercial !== "baja") {
      acciones.push(boton("Dispositivo", "i-wifi", "btn-outline-light", () => dispositivo(u), `Credencial del ESP32 de ${u.nombre}`));
    }
    if (u.estado_comercial === "exhibicion" && u.activo) {
      acciones.push(boton("Invitados", "i-user", "btn-outline-warning", () => exhibicion(u), `Exhibición para invitados de ${u.nombre}`));
    }
    if (!["vendida", "baja"].includes(u.estado_comercial)) {
      acciones.push(boton("Baja", "i-trash", "btn-outline-danger", () => baja(u), `Dar de baja ${u.nombre}`));
    }
    if (u.estado_comercial === "baja") {
      acciones.push(boton("Eliminar", "i-trash", "btn-outline-danger", () => eliminar(u), `Eliminar definitivamente ${u.nombre}`));
    }
    return el("tr", { class: u.activo ? "" : "inactiva" }, [
      el("td", { text: u.id_vehiculo }),
      el("td", {}, [
        el("div", { class: "celda-principal" }, [
          el("span", { text: u.nombre }),
          u.es_simulada ? el("span", { class: "badge text-bg-dark border ms-1", text: "SIM", attrs: { title: "Unidad simulada, sin hardware" } }) : null,
        ]),
        el("small", { class: "celda-sec", text: u.numero_serie ? `Serie ${u.numero_serie}` : "Sin número de serie" }),
      ]),
      el("td", { class: "d-none d-md-table-cell", text: u.modelo || "—" }),
      el("td", {}, [insigniaEstado(u.estado_comercial)]),
      el("td", { class: "d-none d-sm-table-cell" }, u.propietario
        ? [el("span", { text: u.propietario }), u.asignada_desde ? el("small", { class: "celda-sec", text: `desde ${fecha(u.asignada_desde)}` }) : null]
        : [el("span", { class: "vacio", text: "—" })]),
      el("td", { class: "acciones" }, acciones),
    ]);
  }

  async function nueva() {
    let modelos;
    try { modelos = await opcionesModelos(); } catch (e) { toast(e.message, "error"); return; }
    if (!modelos.length) { toast("Primero registra un modelo activo (pestaña Modelos).", "error"); return; }
    formulario("Registrar unidad", [
      { nombre: "id_modelo", etiqueta: "Modelo", tipo: "select", requerido: true, entero: true, opciones: modelos },
      { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80 },
      { nombre: "numero_serie", etiqueta: "Número de serie", maxLength: 40, ayuda: "Único. Letras, números, punto, guion y guion bajo." },
      { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255 },
      { nombre: "estado_comercial", etiqueta: "Estado inicial", tipo: "select", requerido: true,
        opciones: [["inventario", "Inventario"], ["exhibicion", "Exhibición"]] },
      { nombre: "es_simulada", etiqueta: "Unidad simulada (sin hardware)", tipo: "checkbox" },
    ], async (d) => {
      await admin.crearUnidad(d);
      toast("Unidad registrada con el catálogo de su modelo.", "ok");
      await cargar();
      alCambiar();
    }, { nota: "La unidad copia las capacidades (comandos) de su modelo. Para venderla, asígnala a un cliente." });
  }

  function editar(u) {
    const vendida = u.estado_comercial === "vendida";
    const opciones = vendida
      ? [["vendida", "Vendida (se cambia liberando la asignación)"]]
      : ["inventario", "exhibicion", "baja"].map((e) => [e, NOMBRE_ESTADO[e]]);
    formulario(`Editar unidad #${u.id_vehiculo}`, [
      { nombre: "nombre", etiqueta: "Nombre", requerido: true, maxLength: 80, valor: u.nombre },
      { nombre: "numero_serie", etiqueta: "Número de serie", maxLength: 40, valor: u.numero_serie },
      { nombre: "descripcion", etiqueta: "Descripción", maxLength: 255, valor: u.descripcion },
      { nombre: "estado_comercial", etiqueta: "Estado", tipo: "select", requerido: true, valor: u.estado_comercial, opciones },
      { nombre: "activo", etiqueta: "Activa", tipo: "checkbox", valor: u.activo },
    ], async (d) => {
      await admin.actualizarUnidad(u.id_vehiculo, d);
      toast("Unidad actualizada.", "ok");
      await cargar();
      alCambiar();
    });
  }

  async function asignar(u) {
    let clientes;
    try { clientes = await opcionesClientes(); } catch (e) { toast(e.message, "error"); return; }
    if (!clientes.length) { toast("No hay clientes activos. Regístralo en la pestaña Clientes.", "error"); return; }
    formulario(`Asignar «${u.nombre}»`, [
      { nombre: "id_usuario", etiqueta: "Cliente", tipo: "select", requerido: true, entero: true, opciones: clientes },
    ], async (d) => {
      await admin.asignar(u.id_vehiculo, d.id_usuario);
      toast("Unidad asignada: ahora es del cliente.", "ok");
      await cargar();
      alCambiar();
    }, { textoGuardar: "Asignar", nota: "La unidad pasará a «vendida». La empresa ya no podrá operarla sin la autorización de soporte del cliente." });
  }

  function liberar(u) {
    formulario(`Liberar «${u.nombre}»`, [
      { nombre: "estado_resultante", etiqueta: "La unidad queda en", tipo: "select", requerido: true,
        opciones: [["inventario", "Inventario"], ["exhibicion", "Exhibición"], ["baja", "Baja"]] },
      { nombre: "motivo", etiqueta: "Motivo", maxLength: 30, ayuda: "Ej.: devolución, garantía (máx. 30 caracteres)." },
    ], async (d) => {
      await admin.finalizarAsignacion(u.id_asignacion, d);
      toast("Asignación finalizada.", "ok");
      await cargar();
      alCambiar();
    }, { textoGuardar: "Finalizar asignación", nota: `Propietario actual: ${u.propietario || "—"}. Su historial se conserva.` });
  }

  /** Credencial del ESP32 (Etapa 8): sin ella, con WS_ABIERTO=false, la unidad no recibe órdenes. */
  async function dispositivo(u) {
    let d;
    try { d = await admin.dispositivo(u.id_vehiculo); } catch (err) { toast(err.message, "error"); return; }
    const c = d.credencial;
    const lineas = [
      d.conectado ? "El ESP32 está CONECTADO ahora con su credencial." : "El ESP32 no está conectado con credencial en este momento.",
      c ? `Credencial #${c.id_credencial} · ${c.vigente ? "vigente" : "revocada"} · creada ${fechaHora(c.creada_en)}`
        + `${c.ultimo_uso ? ` · último uso ${fechaHora(c.ultimo_uso)}` : " · aún sin usar"}` : "Esta unidad todavía no tiene credencial.",
      d.ws_abierto ? "El servidor aún acepta conexiones sin credencial (WS_ABIERTO=true, transición)."
        : "El servidor exige credencial: sin ella el ESP32 no recibe órdenes.",
    ];
    const acciones = [{ texto: "Cerrar", clase: "btn-outline-secondary" }];
    if (c?.vigente) {
      acciones.unshift({ texto: "Revocar", clase: "btn-outline-danger me-auto", alPulsar: async () => {
        try { await admin.revocarCredencial(u.id_vehiculo); toast("Credencial revocada: el ESP32 quedó desconectado.", "ok"); } catch (err) { toast(err.message, "error"); }
      } });
    }
    acciones.push({ texto: c?.vigente ? "Generar otra" : "Generar credencial", clase: "btn-primary", alPulsar: async () => {
      try {
        const r = await admin.crearCredencial(u.id_vehiculo);
        setTimeout(() => mostrarSecreto(u, r.secreto), 350);
      } catch (err) { toast(err.message, "error"); }
    } });
    abrirModal({
      titulo: `ESP32 · ${u.nombre}`,
      cuerpo: [
        ...lineas.map((t) => el("p", { class: "small mb-2", text: t })),
        el("p", { class: "alert alert-warning py-2 small mb-0", text:
          "Generar una credencial nueva revoca la anterior: el ESP32 con la vieja se desconecta hasta que le cargues la nueva." }),
      ],
      acciones,
    });
  }

  function mostrarSecreto(u, secreto) {
    abrirModal({
      titulo: `Credencial del ESP32 · ${u.nombre}`,
      cuerpo: [
        el("p", { class: "small", text: "Se muestra solo ahora (en la base solo queda su huella). En el firmware:" }),
        el("ol", { class: "small" }, [
          el("li", { text: "Copia secretos.ejemplo.h como secretos.h (misma carpeta del .ino)." }),
          el("li", { text: "Pega la credencial entre las comillas de TOKEN_DISPOSITIVO." }),
          el("li", { text: `Verifica que ID_VEHICULO sea ${u.id_vehiculo}, compila y sube el firmware.` }),
        ]),
        el("output", { class: "codigo-unico codigo-largo", text: secreto }),
        el("p", { class: "alert alert-warning py-2 small mt-3 mb-0", text: "No la subas al repositorio ni la compartas. Si se filtra, revócala y genera otra." }),
      ],
      acciones: [
        { texto: "Copiar", clase: "btn-outline-info me-auto", alPulsar: async () => {
          try { await navigator.clipboard.writeText(secreto); toast("Credencial copiada.", "ok"); } catch { toast("No se pudo copiar: selecciónala a mano.", "error"); }
          return false;
        } },
        { texto: "Listo", clase: "btn-primary" },
      ],
    });
  }

  /** Interruptor de exhibición: los invitados solo reservan cuando la empresa lo abre (Etapa 7). */
  async function exhibicion(u) {
    let e;
    try { e = await admin.exhibicion(u.id_vehiculo); } catch (err) { toast(err.message, "error"); return; }
    const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const estado = e.abierta
      ? `Abierta a invitados hasta ${fechaHora(e.abierta_hasta)}.`
      : "Cerrada: los invitados ven la unidad en el catálogo pero no pueden reservarla.";
    const reserva = e.reserva
      ? `Hay un visitante usándola (quedan ${mmss(e.reserva.segundos_restantes)}).`
      : "Nadie la está usando ahora.";
    const horas = el("select", { class: "form-select form-select-sm w-auto", attrs: { "aria-label": "Horas abierta" } },
      [1, 2, 4, 8].map((h) => el("option", { text: `${h} h`, attrs: { value: h, selected: h === 2 } })));
    const intentar = async (accion, mensaje) => {
      try { await accion(); toast(mensaje, "ok"); } catch (err) { toast(err.message, "error"); }
    };
    const acciones = [{ texto: "Cerrar", clase: "btn-outline-secondary" }];
    if (e.reserva) {
      acciones.unshift({ texto: "Terminar reserva (DETENER)", clase: "btn-outline-danger me-auto",
        alPulsar: () => intentar(() => admin.terminarReserva(u.id_vehiculo), "Reserva terminada y unidad detenida.") });
    }
    acciones.push(e.abierta
      ? { texto: "Cerrar exhibición", clase: "btn-warning",
        alPulsar: () => intentar(() => admin.cambiarExhibicion(u.id_vehiculo, false), "Exhibición cerrada.") }
      : { texto: "Abrir a invitados", clase: "btn-primary",
        alPulsar: () => intentar(() => admin.cambiarExhibicion(u.id_vehiculo, true, Number.parseInt(horas.value, 10)), "Exhibición abierta.") });
    abrirModal({
      titulo: `Invitados · ${u.nombre}`,
      cuerpo: [
        el("p", { class: "aviso mb-2", text: estado }),
        el("p", { class: "small", text: reserva }),
        e.abierta ? null : el("div", { class: "d-flex align-items-center gap-2 mb-2" }, [el("label", { class: "small", text: "Abrir durante" }), horas]),
        el("p", { class: "alert alert-warning py-2 small mb-0", text:
          "Ábrela solo con alguien junto a la máquina. Cada visitante la usa 5 minutos con los comandos permitidos a invitados; "
          + "se cierra sola al pasar el tiempo o si se reinicia la API." }),
      ].filter(Boolean),
      acciones,
    });
  }

  async function baja(u) {
    if (!(await confirmar("Dar de baja", `«${u.nombre}» quedará inactiva y fuera de la venta. Su historial se conserva en RDS.`, "Dar de baja"))) return;
    try {
      await admin.bajaUnidad(u.id_vehiculo);
      toast("Unidad dada de baja.", "ok");
      await cargar();
      alCambiar();
    } catch (e) { toast(e.message, "error"); }
  }

  /** Borrado DEFINITIVO de una unidad dada de baja: pide escribir su nombre (no se puede deshacer). */
  function eliminar(u) {
    const entrada = el("input", { class: "form-control", attrs: {
      id: "confirmaEliminar", required: true, autocomplete: "off", spellcheck: "false", "aria-describedby": "ayudaEliminar" } });
    abrirModal({
      titulo: `Eliminar definitivamente · ${u.nombre}`,
      cuerpo: [
        el("p", { text: "Se borrará para siempre de RDS: la unidad, su catálogo de comandos, todo su historial de movimientos, sus DEMO, sus asignaciones pasadas, autorizaciones de soporte, reservas de invitado y la credencial del ESP32." }),
        el("p", { class: "aviso aviso-error", text: "No se puede deshacer. La bitácora conserva quién la eliminó y cuánto se borró." }),
        el("label", { class: "form-label", text: "Para confirmar, escribe el nombre de la unidad:", attrs: { for: "confirmaEliminar" } }),
        entrada,
        el("div", { class: "form-text", text: u.nombre, attrs: { id: "ayudaEliminar" } }),
      ],
      acciones: [
        { texto: "Cancelar", clase: "btn-outline-secondary" },
        { texto: "Eliminar para siempre", clase: "btn-danger", tipo: "submit", alPulsar: async (ctx) => {
          if (entrada.value.trim() !== u.nombre.trim()) { ctx.error("El nombre no coincide."); return false; }
          await admin.eliminarUnidad(u.id_vehiculo);
          toast(`«${u.nombre}» eliminada definitivamente.`, "ok");
          await cargar();
          alCambiar();
          return true;
        } },
      ],
    });
  }

  const reiniciar = () => { estado.desplazamiento = 0; cargar(); };
  $("invEstado").addEventListener("change", reiniciar);
  $("invModelo").addEventListener("change", reiniciar);
  $("invBuscar").addEventListener("input", retrasar(reiniciar));
  $("btnNuevaUnidad").addEventListener("click", nueva);

  return {
    async cargar() { await cargarModelosFiltro(); await cargar(); },
  };
}
