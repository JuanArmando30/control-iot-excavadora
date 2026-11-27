/**
 * Primer import de Monitoreo y Administración: con una reserva de invitado en
 * esta pestaña, vuelve a su control y la página no llega a cargarse
 * (espera de nivel superior que nunca termina).
 */
import { bloquearSiInvitado } from "./modo-invitado.js";

await bloquearSiInvitado();
