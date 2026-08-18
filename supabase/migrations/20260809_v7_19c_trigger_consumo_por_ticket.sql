-- v7.19c — La regla de consumo por ticket se aplica en la BASE, no en el conector
--
-- Corrección de diseño pedida por dirección (2026-08-09): "¿por qué cambia el
-- conector, no es algo que puedes hacer a partir de que llega? hoy el conector ya
-- tiene el ticket y el canal."
--
-- Tenía razón. La primera versión metía la regla en conector-sr/sync.js, lo que
-- traía dos problemas:
--
--   1. Obligaba a ir a la PC del punto de venta a copiar el archivo a mano. Hasta
--      entonces las bolsas no se contaban en absoluto, porque ya salieron de las
--      recetas (v7.19b).
--   2. Dejaba fuera la SEGUNDA puerta de entrada: la importación manual de
--      reportes de SR desde la app (Ventas → Importar de SR) escribe ventas sin
--      pasar por el conector, así que esas ventas nunca habrían llevado bolsa.
--
-- Aplicándola donde LLEGAN los datos, las dos puertas quedan cubiertas y el
-- conector se queda tal cual. También deja una sola copia de la lógica en vez de
-- tres (app, conector, recosteo).
--
-- Contrapartida asumida a conciencia: un trigger que falle no grita, y el arnés de
-- pruebas E2E simula la base y no ejecuta triggers — así que esta lógica se
-- verifica contra la base real, no con la batería del navegador.

-- ============================================================
-- 1) El rollback del conector no debe romperse
-- ============================================================
-- Cuando el conector no logra subir el detalle completo, BORRA la venta para
-- reintentarla. Si el trigger ya escribió el movimiento de la bolsa, ese borrado
-- fallaría por la llave foránea y el ticket se reintentaría para siempre.
--
-- Nota: la cascada se lleva el movimiento pero NO devuelve la existencia al
-- inventario. Es una ventana rara (sólo si el detalle se inserta y aun así el
-- conector decide revertir) y el conteo físico es el respaldo.
ALTER TABLE public.movimientos_sucursal
  DROP CONSTRAINT IF EXISTS movimientos_sucursal_venta_id_fkey;
ALTER TABLE public.movimientos_sucursal
  ADD CONSTRAINT movimientos_sucursal_venta_id_fkey
    FOREIGN KEY (venta_id) REFERENCES public.ventas(id) ON DELETE CASCADE;

-- ============================================================
-- 2) La regla
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_consumo_por_ticket() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v        record;
  reg      record;
  v_n      numeric;
  v_canal  text;
  v_suc    uuid;
  v_costo  numeric;
  v_extra  numeric;
  v_inv_id uuid;
