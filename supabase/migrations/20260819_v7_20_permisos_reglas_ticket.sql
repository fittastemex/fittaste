-- v7.20 — Permisos de lectura sobre las reglas de consumo por ticket
--
-- INCIDENTE (19-ago-2026): el conector llevaba 44 horas sin subir ventas. La causa
-- inmediata fue este permiso faltante.
--
-- El trigger `fn_consumo_por_ticket` (v7.19c) lee `reglas_consumo_ticket`, y el
-- trigger corre en el contexto de seguridad de QUIEN INSERTA — el rol `anon`, con el
-- que entra el conector. La tabla se creó sin GRANT alguno para `anon`, así que cada
-- INSERT de `venta_detalle` fallaba con:
--
--     42501: permission denied for table reglas_consumo_ticket
--
-- El conector revertía la venta y la reintentaba en el ciclo siguiente, en bucle.
-- Se recuperó solo en cuanto se otorgó el permiso: 81 tickets y $22,560 de venta
-- entraron en los primeros 25 minutos.
--
-- POR QUÉ SE ESCAPÓ: la tabla y el trigger se crearon y se probaron como
-- administrador, nunca con el rol que los usa en producción. Con privilegios de
-- `postgres` el permiso sobra y todo pasa. La verificación correcta es
--
--     SET LOCAL ROLE anon;  -- ...y recién entonces insertar
--
-- y queda como paso obligatorio para cualquier tabla nueva que el conector o la app
-- tengan que leer.
--
-- La app también administra estas reglas desde la pestaña "Consumo por ticket", así
-- que necesita escritura además de lectura.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reglas_consumo_ticket TO anon, authenticated;

-- Sólo lectura: es el respaldo de las líneas de bolsa retiradas de las recetas, y
-- nada de la app lo modifica.
GRANT SELECT ON public.recetas_retiradas_v7_19 TO anon, authenticated;
