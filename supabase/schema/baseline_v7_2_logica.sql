-- ============================================================
-- Fit Taste — Lógica de base de datos (funciones, triggers, vistas)
-- Extraído de producción (estado v7.2). Ejecutar DESPUÉS de
-- baseline_v7_2.sql al replicar el esquema en DEV/staging.
-- ============================================================

-- ---------- FUNCIONES ----------

CREATE OR REPLACE FUNCTION public.fn_generar_serial_pedido()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    fecha_str TEXT;
    consecutivo INT;
    nuevo_serial TEXT;
BEGIN
    fecha_str := TO_CHAR(NEW.fecha, 'YYYYMMDD');
    SELECT COUNT(*) + 1 INTO consecutivo
    FROM pedidos
    WHERE numero_pedido LIKE 'PED-' || fecha_str || '-%'
    AND id != NEW.id;
    nuevo_serial := 'PED-' || fecha_str || '-' || LPAD(consecutivo::TEXT, 3, '0');
    NEW.numero_pedido := nuevo_serial;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_sync_existencia_lotes()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv_id UUID;
  v_total NUMERIC;
BEGIN
  -- Determinar qué inventario_id actualizar
  v_inv_id := COALESCE(NEW.inventario_id, OLD.inventario_id);

  -- Recalcular existencia real desde lotes
  SELECT COALESCE(SUM(existencia_restante), 0) INTO v_total
  FROM lotes_almacen WHERE inventario_id = v_inv_id;

  -- Actualizar inventario
  UPDATE inventario_almacen SET existencia = v_total WHERE id = v_inv_id;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_lote_entrada_peps()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    -- Poner existencia_restante = cantidad si no se especificó
    IF NEW.existencia_restante IS NULL THEN
        NEW.existencia_restante = NEW.cantidad;
    END IF;
    -- Actualizar existencia total del producto
    UPDATE inventario_almacen
    SET existencia = existencia + NEW.cantidad,
        costo_unitario_actual = NEW.costo_unitario + NEW.iva,
        updated_at = NOW()
    WHERE id = NEW.inventario_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_lote_entrada()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    UPDATE inventario_almacen
    SET existencia = existencia + NEW.cantidad,
        costo_unitario_actual = NEW.costo_unitario + NEW.iva + NEW.sobreprecio_transporte,
        updated_at = NOW()
    WHERE id = NEW.inventario_id;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_auto_inventario_almacen()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_tipo_flujo TEXT;
  v_nuevo_inv_id UUID;
  v_unidad_id UUID;
BEGIN
  -- Solo actuar si cambió el proveedor o es INSERT nuevo
  IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND OLD.proveedor_id IS DISTINCT FROM NEW.proveedor_id) THEN

    -- Verificar si el nuevo proveedor es tipo "Almacen interno"
    SELECT tf.nombre INTO v_tipo_flujo
    FROM proveedores p
    JOIN tipos_flujo_costo tf ON p.tipo_flujo_id = tf.id
    WHERE p.id = NEW.proveedor_id;

    IF v_tipo_flujo = 'Almacen interno' AND NEW.inventario_almacen_id IS NULL THEN
      -- Obtener unidad_id del producto
      v_unidad_id := NEW.unidad_id;

      -- Crear registro en inventario_almacen
      INSERT INTO inventario_almacen (sku, descripcion, unidad_id, existencia, costo_unitario_actual)
      VALUES (NEW.sku, UPPER(TRIM(NEW.articulo)), v_unidad_id, 0, COALESCE(NEW.costo_referencia, 0))
      RETURNING id INTO v_nuevo_inv_id;

      -- Vincular automáticamente
      NEW.inventario_almacen_id := v_nuevo_inv_id;

    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_catalogo_audit()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF OLD.costo_referencia IS DISTINCT FROM NEW.costo_referencia THEN
        INSERT INTO catalogo_historial (catalogo_id, campo_modificado, valor_anterior, valor_nuevo, modificado_por)
        VALUES (NEW.id, 'costo_referencia', OLD.costo_referencia::TEXT, NEW.costo_referencia::TEXT, NEW.actualizado_por);
    END IF;
    IF OLD.proveedor_id IS DISTINCT FROM NEW.proveedor_id THEN
        INSERT INTO catalogo_historial (catalogo_id, campo_modificado, valor_anterior, valor_nuevo, modificado_por)
        VALUES (NEW.id, 'proveedor_id', OLD.proveedor_id::TEXT, NEW.proveedor_id::TEXT, NEW.actualizado_por);
    END IF;
    IF OLD.activo IS DISTINCT FROM NEW.activo THEN
        INSERT INTO catalogo_historial (catalogo_id, campo_modificado, valor_anterior, valor_nuevo, modificado_por)
        VALUES (NEW.id, 'activo', OLD.activo::TEXT, NEW.activo::TEXT, NEW.actualizado_por);
    END IF;
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_movimiento_stock()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
    IF NEW.tipo = 'salida' THEN
        UPDATE inventario_almacen
        SET existencia = existencia - NEW.cantidad, updated_at = NOW()
        WHERE id = NEW.inventario_id;
    ELSIF NEW.tipo = 'entrada' THEN
        UPDATE inventario_almacen
        SET existencia = existencia + NEW.cantidad, updated_at = NOW()
        WHERE id = NEW.inventario_id;
    END IF;
    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.fn_pago_registrado()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
    total_pagado DECIMAL(12,2);
    monto_cuenta DECIMAL(12,2);
