-- v7.25 — Módulo de producción: las preparaciones dejan de ser virtuales
--
-- Petición de dirección (2026-08-22): "en el conteo de inventario no veo las
-- preparaciones, es importante también tener un módulo de producción donde
-- cocina pueda registrar que se producen las preparaciones/preservicios y
-- puedan tener un descuento de insumos, generación de una cantidad de
-- preparación y eso a su vez se descuente de recetas."
--
-- ============================================================
-- POR QUÉ
-- ============================================================
-- Hoy las preparaciones NO tienen existencia. `explotarReceta` las revienta
-- hasta insumos de compra: al vender un wrap con 0.03 kg de DIP DE AGUACATE se
-- descuentan los ingredientes del dip (aguacate, limón…) prorrateados, nunca el
-- dip. Para costear da el mismo número, pero rompe tres cosas:
--
--   1. El inventario de ingredientes está mal todos los días. Cocina hace 500 ml
--      de dip el lunes y los aguacates salen del almacén el lunes; el sistema
--      los va descontando durante la semana conforme se venden wraps. Entre la
--      producción y el agotamiento, la existencia de aguacate nunca cuadra.
--   2. La preparación no se puede contar. Los 3 litros de aderezo en la cámara
--      son invisibles para el sistema. Es justo lo que dirección notó.
--   3. El rendimiento REAL es invisible. Si la tanda debía dar 500 ml y dio 420,
--      ese 16% no aparece en ningún lado — y en una cocina ese número es la
--      mitad del food cost.
--
-- ============================================================
-- CÓMO
-- ============================================================
-- Cada preparación gana un INSUMO ESPEJO. Se eligió así, en lugar de agregar
-- `preparacion_id` a `inventario_sucursal` y `movimientos_sucursal`, porque
-- todo lo que ya funciona lo hace sobre `insumos.id`: la hoja de conteo, el
-- kárdex, el costo promedio ponderado, la alarma de negativos y el estado de
-- resultados quedan cubiertos sin tocarlos. La alternativa obligaba a revisar
-- cada join del sistema.
--
-- El espejo lleva `tipo_control = 'preparacion'`, un valor nuevo. Así los
-- filtros que ya dicen `tipo_control = 'inventariable'` (sobre todo el buscador
-- de ingredientes de receta) lo excluyen solos: una preparación ya se ofrece
-- como opción `prep:`, y aparecer dos veces sería una trampa.

-- ============================================================
-- 1) tipo_control admite 'preparacion'
-- ============================================================
ALTER TABLE public.insumos DROP CONSTRAINT IF EXISTS insumos_tipo_control_check;
ALTER TABLE public.insumos ADD CONSTRAINT insumos_tipo_control_check
  CHECK (tipo_control::text = ANY (ARRAY['inventariable','gasto','preparacion']::text[]));

-- El espejo apunta a su preparación. UNIQUE: una preparación tiene un espejo y
-- sólo uno, para que no se dupliquen existencias del mismo aderezo.
ALTER TABLE public.insumos
  ADD COLUMN IF NOT EXISTS preparacion_id uuid REFERENCES public.productos_venta(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS insumos_preparacion_id_uniq
  ON public.insumos(preparacion_id) WHERE preparacion_id IS NOT NULL;

COMMENT ON COLUMN public.insumos.preparacion_id IS
  'Si está lleno, este insumo es el ESPEJO de una preparación: existe para darle existencia contable, kárdex y costo promedio. No se compra ni se pide a proveedor (v7.25).';

-- ============================================================
-- 2) Dos tipos de movimiento nuevos
-- ============================================================
-- Producir mueve inventario en dos direcciones a la vez: salen los ingredientes
-- y entra la preparación. Se distinguen de los de venta y de ajuste para que el
-- estado de resultados no los confunda con merma ni con consumo por venta.
ALTER TABLE public.movimientos_sucursal DROP CONSTRAINT IF EXISTS movimientos_sucursal_tipo_check;
ALTER TABLE public.movimientos_sucursal ADD CONSTRAINT movimientos_sucursal_tipo_check
  CHECK (tipo::text = ANY (ARRAY[
    'entrada_recepcion','entrada_compra_directa','entrada_ajuste',
    'salida_venta','salida_merma','salida_ajuste',
    'entrada_produccion',   -- entra la preparación terminada
    'salida_produccion'     -- salen sus ingredientes
  ]::text[]));

