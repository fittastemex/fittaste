-- v7.18 — Sucursal declara la necesidad; compras decide la presentación
--
-- Decisión de dirección (2026-08-08): sucursal sigue pidiendo en unidad de
-- consumo y viendo una presentación sugerida, pero COMPRAS debe poder cambiar
-- la presentación de compra según convenga — sea otra presentación del mismo
-- proveedor o de un proveedor distinto.
--
-- Dos cosas lo bloqueaban:
--
-- 1) El pedido NO guardaba la cantidad que pidió sucursal en unidad base. Sólo
--    guardaba la cantidad ya convertida a unidades de presentación (2 galones),
--    y perdía el "4,000 ml" original. Sin ese dato compras no tiene desde dónde
--    recalcular al cambiar de envase. Es el dato que no se recupera después:
--    cada pedido creado sin él lo pierde para siempre.
--
-- 2) El default de presentación era la MÁS BARATA por unidad base, y en los dos
--    únicos insumos con más de una presentación resultó ser justo la que nunca
--    se compra:
--      CLARAS DE HUEVO  litro $0.0470/ml -> pedida  0 veces
--                       galón $0.0474/ml -> pedida 35 veces
--      MIEL             25 kg $0.0948/g  -> pedida  0 veces
--                        1 kg $0.1100/g  -> pedida  4 veces
--    La miel explica por qué ninguna fórmula lo resuelve: el tambo de 25 kg SÍ
--    es 14% más barato por gramo, pero nadie quiere 25 kg de miel en una
--    sucursal. Es un criterio humano, no un cálculo.

-- ============================================================
-- 1) La cantidad que pidió sucursal, en unidad base
-- ============================================================
ALTER TABLE public.pedido_detalle
  ADD COLUMN IF NOT EXISTS cantidad_base numeric;

COMMENT ON COLUMN public.pedido_detalle.cantidad_base IS
  'Cantidad que pidió sucursal en la unidad base del insumo (ml/g/pz). Es la NECESIDAD; `cantidad` es cuántas unidades de la presentación se compran para cubrirla, redondeando hacia arriba. Al cambiar de presentación se recalcula desde aquí, no desde el volumen que iba a llegar: el excedente del envase anterior es un artefacto del empaque, no un requerimiento. NULL en pedidos anteriores a v7.18 — ahí la app estima cantidad × contenido y lo marca como estimado.';

-- A propósito NO se rellenan los pedidos históricos: cantidad × contenido es el
-- volumen que iba a LLEGAR, no lo que se necesitaba. Escribir eso como si fuera
-- el dato real sería inventar historia. La app lo calcula al vuelo y lo etiqueta.

-- ============================================================
-- 2) Presentación preferida
-- ============================================================
ALTER TABLE public.catalogo
  ADD COLUMN IF NOT EXISTS preferida boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.catalogo.preferida IS
  'Presentación que se sugiere por omisión para este insumo. Sustituye a "la más barata por unidad base", que en la práctica sugería la que nunca se compra. Una sola por insumo (uq_catalogo_preferida_por_insumo).';

-- Siembra desde el historial real de compras: gana la más pedida. Si ninguna se
-- ha pedido nunca, gana la más barata por unidad base (el criterio anterior),
-- que para un insumo con una sola presentación es esa misma.
WITH ranked AS (
  SELECT c.id, c.insumo_id,
         ROW_NUMBER() OVER (
           PARTITION BY c.insumo_id
           ORDER BY (SELECT COUNT(*) FROM public.pedido_detalle pd WHERE pd.catalogo_id = c.id) DESC,
                    c.costo_referencia / NULLIF(c.contenido,0) ASC NULLS LAST,
                    c.created_at ASC
         ) AS rn
    FROM public.catalogo c
   WHERE c.insumo_id IS NOT NULL
     AND COALESCE(c.activo, true)
)
UPDATE public.catalogo c
   SET preferida = true
  FROM ranked
 WHERE ranked.id = c.id AND ranked.rn = 1;

-- Una preferida por insumo. Índice parcial: no estorba a las no-preferidas ni a
-- las presentaciones sin insumo.
CREATE UNIQUE INDEX IF NOT EXISTS uq_catalogo_preferida_por_insumo
  ON public.catalogo (insumo_id)
  WHERE preferida AND insumo_id IS NOT NULL;

-- ============================================================
-- 3) Bitácora del cambio de presentación
-- ============================================================
-- Mismo patrón que pedido_reasignaciones (que ya registra los cambios de
-- proveedor): queda constancia de qué eligió sucursal y qué decidió compras.
CREATE TABLE IF NOT EXISTS public.pedido_presentacion_cambios (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pedido_detalle_id uuid REFERENCES public.pedido_detalle(id) ON DELETE CASCADE,
  pedido_id uuid REFERENCES public.pedidos(id) ON DELETE CASCADE,
  catalogo_original_id uuid REFERENCES public.catalogo(id),
  catalogo_nuevo_id uuid REFERENCES public.catalogo(id),
  cantidad_original numeric,
  cantidad_nueva numeric,
  cantidad_base numeric,
  cambio_proveedor boolean NOT NULL DEFAULT false,
  cambiado_por text,
  fecha timestamptz DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pres_cambios_pedido
  ON public.pedido_presentacion_cambios(pedido_id);

COMMENT ON TABLE public.pedido_presentacion_cambios IS
  'Bitácora de cambios de presentación de compra hechos por compras sobre un pedido de sucursal (v7.18).';
