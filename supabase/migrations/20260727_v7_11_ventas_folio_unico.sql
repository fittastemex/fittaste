-- v7.11 — Folio de venta único (candado de idempotencia del conector SR)
--
-- El conector deduplica consultando el folio antes de insertar
-- (`sbGet("ventas","folio=eq.TKT-...")`), pero la base no lo impedía. Al
-- reprocesar histórico (borrando estado-sync.json) un reintento, una segunda
-- instancia o una carrera podrían duplicar ventas, y una venta duplicada
-- descuenta inventario dos veces.
--
-- Aplicada en PROD y DEV el 2026-07-27. Verificado antes: DEV tenía 551 ventas
-- con 0 folios duplicados, PROD 0 ventas.

CREATE UNIQUE INDEX IF NOT EXISTS ux_ventas_folio ON public.ventas(folio);
