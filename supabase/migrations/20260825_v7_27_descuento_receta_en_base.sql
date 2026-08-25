-- v7.27 — El descuento por receta se muda a la BASE
--
-- ============================================================
-- POR QUÉ
-- ============================================================
-- v7.25 cambió `explotarReceta` en index.html para que las ventas descuenten la
-- PREPARACIÓN (su insumo espejo) en lugar de reventarla hasta sus ingredientes.
-- Pero `conector-sr/sync.js` tiene su PROPIA copia de esa función, y el conector
-- escribe el 100% de las ventas reales. Resultado medido el 25-ago: en el kárdex
-- del 23 al 25, ADEREZO RANCH 0, DIP DE AGUACATE 0, ARROZ AL VAPOR 0. El cambio
-- de v7.25 nunca se aplicó a una sola venta.
--
-- Peor: deja un DOBLE COBRO latente. En cuanto cocina registre una producción,
-- los ingredientes saldrían dos veces — una en la producción y otra en la venta.
--
-- Es el mismo error que v7.19c ya había resuelto para la regla de la bolsa, y que
-- dirección había señalado: "¿por qué cambia el conector, no es algo que puedes
-- hacer a partir de que llega?". La lógica se puso en la app, y la app no es quien
-- escribe las ventas.
--
-- ============================================================
-- CÓMO SE MIGRA SIN VENTANA DE RIESGO
-- ============================================================
-- El conector vive en la PC del punto de venta y no se puede actualizar hoy. Así
-- que la señal de "quién descuenta" viaja EN LOS DATOS: `ventas.origen`.
--
--   · origen = 'api'     → conector viejo. Él descuenta. El trigger NO hace nada.
--   · origen = 'api_v2'  → conector nuevo. Él ya no descuenta. El trigger sí.
--
-- Con eso el orden de despliegue deja de importar y no hay nada que "activar" a
-- mano en el momento justo:
--
--   HOY, al aplicar esta migración: todas las ventas entran como 'api', el
--   trigger las ignora y el comportamiento es idéntico al de hoy. Cero riesgo.
--
--   EL DÍA QUE SE REEMPLACE sync.js: los tickets nuevos entran como 'api_v2' y
--   el trigger toma el relevo solo, ticket por ticket. Para volver atrás basta
--   restaurar el sync.js viejo: los tickets vuelven a entrar como 'api'.
--
-- No se usó un candado del tipo "¿ya existen movimientos de esta venta?" porque
-- el conector inserta `venta_detalle` ANTES de descontar: en el momento en que
-- corre el trigger todavía no hay movimientos, así que ese candado no distinguiría
-- una cosa de la otra.

-- ============================================================
-- 1) El origen nuevo
-- ============================================================
ALTER TABLE public.ventas DROP CONSTRAINT IF EXISTS ventas_origen_check;
ALTER TABLE public.ventas ADD CONSTRAINT ventas_origen_check
  CHECK (origen::text = ANY (ARRAY['importado_sr','manual','api','api_v2']::text[]));

COMMENT ON COLUMN public.ventas.origen IS
  'importado_sr = pegado a mano desde un reporte de SR; manual = capturado en la app; api = conector viejo, que descuenta el inventario por su cuenta; api_v2 = conector nuevo, el descuento lo hace el trigger de la base (v7.27).';

-- ============================================================
-- 2) Costo unitario de un insumo, igual que costoInsumo() en la app
-- ============================================================
-- Manda el costo promedio de sucursal; si no hay, la presentación de compra más
-- barata por unidad base.
CREATE OR REPLACE FUNCTION public.fn_costo_insumo(p_insumo uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    NULLIF((SELECT MAX(s.costo_promedio) FROM public.inventario_sucursal s
             WHERE s.insumo_id = p_insumo), 0),
    (SELECT MIN(c.costo_referencia / NULLIF(c.contenido,0)) FROM public.catalogo c
      WHERE c.insumo_id = p_insumo AND c.costo_referencia > 0
        AND COALESCE(c.activo,true)),
    0);
$$;

-- ============================================================
-- 3) Costo de una línea de receta
-- ============================================================
-- Para un insumo, su costo. Para una PREPARACIÓN, el costo promedio de su espejo
-- —el que dejaron las tandas realmente producidas, que ya incorpora el
-- rendimiento real—. Mientras no haya producciones ni conteo, el espejo no tiene
-- costo promedio y se cae al cálculo teórico de siempre (receta ÷ rendimiento),
-- igual que hace `costoReceta` en la app. `p_prof` corta los ciclos.
CREATE OR REPLACE FUNCTION public.fn_costo_linea(p_insumo uuid, p_prep uuid, p_prof int DEFAULT 0)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_esp  uuid;
  v_real numeric;
  v_rend numeric;
  v_lote numeric;
