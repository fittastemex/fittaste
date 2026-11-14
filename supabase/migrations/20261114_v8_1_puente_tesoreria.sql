-- ============================================================================
-- v8.1 — El puente hacia Tesorería
-- ============================================================================
-- Expone a Tesorería lo que esta app sabe de pedidos, recepciones y compras
-- directas, para que una factura pueda amarrarse a la mercancía que cubre.
--
-- Requiere la v8.0 (catálogo único) aplicada: sin ella no hay RFC ni token
-- de proveedor del lado operativo.
--
-- LA LLAVE DE CRUCE DEPENDE DEL TIPO DE FLUJO DEL PROVEEDOR
--
-- De nuestro lado hay UNA sola cifra: importe_recibido = cantidad recibida ×
-- costo capturado. Lo que cambia es contra QUÉ campo del CFDI se compara, y
-- eso lo decide cómo se captura el precio:
--
--   Commodity       el proveedor captura precios NETOS, sin IVA.
--                   → cotejar contra  cfdi.subtotal − coalesce(cfdi.descuento,0)
--
--   Compra manual   compras va a la tienda y captura el precio de MOSTRADOR,
--                   que ya trae IVA incluido.
--                   → cotejar contra  cfdi.total
--
-- La vista trae la columna `cotejar_contra` ya resuelta, para que Tesorería no
-- tenga que replicar esta regla.
--
-- POR QUÉ NO ES UNA SOLA LLAVE — medido, no supuesto:
--
--   Juan Carlos (Commodity), 11 facturas: 8 empatan AL CENTAVO contra el
--   subtotal de un solo pedido, y una novena contra dos pedidos —
--   CFDI 145 ($5,988) = PED-20260929-001 ($5,908) + PED-20260929-002 ($80) —
--   que es justo por lo que la tabla de enlace tiene que ser de muchos a muchos.
--
--   Walmart (Compra manual), 8 facturas de octubre: contra subtotal−descuento
--   empata 1; contra el total empata 4. Ejemplos del total:
--     CFDI 605285 · $1,375.01  =  PED-20261026-001 · $1,375.00
--     CFDI 603312 · $1,440.01  =  PED-20261019-001 · $1,440.00
--     CFDI 605300 · $  812.01  =  PED-20261022-002 · $  812.00
--
--   Y el descuento de Walmart ya viene restado DENTRO del total, así que
--   restarlo otra vez del subtotal aleja el número en vez de acercarlo:
--     CFDI 603311: subtotal 1,203.91 − descuento 75.00 = 1,128.91,
--                  pero el total es 1,158.01. La diferencia es el IVA.
--
-- LO QUE NO SIRVE PARA COTEJAR: nuestro IVA estimado. Multiplicábamos por 1.16
-- lo que trae catalogo.aplica_iva marcado. Eso es invención nuestra y además
-- sería doble IVA en Compra manual. Esas columnas no se exponen.
--
-- CUATRO OBJETOS, DOS PÚBLICOS DISTINTOS
--
--   v_pedidos_tesoreria           → pantallas internas de finanzas (authenticated)
--   v_compras_directas_tesoreria  → ídem
--   v_traspasos_cedis_tesoreria   → ídem; CEDIS → ROMA a costo PEPS real
--   fn_pedidos_por_facturar(tok)  → el PORTAL DEL PROVEEDOR
--
-- Por qué una función y no una vista para el portal: no existe ni una sola
-- política RLS para el rol `anon` en las tablas tes_*, ni edge functions, ni
-- RPC con token. Exponer una vista abierta dejaría que Juan Carlos viera los
-- pedidos de Yerina. La función recibe el token del proveedor y devuelve
-- ÚNICAMENTE lo suyo: el token es la autorización, así que sirve sea cual sea
-- el rol con el que el portal se conecte.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 1. Vista de pedidos, al grano (pedido × proveedor)
-- ---------------------------------------------------------------------------
-- Un pedido nuestro es la compra del día completa y se reparte entre varios
-- proveedores. El renglón que se factura y se paga es la pareja, y eso ya
-- existe: pedido_proveedor_estatus, único por (pedido, proveedor).
create or replace view v_pedidos_tesoreria as
with linea as (
  select ppe.id as ppe_id,
         pd.id  as pd_id,
         pd.cantidad,
         coalesce(pd.costo_real, pd.costo_referencia) as cu
    from pedido_proveedor_estatus ppe
    join pedido_detalle pd
      on pd.pedido_id    = ppe.pedido_id
     and pd.proveedor_id = ppe.proveedor_id
), recibido as (
  select pedido_detalle_id, sum(cantidad_recibida) as q
    from recepcion_detalle group by 1
)
select
  ppe.id::text                                               as pedido_id,
  p.numero_pedido                                            as pedido_folio,
  p.fecha                                                    as fecha_pedido,
  tp.id                                                      as proveedor_id,
  tp.rfc                                                     as proveedor_rfc,
  tp.nombre                                                  as proveedor_nombre,
  tp.alias_cocina                                            as proveedor_alias,
  'ROMA'::text                                               as centro,

  -- LA CIFRA. Es el costo tal como se capturó: neto de IVA si el proveedor
  -- es Commodity, con IVA incluido si es Compra manual. Por eso no se llama
  -- "subtotal": sería mentira para Walmart.
  round(sum(l.cantidad * l.cu)::numeric, 2)                  as importe_pedido,
  round(sum(coalesce(r.q,0) * l.cu)::numeric, 2)             as importe_recibido,

  tf.nombre                                                  as tipo_flujo,
  -- Contra qué campo del CFDI comparar importe_recibido. Resuelto aquí para
  -- que Tesorería no tenga que replicar la regla.
  case tf.nombre
    when 'Compra manual' then 'cfdi.total'
    when 'Commodity'     then 'cfdi.subtotal - coalesce(cfdi.descuento,0)'
    else 'revisar'
  end                                                        as cotejar_contra,

  ppe.estatus                                                as estatus,
  -- 'completo' y 'recibido_completo' significan lo mismo: son versiones
  -- distintas de esta app. Tesorería no tiene por qué cargar con eso.
  (ppe.estatus in ('recibido_completo','completo','recibido_con_faltantes'))
                                                             as recibido,
  (select max(x.fecha_recepcion)::date from recepciones x
    where x.pedido_id    = ppe.pedido_id
      and x.proveedor_id = ppe.proveedor_id)                 as fecha_recepcion,
  coalesce(tp.es_interno, false)                             as es_traspaso_interno
