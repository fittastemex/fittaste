-- v7.19 — Consumo por TICKET, no por platillo
--
-- Decisión de dirección (2026-08-09): la bolsa no es del platillo, es del pedido.
-- Un wrap solo va en bolsa chica; si el ticket trae varios productos, cocina manda
-- UNA bolsa grande en lugar de varias chicas; y si la venta es de mostrador no
-- lleva bolsa. Nada de eso se puede expresar en una receta, que describe un
-- platillo y no una orden.
--
-- Lo que costaba el modelo anterior (8-jul al 8-ago, un mes):
--   Bolsas que descontaban las recetas ....... 2,775  ($12,393.53)
--   Bolsas reales con la regla por ticket ....  1,518  ($ 7,330.56)
--   Sobrecosto ............................... 1,257 bolsas y $5,062
-- Además esas bolsas fantasma se descontaron del inventario, así que también
-- alimentaban el problema de existencias negativas.
--
-- La regla acordada:
--   mostrador                    -> 0 bolsas
--   plataforma de domicilio      -> 1 bolsa
--                                   chica  si el pedido trae 1 o 2 productos
--                                   grande si trae 3 o más
--
-- Se modela como regla configurable y no como código, porque esto no se acaba en
-- la bolsa: servilletas, cubiertos y sellos de domicilio son el mismo caso.

-- ============================================================
-- 1) Las reglas
-- ============================================================
CREATE TABLE IF NOT EXISTS public.reglas_consumo_ticket (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre text NOT NULL,
  insumo_id uuid NOT NULL REFERENCES public.insumos(id),
  cantidad numeric NOT NULL DEFAULT 1 CHECK (cantidad > 0),
  -- Canales a los que aplica. NULL o vacío = todos.
  canales text[],
  -- Rango de productos del ticket (inclusivo). NULL = sin límite por ese lado.
  min_productos integer,
  max_productos integer,
  -- Dentro de un mismo grupo aplica UNA sola regla por ticket: es lo que permite
  -- que "bolsa chica" y "bolsa grande" sean excluyentes entre sí.
  grupo text,
  prioridad integer NOT NULL DEFAULT 100,
  activo boolean NOT NULL DEFAULT true,
  notas text,
  created_at timestamptz DEFAULT NOW(),
  updated_at timestamptz DEFAULT NOW(),
  CHECK (min_productos IS NULL OR max_productos IS NULL OR min_productos <= max_productos)
);

CREATE INDEX IF NOT EXISTS idx_reglas_ticket_activas
  ON public.reglas_consumo_ticket (activo) WHERE activo;

COMMENT ON TABLE public.reglas_consumo_ticket IS
  'Insumos que se consumen una vez por TICKET y no por platillo (bolsas, servilletas, cubiertos). El conector las evalúa por venta: descuenta el insumo y suma su costo a ventas.costo_teorico. Ver v7.19.';

COMMENT ON COLUMN public.reglas_consumo_ticket.canales IS
  'Canales a los que aplica la regla (ventas.canal). NULL o vacío = todos los canales.';

COMMENT ON COLUMN public.reglas_consumo_ticket.grupo IS
  'Reglas del mismo grupo son EXCLUYENTES: sólo aplica la primera que empate, por prioridad. Así "bolsa chica" y "bolsa grande" no se descuentan juntas.';

COMMENT ON COLUMN public.reglas_consumo_ticket.min_productos IS
  'Se cuentan las unidades de productos vendibles del ticket, excluyendo modificadores (grupo_sr MODS%/EXTRAS) y contenedores de precio marcados sin_insumos.';

-- ============================================================
-- 2) Respaldo de las líneas de bolsa que se retiran de las recetas
-- ============================================================
-- Se guardan antes de borrar para que la migración sea reversible.
CREATE TABLE IF NOT EXISTS public.recetas_retiradas_v7_19 (
  id uuid PRIMARY KEY,
  producto_venta_id uuid,
  insumo_id uuid,
  cantidad numeric,
  merma_pct numeric,
  motivo text,
  retirado_en timestamptz DEFAULT NOW()
);

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

-- ============================================================
-- 3) Las dos reglas de bolsa
-- ============================================================
INSERT INTO public.reglas_consumo_ticket
  (nombre, insumo_id, cantidad, canales, min_productos, max_productos, grupo, prioridad, notas)
SELECT 'Bolsa chica de domicilio', i.id, 1,
       ARRAY['ubereats','rappi','didi'], 1, 2, 'bolsa_domicilio', 10,
       'Pedido de plataforma con 1 o 2 productos. Mostrador no lleva bolsa.'
  FROM public.insumos i
 WHERE i.nombre = 'BOLSA DE PAPEL CHICA'
   AND NOT EXISTS (SELECT 1 FROM public.reglas_consumo_ticket x
                    WHERE x.grupo='bolsa_domicilio' AND x.insumo_id=i.id);

INSERT INTO public.reglas_consumo_ticket
  (nombre, insumo_id, cantidad, canales, min_productos, max_productos, grupo, prioridad, notas)
SELECT 'Bolsa grande de domicilio', i.id, 1,
       ARRAY['ubereats','rappi','didi'], 3, NULL, 'bolsa_domicilio', 10,
       'Pedido de plataforma con 3 productos o más: una grande en lugar de varias chicas.'
  FROM public.insumos i
 WHERE i.nombre = 'BOLSA DE PAPEL GRANDE'
   AND NOT EXISTS (SELECT 1 FROM public.reglas_consumo_ticket x
                    WHERE x.grupo='bolsa_domicilio' AND x.insumo_id=i.id);