BEGIN
  IF p_prof > 5 THEN RETURN 0; END IF;
  IF p_insumo IS NOT NULL THEN RETURN public.fn_costo_insumo(p_insumo); END IF;
  IF p_prep IS NULL THEN RETURN 0; END IF;

  SELECT id INTO v_esp FROM public.insumos WHERE preparacion_id = p_prep;
  IF v_esp IS NOT NULL THEN
    v_real := public.fn_costo_insumo(v_esp);
    IF v_real > 0 THEN RETURN v_real; END IF;
  END IF;

  SELECT COALESCE(NULLIF(rendimiento,0),1) INTO v_rend
    FROM public.productos_venta WHERE id = p_prep;
  SELECT COALESCE(SUM(r.cantidad * (1 + COALESCE(r.merma_pct,0)/100.0)
                      * public.fn_costo_linea(r.insumo_id, r.preparacion_id, p_prof + 1)), 0)
    INTO v_lote
    FROM public.recetas r WHERE r.producto_venta_id = p_prep;
  RETURN v_lote / COALESCE(NULLIF(v_rend,0),1);
END $$;

-- v7.27 (corregido en pruebas): el costo que va al KÁRDEX.
--
-- `fn_costo_insumo` sólo mira el costo promedio y las presentaciones de compra, y
-- un espejo de preparación no se compra: mientras no haya producciones ni conteo,
-- su costo promedio es 0. El costo por LÍNEA ya caía al teórico vía
-- `fn_costo_linea`, pero el movimiento de kárdex usaba la función simple y el
-- kárdex quedaba subvaluado — y el estado de resultados lee el kárdex. Se detectó
-- probando contra la base: ARROZ AL VAPOR y DIP DE AGUACATE salían en $0.
CREATE OR REPLACE FUNCTION public.fn_costo_insumo_o_espejo(p_insumo uuid)
RETURNS numeric LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_cu   numeric;
  v_prep uuid;
BEGIN
  v_cu := public.fn_costo_insumo(p_insumo);
  IF v_cu > 0 THEN RETURN v_cu; END IF;
  SELECT preparacion_id INTO v_prep FROM public.insumos WHERE id = p_insumo;
  IF v_prep IS NULL THEN RETURN 0; END IF;
  RETURN COALESCE(public.fn_costo_linea(NULL, v_prep), 0);
END $$;

-- Costo de la receta de UN producto vendido (por unidad).
CREATE OR REPLACE FUNCTION public.fn_costo_receta(p_producto uuid)
RETURNS numeric LANGUAGE sql STABLE AS $$
  SELECT COALESCE(SUM(r.cantidad * (1 + COALESCE(r.merma_pct,0)/100.0)
                      * public.fn_costo_linea(r.insumo_id, r.preparacion_id)), 0)
    FROM public.recetas r WHERE r.producto_venta_id = p_producto;
$$;

-- ============================================================
-- 4) El descuento por receta
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_consumo_receta() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v        record;
  c        record;
  v_suc    uuid;
  v_fecha  date;
  v_folio  text;
  v_origen text;
  v_total  numeric;
  v_inv    uuid;
  v_cu     numeric;
  v_nueva  numeric;