from pedido_proveedor_estatus ppe
join pedidos p          on p.id  = ppe.pedido_id
join tes_proveedores tp on tp.id = ppe.proveedor_id
left join tipos_flujo_costo tf on tf.id = tp.tipo_flujo_id
join linea l            on l.ppe_id = ppe.id
left join recibido r    on r.pedido_detalle_id = l.pd_id
group by ppe.id, p.numero_pedido, p.fecha, tp.id, tp.rfc, tp.nombre,
         tp.alias_cocina, ppe.estatus, ppe.pedido_id, ppe.proveedor_id,
         tp.es_interno, tf.nombre;

comment on view v_pedidos_tesoreria is
  'Contrato de solo lectura para Tesorería. Grano: (pedido × proveedor). '
  'Emparejar CFDI contra importe_recibido, usando el campo que diga la columna '
  'cotejar_contra: cfdi.total para Compra manual (el precio capturado ya trae '
  'IVA) y cfdi.subtotal menos descuento para Commodity. '
  'Filtrar es_traspaso_interno = false: eso es el CEDIS surtiendo a sucursal, '
  'y va valuado aparte en v_traspasos_cedis_tesoreria, a costo PEPS.';

-- ---------------------------------------------------------------------------
-- 2. Vista de compras directas
-- ---------------------------------------------------------------------------
-- Cuando cocina compra sin pedido previo. Las de transferencia y tarjeta ya
-- salieron del banco, así que a Tesorería le llegan como cargos sin explicar.
create or replace view v_compras_directas_tesoreria as
select
  cd.id::text                                        as compra_id,
  cd.fecha                                           as fecha_compra,
  tp.id                                              as proveedor_id,
  tp.rfc                                             as proveedor_rfc,
  tp.nombre                                          as proveedor_nombre,
  tp.alias_cocina                                    as proveedor_alias,
  'ROMA'::text                                       as centro,
  round(cd.costo_total::numeric,2)                   as total,
  cd.metodo_pago                                     as metodo_pago,
  tf.nombre                                          as tipo_flujo,
  -- true = ya salió del banco, Tesorería debería tener el cargo
  (cd.metodo_pago in ('transferencia','tarjeta'))    as toca_banco,
  cd.nota                                            as nota,
  cd.registrado_por                                  as registrado_por
