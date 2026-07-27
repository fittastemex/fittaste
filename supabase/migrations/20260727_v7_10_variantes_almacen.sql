-- v7.10 — Variantes de almacén: un insumo, varios buckets de inventario
--
-- Problema que resuelve:
-- El desglose de los vasos por branding (Fit Taste / Sin Logo / Navidad /
-- Halloween) creó SKU nuevos en inventario_almacen, pero catalogo.inventario_
-- almacen_id es uno a uno: solo el SKU base queda ligado a la presentación de
-- compra y al insumo. Resultado: la sucursal solo puede pedir la variante base
-- y PEPS solo descuenta de ella. Cuando la base llega a 0 el sistema reporta
-- "sin stock" aunque haya cientos de vasos de temporada físicamente en el
-- almacén — inventario real que el sistema no puede usar.
--
-- Solución:
-- `variante_de` agrupa varios SKU de almacén bajo un SKU base. La sucursal
-- sigue pidiendo el insumo normal (p. ej. "VASO 16 OZ TIPO CRISTAL") y el
-- almacén surte del grupo completo: la existencia disponible es la suma del
-- grupo y el descuento PEPS recorre los lotes de todas las variantes por
-- antigüedad (o de una variante específica si el almacenista la fuerza).
--
-- Un solo nivel de anidamiento: una variante no puede tener variantes.

ALTER TABLE public.inventario_almacen
  ADD COLUMN IF NOT EXISTS variante_de uuid REFERENCES public.inventario_almacen(id);

CREATE INDEX IF NOT EXISTS idx_inventario_almacen_variante_de
  ON public.inventario_almacen(variante_de);

COMMENT ON COLUMN public.inventario_almacen.variante_de IS
  'SKU base del que este producto es variante (mismo insumo, distinto branding/empaque). NULL = es base. Solo un nivel: una variante no puede tener variantes.';

-- Evita cadenas de variantes (A -> B -> C) y auto-referencia
CREATE OR REPLACE FUNCTION public.fn_valida_variante_almacen()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.variante_de IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.variante_de = NEW.id THEN
    RAISE EXCEPTION 'Un producto no puede ser variante de sí mismo';
  END IF;
  IF EXISTS (SELECT 1 FROM inventario_almacen WHERE id = NEW.variante_de AND variante_de IS NOT NULL) THEN
    RAISE EXCEPTION 'El SKU base ya es una variante: solo se permite un nivel de agrupación';
  END IF;
  IF EXISTS (SELECT 1 FROM inventario_almacen WHERE variante_de = NEW.id) THEN
    RAISE EXCEPTION 'Este producto ya tiene variantes propias: no puede volverse variante de otro';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_valida_variante_almacen ON public.inventario_almacen;
CREATE TRIGGER trg_valida_variante_almacen
  BEFORE INSERT OR UPDATE OF variante_de ON public.inventario_almacen
  FOR EACH ROW EXECUTE FUNCTION public.fn_valida_variante_almacen();

-- Agrupación inicial: las variantes de vaso creadas el 2026-07-27
UPDATE public.inventario_almacen
   SET variante_de = (SELECT id FROM public.inventario_almacen WHERE sku='MP023')
 WHERE sku IN ('MP043','MP044','MP045');

UPDATE public.inventario_almacen
   SET variante_de = (SELECT id FROM public.inventario_almacen WHERE sku='MP030')
 WHERE sku IN ('MP046');