BEGIN
  FOR v IN SELECT DISTINCT venta_id FROM nuevas WHERE venta_id IS NOT NULL LOOP

    SELECT ve.origen, ve.sucursal_id, ve.fecha, COALESCE(ve.folio,'sin folio')
      INTO v_origen, v_suc, v_fecha, v_folio
      FROM public.ventas ve WHERE ve.id = v.venta_id;

    -- Sólo el conector nuevo. Con 'api' descuenta el conector; con
    -- 'importado_sr' o 'manual' descuenta la app.
    IF v_origen IS DISTINCT FROM 'api_v2' THEN CONTINUE; END IF;
    IF v_suc IS NULL THEN CONTINUE; END IF;

    -- Candado de idempotencia: si el conector reintenta el ticket, no se
    -- descuenta dos veces.
    --
    -- EXCLUYE los movimientos de la regla por ticket (la bolsa). Los dos triggers
    -- corren sobre la misma sentencia y el orden es alfabético, así que
    -- `trg_consumo_por_ticket` va ANTES; y la bolsa escribe con el mismo tipo
    -- 'salida_venta'. La primera versión del candado la veía, creía que la receta
    -- ya estaba descontada y se saltaba el ticket completo. Se detectó probando
    -- contra la base: sólo aparecía el movimiento de la bolsa.
    IF EXISTS (SELECT 1 FROM public.movimientos_sucursal m
                WHERE m.venta_id = v.venta_id AND m.tipo = 'salida_venta'
                  AND COALESCE(m.nota,'') NOT LIKE 'Consumo por ticket%') THEN
      CONTINUE;
    END IF;

    -- Costo de cada línea, para que la rentabilidad por ticket (v7.19) tenga con
    -- qué comparar el costo de materia prima contra el de las líneas.
    UPDATE public.venta_detalle d
       SET costo_teorico = ROUND(public.fn_costo_receta(d.producto_venta_id) * d.cantidad, 2)
     WHERE d.venta_id = v.venta_id;

    v_total := 0;

    -- Consumo agregado por insumo. Una línea de preparación descuenta su ESPEJO,
    -- no sus ingredientes: los ingredientes salen cuando cocina registra la
    -- producción (v7.25).
    FOR c IN
      SELECT ins_id, SUM(cant) AS cant FROM (
        SELECT COALESCE(r.insumo_id,
                 (SELECT i.id FROM public.insumos i WHERE i.preparacion_id = r.preparacion_id)) AS ins_id,
               d.cantidad * r.cantidad * (1 + COALESCE(r.merma_pct,0)/100.0) AS cant
          FROM nuevas d
          JOIN public.recetas r ON r.producto_venta_id = d.producto_venta_id
         WHERE d.venta_id = v.venta_id
      ) z
      WHERE ins_id IS NOT NULL
      GROUP BY ins_id
    LOOP
      v_cu := public.fn_costo_insumo_o_espejo(c.ins_id);

      SELECT id INTO v_inv FROM public.inventario_sucursal
       WHERE sucursal_id = v_suc AND insumo_id = c.ins_id;
      IF v_inv IS NULL THEN
        INSERT INTO public.inventario_sucursal (sucursal_id, insumo_id, existencia, costo_promedio)
        VALUES (v_suc, c.ins_id, 0, v_cu)
        RETURNING id INTO v_inv;
      END IF;

      SELECT ROUND(existencia - c.cant, 3) INTO v_nueva
        FROM public.inventario_sucursal WHERE id = v_inv;
      UPDATE public.inventario_sucursal
         SET existencia = v_nueva, updated_at = NOW()
       WHERE id = v_inv;

      INSERT INTO public.movimientos_sucursal
        (sucursal_id, insumo_id, tipo, cantidad, costo_unitario, venta_id, fecha, nota, registrado_por)
      VALUES (v_suc, c.ins_id, 'salida_venta', ROUND(c.cant,3), v_cu, v.venta_id,
              v_fecha, 'Venta ' || v_folio, 'trigger-v7.27');

      v_total := v_total + ROUND(c.cant * v_cu, 2);
    END LOOP;

    -- Se SUMA, no se asigna: el trigger de la bolsa (v7.19c) corre sobre la misma
    -- sentencia y también suma su parte. Sumando, el orden entre los dos triggers
    -- deja de importar. El conector nuevo manda costo_teorico = 0.
    IF v_total <> 0 THEN
      UPDATE public.ventas
         SET costo_teorico = ROUND(COALESCE(costo_teorico,0) + v_total, 2)
       WHERE id = v.venta_id;
    END IF;

  END LOOP;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.fn_consumo_receta() IS
  'Descuenta los insumos de la receta cuando llega el detalle de una venta con origen api_v2, escribe el kárdex y suma el costo a ventas.costo_teorico y a venta_detalle.costo_teorico. Vive en la base para que el conector no tenga que replicar la lógica de costeo (v7.27).';

DROP TRIGGER IF EXISTS trg_consumo_receta ON public.venta_detalle;
CREATE TRIGGER trg_consumo_receta
AFTER INSERT ON public.venta_detalle
REFERENCING NEW TABLE AS nuevas
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_consumo_receta();

-- ============================================================
-- 5) Permisos
-- ============================================================
-- LECCIÓN DE v7.20: la tabla y el trigger de consumo por ticket se probaron como
-- administrador, faltó el GRANT para `anon` y el conector estuvo 44 horas sin
-- subir ventas. Cualquier objeto que el conector o la app usen se verifica con
-- `SET LOCAL ROLE anon;` ANTES de darlo por bueno.
GRANT EXECUTE ON FUNCTION public.fn_costo_insumo(uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_costo_linea(uuid, uuid, int)  TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_costo_receta(uuid)            TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_costo_insumo_o_espejo(uuid)   TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_consumo_receta()              TO anon, authenticated;