from compras_directas cd
join tes_proveedores tp on tp.id = cd.proveedor_id
left join tipos_flujo_costo tf on tf.id = tp.tipo_flujo_id;

comment on view v_compras_directas_tesoreria is
  'Compras que la sucursal hace sin pedido previo. toca_banco = true son las '
  'que ya salieron por transferencia o tarjeta y llegan al estado de cuenta. '
  'El total se captura tal cual lo pagó la sucursal, así que normalmente ya '
  'trae IVA: cotejar contra cfdi.total, no contra el subtotal.';

-- ---------------------------------------------------------------------------
-- 2b. Vista de traspasos CEDIS → ROMA
-- ---------------------------------------------------------------------------
-- Para Tesorería, CEDIS ES el almacén: un centro de costos, no un proveedor.
-- El "Almacen" que esta app registra como proveedor es ese centro surtiendo a
-- la sucursal, y Tesorería ya lo contabiliza como movimiento de costo entre
-- centros contra la caja INVENTARIO_CEDIS, sin flujo de efectivo.
--
-- OJO CON EL VALOR, PORQUE HAY DOS Y NO SON EL MISMO:
--   · el del pedido  = cantidad recibida × costo del pedido_detalle
--   · el PEPS        = lo que de verdad costaron esos lotes al salir
--
-- En meses estables coinciden al centavo (ago: $26,431.26 vs $26,431.27;
-- sep: $20,394.87 en ambos). Donde difieren es por CORTE DE FECHA: salió del
-- almacén en octubre y se recibió en sucursal en noviembre, así que octubre
-- da +$6,030 y noviembre −$6,344, compensándose.
--
-- Para contabilidad entre centros el bueno es el PEPS, cortado por la fecha
-- de SALIDA del almacén. Por eso esta vista existe aparte de la de pedidos.
--
-- ADVERTENCIA: julio de 2026 trae +$78,069 que NO se compensan con ningún
-- otro mes ($112,374 PEPS contra $34,305 del pedido). Coincide con la
-- migración de variantes y unidades de ese mes. No lo tomen como bueno sin
-- revisarlo.
create or replace view v_traspasos_cedis_tesoreria as
with valor_pedido as (
  -- lo que el pedido le cobró a sucursal por ese mismo renglón, para poder
  -- separar el efecto de VALUACIÓN del de CORTE DE FECHA
  select pd.pedido_id, cat.inventario_almacen_id as inv_id,
         sum(coalesce(r.q,0) * coalesce(pd.costo_real, pd.costo_referencia)) as valor
    from pedido_detalle pd
    join tes_proveedores tp on tp.id = pd.proveedor_id
                           and coalesce(tp.es_interno,false)
    join catalogo cat on cat.id = pd.catalogo_id
    left join (select pedido_detalle_id, sum(cantidad_recibida) q
                 from recepcion_detalle group by 1) r on r.pedido_detalle_id = pd.id
   group by 1,2
)
select
  m.id::text                                   as traspaso_id,
  m.fecha                                      as fecha_salida,
  -- las DOS fechas. Devengar por fecha_salida (amarra contra el conteo
  -- físico del almacén); la diferencia entre ambas es mercancía EN TRÁNSITO
  -- al cierre del mes. Si eso crece, hace falta una cuenta de tránsito.
  (select max(x.fecha_recepcion)::date from recepciones x
    where x.pedido_id = m.pedido_id)           as fecha_recepcion,
  'CEDIS'::text                                as centro_origen,
  'ROMA'::text                                 as centro_destino,
  m.pedido_id::text                            as pedido_id,
  p.numero_pedido                              as pedido_folio,
  ia.sku                                       as sku,
  ia.descripcion                               as descripcion,
  m.cantidad                                   as cantidad,
  round(coalesce(sum(sp.costo_total),0)::numeric, 2) as costo_peps,
  -- sólo para cuadrar contra la cifra vieja; NO usar para contabilizar
  round(coalesce(max(vp.valor),0)::numeric, 2)       as costo_pedido_referencia,
  m.nota                                       as nota
