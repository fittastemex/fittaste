-- v7.13 — El costeo va SIN IVA en todo el sistema
--
-- Decisión de dirección (2026-07-28): el IVA de compras es acreditable para Fit
-- Taste (se factura IVA en la venta), así que el costo de inventario y el food
-- cost deben ir SIN IVA. El IVA se sigue capturando por lote porque la cuenta
-- por pagar al proveedor sí lo incluye — pero no entra en la valuación.
--
-- Problema que corrige:
-- El sistema tenía las dos convenciones mezcladas y el mismo insumo costaba 16%
-- distinto según por qué camino entrara:
--   * almacén (lotes PEPS)  -> costo_unitario + iva   (CON IVA)
--   * fallback del catálogo -> costo_referencia/contenido (SIN IVA)
--   * inventario_sucursal   -> heredado del almacén   (CON IVA)
-- 63 insumos usados en recetas tienen aplica_iva = true, así que la diferencia
-- no era marginal.

-- 1) La entrada de lote deja de sumar el IVA a la valuación del almacén.
CREATE OR REPLACE FUNCTION public.fn_lote_entrada_peps()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.existencia_restante IS NULL THEN
        NEW.existencia_restante = NEW.cantidad;
    END IF;
    UPDATE inventario_almacen
    SET existencia = existencia + NEW.cantidad,
        -- v7.13: SIN IVA. El IVA queda en lotes_almacen.iva para la CxP.
        costo_unitario_actual = NEW.costo_unitario,
        updated_at = NOW()
    WHERE id = NEW.inventario_id;
    RETURN NEW;
END;
$$;

COMMENT ON COLUMN public.lotes_almacen.iva IS
  'IVA por unidad de la factura. Se guarda para la cuenta por pagar; NO entra en el costeo (v7.13: la valuación de almacén y el food cost van sin IVA).';

COMMENT ON COLUMN public.inventario_almacen.costo_unitario_actual IS
  'Costo unitario del último lote recibido, SIN IVA (v7.13).';

-- 2) Recosteo del estado actual: costo_unitario_actual al costo sin IVA del
--    lote más reciente de cada SKU.
UPDATE public.inventario_almacen ia
   SET costo_unitario_actual = l.costo_unitario,
       updated_at = NOW()
  FROM (
    SELECT DISTINCT ON (inventario_id) inventario_id, costo_unitario
      FROM public.lotes_almacen
     ORDER BY inventario_id, fecha_entrada DESC, created_at DESC
  ) l
 WHERE l.inventario_id = ia.id
   AND ia.costo_unitario_actual IS DISTINCT FROM l.costo_unitario;

-- 3) inventario_sucursal.costo_promedio: quitar el IVA a los insumos cuyo costo
--    llegó del almacén con IVA incluido. Se identifica comparando contra el
--    catálogo (que siempre guardó el costo sin IVA): si el promedio está ~16%
--    arriba y la presentación aplica IVA, es el mismo costo con IVA dentro.
WITH cat AS (
  SELECT c.insumo_id,
         MIN(c.costo_referencia / NULLIF(c.contenido,0)) AS cu,
         BOOL_OR(c.aplica_iva) AS iva
    FROM public.catalogo c
   WHERE c.insumo_id IS NOT NULL AND c.costo_referencia > 0
   GROUP BY c.insumo_id
)
UPDATE public.inventario_sucursal s
   SET costo_promedio = ROUND(cat.cu, 6), updated_at = NOW()
  FROM cat
 WHERE cat.insumo_id = s.insumo_id
   AND cat.iva
   AND cat.cu > 0
   AND s.costo_promedio BETWEEN cat.cu * 1.10 AND cat.cu * 1.22;