BEGIN
    SELECT COALESCE(SUM(monto_pagado), 0) INTO total_pagado
    FROM pagos WHERE cuenta_id = NEW.cuenta_id;

    SELECT monto_total INTO monto_cuenta
    FROM cuentas_por_pagar WHERE id = NEW.cuenta_id;

    UPDATE cuentas_por_pagar
    SET estatus = CASE
        WHEN total_pagado >= monto_cuenta THEN 'pagado'
        WHEN total_pagado > 0 THEN 'parcial'
        ELSE 'pendiente'
    END
    WHERE id = NEW.cuenta_id;

    RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_user_rol()
 RETURNS text
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT rol FROM usuarios WHERE auth_id = auth.uid();
$function$;

CREATE OR REPLACE FUNCTION public.get_user_proveedor_id()
 RETURNS uuid
 LANGUAGE sql
 SECURITY DEFINER
AS $function$
    SELECT proveedor_id FROM usuarios WHERE auth_id = auth.uid();
$function$;

-- ---------- TRIGGERS ----------

CREATE TRIGGER trg_serial_pedido BEFORE INSERT ON public.pedidos FOR EACH ROW EXECUTE FUNCTION fn_generar_serial_pedido();
CREATE TRIGGER trg_lote_entrada_peps BEFORE INSERT ON public.lotes_almacen FOR EACH ROW EXECUTE FUNCTION fn_lote_entrada_peps();
CREATE TRIGGER trg_sync_existencia AFTER INSERT OR DELETE OR UPDATE ON public.lotes_almacen FOR EACH ROW EXECUTE FUNCTION fn_sync_existencia_lotes();
CREATE TRIGGER trg_auto_inventario_almacen BEFORE INSERT OR UPDATE ON public.catalogo FOR EACH ROW EXECUTE FUNCTION fn_auto_inventario_almacen();
CREATE TRIGGER trg_movimiento_stock AFTER INSERT ON public.movimientos_almacen FOR EACH ROW EXECUTE FUNCTION fn_movimiento_stock();
CREATE TRIGGER trg_pago_registrado AFTER INSERT ON public.pagos FOR EACH ROW EXECUTE FUNCTION fn_pago_registrado();
CREATE TRIGGER trg_catalogo_audit BEFORE UPDATE ON public.catalogo FOR EACH ROW EXECUTE FUNCTION fn_catalogo_audit();

-- ---------- VISTAS ----------

CREATE OR REPLACE VIEW public.v_lotes_activos AS
 SELECT l.id AS lote_id,
    l.inventario_id,
    i.sku,
    i.descripcion,
    l.fecha_entrada,
    l.cantidad AS cantidad_original,
    l.existencia_restante,
    l.costo_unitario,
    l.iva,
    l.costo_total_unitario,
    (l.existencia_restante * l.costo_total_unitario) AS valor_lote,
    l.proveedor_origen,
    l.nota
   FROM (lotes_almacen l
     JOIN inventario_almacen i ON ((i.id = l.inventario_id)))
  WHERE (l.existencia_restante > (0)::numeric)
  ORDER BY i.sku, l.fecha_entrada;

CREATE OR REPLACE VIEW public.v_inventario_peps AS
 SELECT i.id,
    i.sku,
    i.descripcion,
    u.clave AS unidad,
    i.existencia,
        CASE
            WHEN (i.existencia > (0)::numeric) THEN COALESCE(( SELECT (sum((l.existencia_restante * l.costo_total_unitario)) / NULLIF(sum(l.existencia_restante), (0)::numeric))
               FROM lotes_almacen l
              WHERE ((l.inventario_id = i.id) AND (l.existencia_restante > (0)::numeric))), i.costo_unitario_actual)
            ELSE i.costo_unitario_actual
        END AS costo_promedio_peps,
        CASE
            WHEN (i.existencia > (0)::numeric) THEN COALESCE(( SELECT sum((l.existencia_restante * l.costo_total_unitario)) AS sum
               FROM lotes_almacen l
              WHERE ((l.inventario_id = i.id) AND (l.existencia_restante > (0)::numeric))), (0)::numeric)
            ELSE (0)::numeric
        END AS valor_total_peps,
    ( SELECT count(*) AS count
           FROM lotes_almacen l
          WHERE ((l.inventario_id = i.id) AND (l.existencia_restante > (0)::numeric))) AS num_lotes_activos,
    i.lead_time
   FROM (inventario_almacen i
     JOIN unidades_medida u ON ((u.id = i.unidad_id)))
  ORDER BY i.sku;