from movimientos_almacen m
join inventario_almacen ia on ia.id = m.inventario_id
left join salidas_peps sp  on sp.movimiento_id = m.id
left join pedidos p        on p.id = m.pedido_id
left join valor_pedido vp  on vp.pedido_id = m.pedido_id
                          and vp.inv_id    = m.inventario_id
where m.tipo = 'salida'
group by m.id, m.fecha, m.pedido_id, p.numero_pedido,
         ia.sku, ia.descripcion, m.cantidad, m.nota;

comment on view v_traspasos_cedis_tesoreria is
  'Surtido CEDIS → ROMA, al grano de la salida de almacén y valuado a costo '
  'PEPS real. Es movimiento de costo entre centros, NO una compra: no genera '
  'pasivo ni espera factura. Devengar por fecha_salida; la mercancía con '
  'fecha_recepcion en otro mes es EN TRÁNSITO al cierre. '
  'costo_pedido_referencia es la valuación vieja, sólo para cuadrar: en '
  'octubre 2026 la brecha de $6,030.40 se parte en −$3,328.02 de valuación '
  '(el PEPS resultó MENOR que el costo del pedido) y +$9,358.42 de corte de '
  'fecha, con $10,574.42 a caballo entre octubre y noviembre. '
  'ADVERTENCIA HISTÓRICA: julio 2026 trae $112,374.38 de PEPS contra '
  '$34,305.42 de costo de pedido, +$78,069 que no se compensan con ningún '
  'otro mes. Coincide con la migración de variantes y unidades (v7.10, '
  '_respaldo_unidades_20260727). No usar julio para costo histórico '
  'comparable sin revisarlo antes.';

-- ---------------------------------------------------------------------------
-- 3. La función del portal del proveedor
-- ---------------------------------------------------------------------------
-- Devuelve las entregas facturables de UN proveedor, identificado por su
-- token. Es SECURITY DEFINER para poder leer las tablas operativas, pero sólo
-- entrega lo que corresponde al token recibido.
--
-- Tesorería la usa así, desde el portal:
--     select * from fn_pedidos_por_facturar('<token del proveedor>');
-- y después quita de esa lista lo que ya tenga renglón en tes_pedidos_enlace,
-- que es tabla suya. Nosotros no sabemos ni queremos saber qué ya se enlazó.
-- EL CORTE DE OCTUBRE NO ES COSMÉTICO
-- Los libros de Tesorería arrancan el 1 de octubre de 2026; lo anterior se
-- liquidó fuera del sistema. Sin este corte el portal le mostraría a Juan
-- Carlos 43 entregas cuando las vivas son 15, y entre todos los proveedores
-- saldrían 197 facturables en vez de 58: $430,627 de entregas ya saldadas que
-- invitan a amarrar una factura nueva contra mercancía vieja.
-- El parámetro se puede mover si algún día cambia la fecha de arranque.
create or replace function fn_pedidos_por_facturar(
  p_token text,
  p_desde date default date '2026-10-01'
)
returns table (
  pedido_id        text,
  pedido_folio     varchar,
  fecha_pedido     date,
  fecha_recepcion  date,
  importe_recibido numeric,
  importe_pedido   numeric,
  tipo_flujo       text,
  cotejar_contra   text,
  estatus          varchar
)
language sql
stable
security definer
set search_path = public
as $$
  select v.pedido_id, v.pedido_folio, v.fecha_pedido, v.fecha_recepcion,
         v.importe_recibido, v.importe_pedido, v.tipo_flujo, v.cotejar_contra,
         v.estatus
    from v_pedidos_tesoreria v
   where p_token is not null
     and length(p_token) >= 16          -- un token vacío no abre nada
     and v.proveedor_id = (
           select tp.id from tes_proveedores tp
            where tp.token_acceso = p_token
              and tp.token_activo
              and tp.activo
              and not coalesce(tp.es_interno,false))
     and v.recibido                      -- sólo lo que ya llegó se factura
     and v.importe_recibido > 0
     and v.fecha_recepcion >= p_desde    -- Tesorería arranca el 1-oct-2026
   order by v.fecha_recepcion desc nulls last, v.fecha_pedido desc;