BEGIN
  FOR v IN SELECT DISTINCT venta_id FROM nuevas WHERE venta_id IS NOT NULL LOOP

    -- Candado de idempotencia: si el conector reintenta el ticket, la bolsa no se
    -- descuenta dos veces.
    IF EXISTS (SELECT 1 FROM public.movimientos_sucursal m
                WHERE m.venta_id = v.venta_id AND m.nota LIKE 'Consumo por ticket%') THEN
      CONTINUE;
    END IF;

    SELECT COALESCE(ve.canal,'mostrador'), ve.sucursal_id
      INTO v_canal, v_suc
      FROM public.ventas ve WHERE ve.id = v.venta_id;
    IF v_suc IS NULL THEN CONTINUE; END IF;

    -- Unidades de productos vendibles del ticket. No cuentan los modificadores
    -- (no ocupan lugar en la bolsa) ni los contenedores de precio marcados
    -- sin_insumos (un combo cobra, pero lo que se empaca son sus componentes, que
    -- ya vienen como líneas aparte).
    SELECT COALESCE(SUM(CASE WHEN COALESCE(pv.grupo_sr,'') LIKE 'MODS%'
                               OR COALESCE(pv.grupo_sr,'') = 'EXTRAS'
                               OR COALESCE(pv.sin_insumos,false)
                             THEN 0 ELSE d.cantidad END),0)
      INTO v_n
      FROM public.venta_detalle d
      LEFT JOIN public.productos_venta pv ON pv.id = d.producto_venta_id
     WHERE d.venta_id = v.venta_id;

    v_extra := 0;

    -- Reglas que empatan. Las de un mismo `grupo` son EXCLUYENTES: gana la de
    -- menor prioridad, para que bolsa chica y bolsa grande no se descuenten
    -- juntas. Las reglas sin grupo caen cada una en su propia partición, así que
    -- todas sobreviven y se suman (servilleta + cubiertos).
    FOR reg IN
      SELECT insumo_id, cantidad FROM (
        SELECT r.id, r.insumo_id, r.cantidad,
               ROW_NUMBER() OVER (PARTITION BY COALESCE(r.grupo, r.id::text)
                                  ORDER BY r.prioridad, r.id) AS rn
          FROM public.reglas_consumo_ticket r
         WHERE r.activo
           AND (r.canales IS NULL OR CARDINALITY(r.canales) = 0 OR v_canal = ANY(r.canales))
           AND (r.min_productos IS NULL OR v_n >= r.min_productos)
           AND (r.max_productos IS NULL OR v_n <= r.max_productos)
      ) z WHERE rn = 1
    LOOP
      -- Mismo criterio que costoInsumo() en la app: manda el costo promedio de
      -- sucursal; si no hay, la presentación de compra más barata por unidad base.
      SELECT COALESCE(
               NULLIF((SELECT MAX(s.costo_promedio) FROM public.inventario_sucursal s
                        WHERE s.insumo_id = reg.insumo_id),0),
               (SELECT MIN(c.costo_referencia / NULLIF(c.contenido,0)) FROM public.catalogo c
                 WHERE c.insumo_id = reg.insumo_id AND c.costo_referencia > 0
                   AND COALESCE(c.activo,true)),
               0)
        INTO v_costo;

      SELECT id INTO v_inv_id FROM public.inventario_sucursal
       WHERE sucursal_id = v_suc AND insumo_id = reg.insumo_id;
      IF v_inv_id IS NULL THEN
        INSERT INTO public.inventario_sucursal (sucursal_id, insumo_id, existencia, costo_promedio)
        VALUES (v_suc, reg.insumo_id, 0, v_costo)
        RETURNING id INTO v_inv_id;
      END IF;

      UPDATE public.inventario_sucursal
         SET existencia = ROUND(existencia - reg.cantidad, 3), updated_at = NOW()
       WHERE id = v_inv_id;

      INSERT INTO public.movimientos_sucursal
        (sucursal_id, insumo_id, tipo, cantidad, costo_unitario, venta_id, fecha, nota, registrado_por)
      SELECT v_suc, reg.insumo_id, 'salida_venta', reg.cantidad, v_costo, v.venta_id,
             ve.fecha, 'Consumo por ticket · ' || COALESCE(ve.folio,'sin folio'), 'trigger-v7.19'
        FROM public.ventas ve WHERE ve.id = v.venta_id;

      v_extra := v_extra + ROUND(reg.cantidad * v_costo, 2);
    END LOOP;

    -- Se SUMA al costo que ya calculó quien escribió la venta, en lugar de
    -- recalcularlo: así no importa si el detalle llegó en uno o varios lotes.
    IF v_extra <> 0 THEN
      UPDATE public.ventas
         SET costo_teorico = ROUND(COALESCE(costo_teorico,0) + v_extra, 2)
       WHERE id = v.venta_id;
    END IF;

  END LOOP;
  RETURN NULL;
END $$;

COMMENT ON FUNCTION public.fn_consumo_por_ticket() IS
  'Aplica reglas_consumo_ticket cuando llega el detalle de una venta: descuenta el insumo, escribe el kárdex y suma su costo a ventas.costo_teorico. Vive en la base para cubrir por igual al conector y a la importación manual, sin depender de desplegar nada en la PC del punto de venta (v7.19c).';

-- Trigger a nivel SENTENCIA con tabla de transición: el conector y la app
-- insertan todo el detalle de un ticket en un solo POST, así que corre una vez por
-- ticket y ve todas sus líneas.
DROP TRIGGER IF EXISTS trg_consumo_por_ticket ON public.venta_detalle;
CREATE TRIGGER trg_consumo_por_ticket
AFTER INSERT ON public.venta_detalle
REFERENCING NEW TABLE AS nuevas
FOR EACH STATEMENT
EXECUTE FUNCTION public.fn_consumo_por_ticket();