-- ============================================================
-- 3) La bitácora de producción
-- ============================================================
CREATE TABLE IF NOT EXISTS public.producciones (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sucursal_id         uuid NOT NULL REFERENCES public.sucursales(id),
  preparacion_id      uuid NOT NULL REFERENCES public.productos_venta(id),
  -- Cuánto salió DE VERDAD, en la unidad de la preparación (lt, kg, pz…).
  cantidad_producida  numeric NOT NULL CHECK (cantidad_producida > 0),
  -- Cuánto debía salir según el rendimiento de la receta, para el mismo
  -- consumo de ingredientes. Se guarda al momento porque el rendimiento de la
  -- receta puede cambiar después, y entonces el histórico mentiría.
  cantidad_teorica    numeric,
  -- Tandas equivalentes: cantidad_producida / rendimiento. Es el multiplicador
  -- con el que se descontaron los ingredientes.
  tandas              numeric NOT NULL CHECK (tandas > 0),
  costo_total         numeric,          -- lo que costaron los ingredientes
  costo_unitario      numeric,          -- costo_total / cantidad_producida
  fecha               date NOT NULL DEFAULT CURRENT_DATE,
  nota                text,
  registrado_por      text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS producciones_fecha_idx ON public.producciones(fecha DESC);
CREATE INDEX IF NOT EXISTS producciones_prep_idx  ON public.producciones(preparacion_id);

COMMENT ON TABLE public.producciones IS
  'Cada tanda que cocina produce: descuenta los ingredientes de la receta y da entrada a la preparación terminada. cantidad_producida vs cantidad_teorica mide el rendimiento real (v7.25).';

-- Qué ingredientes salieron en cada tanda. Se guarda aunque el kárdex ya lo
-- tenga, porque el kárdex se agrupa por insumo y aquí interesa la tanda.
CREATE TABLE IF NOT EXISTS public.produccion_consumo (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  produccion_id  uuid NOT NULL REFERENCES public.producciones(id) ON DELETE CASCADE,
  insumo_id      uuid NOT NULL REFERENCES public.insumos(id),
  cantidad       numeric NOT NULL,
  costo_unitario numeric,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS produccion_consumo_prod_idx ON public.produccion_consumo(produccion_id);

-- La referencia del kárdex a su producción, igual que ya existe venta_id y
-- recepcion_id. ON DELETE CASCADE para poder deshacer una tanda mal capturada.
ALTER TABLE public.movimientos_sucursal
  ADD COLUMN IF NOT EXISTS produccion_id uuid REFERENCES public.producciones(id) ON DELETE CASCADE;

-- ============================================================
-- 4) Permisos
-- ============================================================
-- LECCIÓN DE v7.20, y ahora es paso obligatorio: la tabla y el trigger de
-- consumo por ticket se crearon y se probaron como administrador, nunca con el
-- rol que los usa. Faltó el GRANT para `anon` y el conector estuvo 44 horas sin
-- subir ventas. Cualquier tabla nueva que la app tenga que leer o escribir se
-- verifica con `SET LOCAL ROLE anon;` ANTES de darla por buena.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.producciones      TO anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.produccion_consumo TO anon, authenticated;

-- ============================================================
-- 5) Espejo para las preparaciones que ya existen
-- ============================================================
-- La unidad del espejo es la de la preparación (lt, kg, pz, porcion). Ojo: es
-- la MISMA unidad en la que están escritas las recetas que la usan — por eso
-- 30 ml de aderezo se escriben 0.03, y por eso VINAGRETA DULCE con "1" pedía un
-- litro por ensalada.
INSERT INTO public.insumos (nombre, unidad_base, tipo_control, preparacion_id, activo)
SELECT pv.nombre, COALESCE(pv.unidad,'kg'), 'preparacion', pv.id, true
  FROM public.productos_venta pv
 WHERE COALESCE(pv.es_preparacion,false)
   AND COALESCE(pv.activo,true)
   AND NOT EXISTS (SELECT 1 FROM public.insumos i WHERE i.preparacion_id = pv.id);

-- Nota deliberada: NO se crean filas de inventario_sucursal con existencia.
-- Las preparaciones arrancan sin existencia y la primera cifra real la pone el
-- conteo físico o la primera producción registrada. Inventar un saldo inicial
-- aquí sería exactamente el error que el conteo de línea base viene a corregir.
