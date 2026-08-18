-- v7.19 (parte 2 de 2) — Retirar las bolsas de las recetas
--
-- Se aplica DESPUÉS de la parte 1 (que crea reglas_consumo_ticket y siembra las
-- dos reglas de bolsa). A partir de aquí la bolsa la aporta la regla por ticket y
-- ya no la receta del platillo, así que dejarla en los dos lados sería contarla
-- doble.
--
-- OJO CON EL DESPLIEGUE: el conector corre en la PC del punto de venta y se
-- actualiza a mano. Entre esta migración y el despliegue del conector nuevo, los
-- tickets que entren no van a descontar bolsa. Es un faltante chico y se corrige
-- recosteando — mucho menor que el sobrecosto de 56 % que había antes.
--
-- Reversible: las líneas quedan en recetas_retiradas_v7_19, así que se restauran
-- con un INSERT ... SELECT de vuelta a `recetas`.
--
-- Aplicada en PROD el 2026-08-09: 39 líneas respaldadas y retiradas.

INSERT INTO public.recetas_retiradas_v7_19 (id, producto_venta_id, insumo_id, cantidad, merma_pct, motivo)
SELECT r.id, r.producto_venta_id, r.insumo_id, r.cantidad, r.merma_pct,
       'v7.19: la bolsa pasa a ser regla por ticket'
  FROM public.recetas r
  JOIN public.insumos i ON i.id = r.insumo_id
 WHERE i.nombre IN ('BOLSA DE PAPEL CHICA','BOLSA DE PAPEL GRANDE')
ON CONFLICT (id) DO NOTHING;

DELETE FROM public.recetas r
 USING public.insumos i
 WHERE i.id = r.insumo_id
   AND i.nombre IN ('BOLSA DE PAPEL CHICA','BOLSA DE PAPEL GRANDE');

-- Para revertir:
--   INSERT INTO public.recetas (id, producto_venta_id, insumo_id, cantidad, merma_pct)
--   SELECT id, producto_venta_id, insumo_id, cantidad, merma_pct
--     FROM public.recetas_retiradas_v7_19
--   ON CONFLICT (id) DO NOTHING;
-- ...y desactivar las reglas del grupo 'bolsa_domicilio'.