$$;

comment on function fn_pedidos_por_facturar(text, date) is
  'Portal del proveedor: entregas ya recibidas y facturables del proveedor '
  'dueño del token, desde el 1-oct-2026 (arranque de los libros de Tesorería). '
  'El token ES la autorización. Nunca devuelve datos de otro proveedor ni '
  'traspasos internos. Emparejar contra importe_recibido, usando el campo del '
  'CFDI que indique cotejar_contra.';

-- ---------------------------------------------------------------------------
-- 4. Permisos
-- ---------------------------------------------------------------------------
-- Las vistas van SIN security_invoker (el valor por omisión): corren con los
-- permisos de su dueño, así Tesorería ve las columnas del contrato y nunca
-- las cinco tablas crudas de abajo.
grant select  on v_pedidos_tesoreria          to authenticated;
grant select  on v_compras_directas_tesoreria to authenticated;
grant select  on v_traspasos_cedis_tesoreria  to authenticated;

-- La función la puede llamar el portal con cualquiera de los dos roles,
-- porque la autorización va en el token, no en el rol.
grant execute on function fn_pedidos_por_facturar(text, date) to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- Juan Carlos debe ver 15 entregas, no 43, PED-20261109-001 por $5,370.00
-- hasta arriba, y cotejar_contra = 'cfdi.subtotal - coalesce(cfdi.descuento,0)':
--   select * from fn_pedidos_por_facturar(
--     (select token_acceso from tes_proveedores where alias_cocina='Juan Carlos Botello'));
--
-- Un token inventado no debe traer NADA:
--   select count(*) from fn_pedidos_por_facturar('0000000000000000');  -- 0
--   select count(*) from fn_pedidos_por_facturar('');                  -- 0
--   select count(*) from fn_pedidos_por_facturar(null);                -- 0
--
-- Agosto y septiembre deben cuadrar al centavo contra el valor del pedido:
--   select to_char(fecha_salida,'YYYY-MM') mes, round(sum(costo_peps),2)
--     from v_traspasos_cedis_tesoreria group by 1 order by 1;
--
-- Y no debe poder ver lo de otro proveedor:
--   select count(*) from fn_pedidos_por_facturar(
--     (select token_acceso from tes_proveedores where alias_cocina='Juan Carlos Botello'))
--   where pedido_folio in (select pedido_folio from v_pedidos_tesoreria
--                           where proveedor_alias='Yerina');           -- 0
-- ============================================================================

-- ============================================================================
-- CÓMO REVERTIR
-- ============================================================================
-- drop function if exists fn_pedidos_por_facturar(text, date);
-- drop view if exists v_traspasos_cedis_tesoreria;
-- drop view if exists v_compras_directas_tesoreria;
-- drop view if exists v_pedidos_tesoreria;
-- No borra ni modifica ningún dato: son sólo vistas y una función.
-- ============================================================================
