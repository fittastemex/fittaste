-- ============================================================================
-- v8.1 — El puente hacia Tesorería
-- ============================================================================
-- Expone a Tesorería lo que esta app sabe de pedidos, recepciones y compras
-- directas, para que una factura pueda amarrarse a la mercancía que cubre.
--
-- Requiere la v8.0 (catálogo único) aplicada: sin ella no hay RFC ni token
-- de proveedor del lado operativo.
--
-- LA LLAVE DE CRUCE ES EL SUBTOTAL RECIBIDO, SIN IVA
--
-- Esto se descubrió con datos reales y cambia el diseño. Nuestro IVA es una
-- ESTIMACIÓN: multiplicamos por 1.16 lo que trae catalogo.aplica_iva marcado.
-- El IVA del CFDI es el de verdad, y además trae retenciones. Comparar totales
-- da un desfase sistemático de ~1.2%.
--
-- Comparando el subtotal sin IVA, en cambio, cuadra AL CENTAVO. De las 11
-- facturas de Juan Carlos, 8 empatan exacto contra un solo pedido:
--
--   CFDI 155 · $5,370.00  =  PED-20261109-001 · $5,370.00
--   CFDI 154 · $3,079.00  =  PED-20261102-001 · $3,079.00
--   CFDI 153 · $4,085.00  =  PED-20261029-001 · $4,085.00
--   CFDI 152 · $3,887.00  =  PED-20261026-001 · $3,887.00
--   CFDI 149 · $4,091.00  =  PED-20261015-001 · $4,091.00
--   CFDI 148 · $5,153.00  =  PED-20261012-001 · $5,153.00
--   CFDI 147 · $5,566.00  =  PED-20261006-001 · $5,566.00
--   CFDI 146 · $5,436.00  =  PED-20261002-001 · $5,436.00
--
-- Y la novena empata contra DOS pedidos, que es justo por lo que la tabla de
-- enlace tiene que ser de muchos a muchos:
--
--   CFDI 145 · $5,988.00  =  PED-20260929-001 ($5,908) + PED-20260929-002 ($80)
--
-- Por eso la vista entrega los subtotales como llave principal y los totales
-- con IVA sólo como referencia, con el nombre bien claro de que son estimados.
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
         coalesce(pd.costo_real, pd.costo_referencia) as cu,
         case when coalesce(cat.aplica_iva,false) then 1.16 else 1 end as f_iva
    from pedido_proveedor_estatus ppe
    join pedido_detalle pd
      on pd.pedido_id    = ppe.pedido_id
     and pd.proveedor_id = ppe.proveedor_id
    left join catalogo cat on cat.id = pd.catalogo_id
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

  -- LLAVES DE CRUCE: sin IVA. Contra esto cuadra el subtotal del CFDI.
  round(sum(l.cantidad * l.cu)::numeric, 2)                  as subtotal_pedido,
  round(sum(coalesce(r.q,0) * l.cu)::numeric, 2)             as subtotal_recibido,

  -- SÓLO REFERENCIA: el IVA aquí es estimado por nosotros a partir de
  -- catalogo.aplica_iva. No sirve para emparejar; el del CFDI es el bueno.
  round(sum(l.cantidad * l.cu * l.f_iva)::numeric, 2)        as total_pedido_iva_estimado,
  round(sum(coalesce(r.q,0) * l.cu * l.f_iva)::numeric, 2)   as total_recibido_iva_estimado,

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
join linea l            on l.ppe_id = ppe.id
left join recibido r    on r.pedido_detalle_id = l.pd_id
group by ppe.id, p.numero_pedido, p.fecha, tp.id, tp.rfc, tp.nombre,
         tp.alias_cocina, ppe.estatus, ppe.pedido_id, ppe.proveedor_id,
         tp.es_interno;

comment on view v_pedidos_tesoreria is
  'Contrato de solo lectura para Tesorería. Grano: (pedido × proveedor). '
  'Emparejar CFDI contra subtotal_recibido (sin IVA): cuadra al centavo. '
  'Los totales con IVA son estimación nuestra, sólo de referencia. '
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
  -- true = ya salió del banco, Tesorería debería tener el cargo
  (cd.metodo_pago in ('transferencia','tarjeta'))    as toca_banco,
  cd.nota                                            as nota,
  cd.registrado_por                                  as registrado_por
from compras_directas cd
join tes_proveedores tp on tp.id = cd.proveedor_id;

comment on view v_compras_directas_tesoreria is
  'Compras que la sucursal hace sin pedido previo. toca_banco = true son las '
  'que ya salieron por transferencia o tarjeta y llegan al estado de cuenta. '
  'El costo_total de esta tabla se captura tal cual, sin desglose de IVA.';

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
select
  m.id::text                                   as traspaso_id,
  m.fecha                                      as fecha_salida,
  'CEDIS'::text                                as centro_origen,
  'ROMA'::text                                 as centro_destino,
  m.pedido_id::text                            as pedido_id,
  p.numero_pedido                              as pedido_folio,
  ia.sku                                       as sku,
  ia.descripcion                               as descripcion,
  m.cantidad                                   as cantidad,
  round(coalesce(sum(sp.costo_total),0)::numeric, 2) as costo_peps,
  m.nota                                       as nota
from movimientos_almacen m
join inventario_almacen ia on ia.id = m.inventario_id
left join salidas_peps sp  on sp.movimiento_id = m.id
left join pedidos p        on p.id = m.pedido_id
where m.tipo = 'salida'
group by m.id, m.fecha, m.pedido_id, p.numero_pedido,
         ia.sku, ia.descripcion, m.cantidad, m.nota;

comment on view v_traspasos_cedis_tesoreria is
  'Surtido CEDIS → ROMA, al grano de la salida de almacén y valuado a costo '
  'PEPS real. Es movimiento de costo entre centros, NO una compra: no genera '
  'pasivo ni espera factura. Cortar por fecha_salida, no por la recepción. '
  'Julio 2026 trae una anomalía de +$78,069 sin revisar.';

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
create or replace function fn_pedidos_por_facturar(p_token text)
returns table (
  pedido_id         text,
  pedido_folio      varchar,
  fecha_pedido      date,
  fecha_recepcion   date,
  subtotal_recibido numeric,
  subtotal_pedido   numeric,
  estatus           varchar
)
language sql
stable
security definer
set search_path = public
as $$
  select v.pedido_id, v.pedido_folio, v.fecha_pedido, v.fecha_recepcion,
         v.subtotal_recibido, v.subtotal_pedido, v.estatus
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
     and v.subtotal_recibido > 0
   order by v.fecha_recepcion desc nulls last, v.fecha_pedido desc;
$$;

comment on function fn_pedidos_por_facturar(text) is
  'Portal del proveedor: entregas ya recibidas y facturables del proveedor '
  'dueño del token. El token ES la autorización. Nunca devuelve datos de otro '
  'proveedor ni traspasos internos. Emparejar contra subtotal_recibido.';

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
grant execute on function fn_pedidos_por_facturar(text) to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICACIÓN
-- ============================================================================
-- Juan Carlos debe ver PED-20261109-001 por $5,370.00 hasta arriba:
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
-- drop function if exists fn_pedidos_por_facturar(text);
-- drop view if exists v_traspasos_cedis_tesoreria;
-- drop view if exists v_compras_directas_tesoreria;
-- drop view if exists v_pedidos_tesoreria;
-- No borra ni modifica ningún dato: son sólo vistas y una función.
-- ============================================================================
