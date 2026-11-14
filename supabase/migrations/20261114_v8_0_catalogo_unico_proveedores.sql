-- ============================================================================
-- v8.0 — Catálogo único de proveedores
-- ============================================================================
-- Fit Taste (tabla `proveedores`, 9 filas, nombres de cocina) y Tesorería
-- (tabla `tes_proveedores`, 12 filas, nombres fiscales con RFC) se fusionan
-- en `tes_proveedores`. La tabla `proveedores` desaparece y en su lugar queda
-- una VISTA con la misma forma, para que index.html siga funcionando sin que
-- haya que tocarle una sola línea.
--
-- POR QUÉ UNA VISTA Y NO UN RENOMBRE DIRECTO
-- Las dos apps tienen modelos de seguridad distintos:
--   · Fit Taste  → rol `anon`, sin RLS, contraseñas en el cliente.
--   · Tesorería  → rol `authenticated`, RLS activo, fn_tes_es_admin().
-- Si `proveedores` apuntara crudo a `tes_proveedores`, el rol anon leería
-- CERO filas y la app de inventarios se rompería al instante. La vista actúa
-- de esclusa: expone sólo las 8 columnas que Fit Taste necesita y NUNCA
-- `rfc`, `token_acceso` ni los datos fiscales.
--
-- REVERSIBLE: no se borra ni una fila. Respaldo en _respaldo_proveedores_20261114.
-- ============================================================================

begin;

-- ---------------------------------------------------------------------------
-- 0. Respaldo
-- ---------------------------------------------------------------------------
create table if not exists _respaldo_proveedores_20261114 as
  select * from proveedores;

-- ---------------------------------------------------------------------------
-- 1. tes_proveedores adopta las columnas que hoy sólo existen en Fit Taste
-- ---------------------------------------------------------------------------
-- tipo_flujo_id va SIN llave foránea y nullable, a petición de tesorería
-- (condición 2 de su réplica): un borrado del lado operativo no debe poder
-- bloquear una operación de tesorería. La integridad la cuida la app.
alter table tes_proveedores
  add column if not exists tipo_flujo_id uuid,
  add column if not exists alias_cocina  text,
  add column if not exists es_interno    boolean not null default false;

comment on column tes_proveedores.tipo_flujo_id is
  'Cómo se captura el costo en Fit Taste: Commodity, Compra manual, Directo, Almacen interno. Apunta a tipos_flujo_costo SIN llave foránea, a propósito. Tesorería nunca lo lee ni lo escribe.';
comment on column tes_proveedores.alias_cocina is
  'Nombre con el que cocina conoce al proveedor. Ej: alias_cocina="Pollo" sobre nombre="King''s Food de Santander". Tesorería sigue mostrando `alias`.';
comment on column tes_proveedores.es_interno is
  'true = entidad interna (el CEDIS surtiendo a sucursal). NUNCA genera pasivo ni espera factura. Tesorería debe filtrar con es_interno = false.';

-- ---------------------------------------------------------------------------
-- 2. Los 3 proveedores que YA existían en ambos lados
--    Se conserva el id de TESORERÍA (trae RFC y portal). Se le cuelga el
--    nombre de cocina y el tipo de flujo.
-- ---------------------------------------------------------------------------
update tes_proveedores set alias_cocina='Pollo',
       tipo_flujo_id=(select tipo_flujo_id from proveedores where id='41ec0fdd-c053-401a-8205-dc4448289c41')
 where id='e445daf9-e2a0-4071-9b73-f203ff0a19e9';   -- King's Food de Santander

update tes_proveedores set alias_cocina='Yerina',
       tipo_flujo_id=(select tipo_flujo_id from proveedores where id='b7c7df92-5dd5-4f8b-9ca1-333a650d6615')
 where id='45e92685-6501-4147-a2fb-4277e67cb077';   -- Yerinha Arzate Yedra

update tes_proveedores set alias_cocina='Juan Carlos Botello',
       tipo_flujo_id=(select tipo_flujo_id from proveedores where id='b1e01281-9852-4be0-9484-1ee3c4022dd1')
 where id='4457e3e1-b3f0-41a6-a87e-92d61753d8ad';   -- Juan Carlos Juárez Salazar

-- ---------------------------------------------------------------------------
-- 3. Los 6 que sólo existían en Fit Taste
--    Se insertan CONSERVANDO SU UUID ACTUAL. Así no hay que repuntar ni una
--    sola fila histórica de pedidos, recepciones ni catálogo.
--    token_activo = false: ninguno de estos usa el portal todavía.
-- ---------------------------------------------------------------------------
-- liquida_por_descuento va EXPLÍCITO en false, a petición de tesorería
-- (condición 1 de su réplica, no negociable): su trigger fn_tes_cfdi_liquidada
-- lo lee al insertar un CFDI para decidir si la factura se paga por
-- transferencia o se descuenta del depósito, como Uber y Clip. Ninguno de
-- estos seis se liquida por descuento.
insert into tes_proveedores (id, nombre, alias_cocina, rfc, tipo_flujo_id,
                             contacto_nombre, contacto_email, activo, token_activo,
                             es_interno, liquida_por_descuento, nota)
select p.id,
       case p.nombre
         when 'Walmart' then 'NUEVA WAL MART DE MEXICO'
         when 'Meli'    then 'DEREMATE.COM DE MEXICO'
         else p.nombre
       end,
       p.nombre,
       case p.nombre
         when 'Walmart' then 'NWM9709244W4'
         when 'Meli'    then 'DCM991109KR2'
         else null
       end,
       p.tipo_flujo_id, p.contacto, p.email, p.activo, false,
       (p.nombre = 'Almacen'),
       false,
       case when p.nombre='Almacen'
            then 'Entidad interna: el CEDIS surtiendo a sucursal. No es un tercero.'
            else 'Migrado del catálogo de Fit Taste el 2026-11-14.' end
  from proveedores p
 where p.id in ('c1ba5da8-8c27-4359-8d40-d2e25b003240',  -- Walmart
                '4832ff16-f9ee-4bf9-9ea1-dd20e0b540de',  -- Meli
                '9e429faa-c30b-4e13-98eb-ed9bff4ea365',  -- Office Max
                'ef15e7c6-29a0-458c-ad7b-c9ded4e8e452',  -- Del Mar
                '51ac4c6a-b65c-4e03-b6fc-e87e22b6d5b4',  -- Proveedor Tortilla
                '943e28dd-133d-4d63-bd3d-9a2adb4d68d6')  -- Almacen (interno)
on conflict (id) do nothing;

-- Almacén cuelga del centro de costos CEDIS que tesorería ya tiene
update tes_proveedores
   set centro_default_id = (select id from tes_centros where codigo='CEDIS')
 where id = '943e28dd-133d-4d63-bd3d-9a2adb4d68d6';

-- ---------------------------------------------------------------------------
-- 4. Repuntar el histórico de los 3 fusionados
--    Sólo estos 3 cambian de id; los otros 6 conservaron el suyo.
-- ---------------------------------------------------------------------------
create temp table _map_prov(viejo uuid primary key, nuevo uuid not null) on commit drop;
insert into _map_prov values
  ('41ec0fdd-c053-401a-8205-dc4448289c41','e445daf9-e2a0-4071-9b73-f203ff0a19e9'), -- Pollo
  ('b7c7df92-5dd5-4f8b-9ca1-333a650d6615','45e92685-6501-4147-a2fb-4277e67cb077'), -- Yerina
  ('b1e01281-9852-4be0-9484-1ee3c4022dd1','4457e3e1-b3f0-41a6-a87e-92d61753d8ad'); -- Botello

-- Las 10 llaves foráneas se sueltan, se repunta el dato, y se vuelven a
-- amarrar contra tes_proveedores.
alter table catalogo                drop constraint catalogo_proveedor_id_fkey;
alter table compras_directas        drop constraint compras_directas_proveedor_id_fkey;
alter table cuentas_por_pagar       drop constraint cuentas_por_pagar_proveedor_id_fkey;
alter table pedido_detalle          drop constraint pedido_detalle_proveedor_id_fkey;
alter table pedido_proveedor_estatus drop constraint pedido_proveedor_estatus_proveedor_id_fkey;
alter table pedido_reasignaciones   drop constraint pedido_reasignaciones_proveedor_original_id_fkey;
alter table pedido_reasignaciones   drop constraint pedido_reasignaciones_proveedor_nuevo_id_fkey;
alter table recepcion_proveedor     drop constraint recepcion_proveedor_proveedor_id_fkey;
alter table recepciones             drop constraint recepciones_proveedor_id_fkey;
alter table usuarios                drop constraint usuarios_proveedor_id_fkey;

update catalogo              t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update compras_directas      t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update cuentas_por_pagar     t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update pedido_detalle        t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update pedido_proveedor_estatus t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update pedido_reasignaciones t set proveedor_original_id=m.nuevo from _map_prov m where t.proveedor_original_id=m.viejo;
update pedido_reasignaciones t set proveedor_nuevo_id=m.nuevo    from _map_prov m where t.proveedor_nuevo_id=m.viejo;
update recepcion_proveedor   t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update recepciones           t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;
update usuarios              t set proveedor_id=m.nuevo from _map_prov m where t.proveedor_id=m.viejo;

-- ---------------------------------------------------------------------------
-- 5. `proveedores` deja de ser tabla y pasa a ser vista
-- ---------------------------------------------------------------------------
drop table proveedores;

create view proveedores as
  select id,
         coalesce(alias_cocina, alias, nombre)::varchar as nombre,
         tipo_flujo_id,
         contacto_nombre::varchar  as contacto,
         contacto_whatsapp::varchar as telefono,
         contacto_email::varchar   as email,
         activo,
         creado_en as created_at
    from tes_proveedores;

comment on view proveedores is
  'Vista de compatibilidad para index.html (Fit Taste). El catálogo real es tes_proveedores. Expone sólo lo operativo: NUNCA rfc ni token_acceso.';

-- Las 10 llaves vuelven, ahora contra el catálogo único
alter table catalogo                add constraint catalogo_proveedor_id_fkey                 foreign key (proveedor_id)          references tes_proveedores(id);
alter table compras_directas        add constraint compras_directas_proveedor_id_fkey         foreign key (proveedor_id)          references tes_proveedores(id);
alter table cuentas_por_pagar       add constraint cuentas_por_pagar_proveedor_id_fkey        foreign key (proveedor_id)          references tes_proveedores(id);
alter table pedido_detalle          add constraint pedido_detalle_proveedor_id_fkey           foreign key (proveedor_id)          references tes_proveedores(id);
alter table pedido_proveedor_estatus add constraint pedido_proveedor_estatus_proveedor_id_fkey foreign key (proveedor_id)         references tes_proveedores(id);
alter table pedido_reasignaciones   add constraint pedido_reasignaciones_proveedor_original_id_fkey foreign key (proveedor_original_id) references tes_proveedores(id);
alter table pedido_reasignaciones   add constraint pedido_reasignaciones_proveedor_nuevo_id_fkey    foreign key (proveedor_nuevo_id)    references tes_proveedores(id);
alter table recepcion_proveedor     add constraint recepcion_proveedor_proveedor_id_fkey      foreign key (proveedor_id)          references tes_proveedores(id);
alter table recepciones             add constraint recepciones_proveedor_id_fkey              foreign key (proveedor_id)          references tes_proveedores(id);
alter table usuarios                add constraint usuarios_proveedor_id_fkey                 foreign key (proveedor_id)          references tes_proveedores(id);

-- ---------------------------------------------------------------------------
-- 6. La vista tiene que aceptar escrituras
--    index.html da de alta (1717), edita (1734) y desactiva (1746) proveedores.
--    Sin esto, la pantalla de administración se rompe.
-- ---------------------------------------------------------------------------
create or replace function fn_proveedores_insert() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into tes_proveedores (nombre, alias_cocina, tipo_flujo_id, contacto_nombre,
                               contacto_whatsapp, contacto_email, activo, token_activo, nota)
  values (new.nombre, new.nombre, new.tipo_flujo_id, new.contacto,
          new.telefono, new.email, coalesce(new.activo,true), false,
          'Dado de alta desde Fit Taste. Falta capturarle RFC en tesorería.')
  returning id into new.id;
  return new;
end $$;

create or replace function fn_proveedores_update() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update tes_proveedores
     set alias_cocina      = new.nombre,
         tipo_flujo_id     = new.tipo_flujo_id,
         contacto_nombre   = new.contacto,
         contacto_whatsapp = new.telefono,
         contacto_email    = new.email,
         activo            = new.activo
   where id = old.id;
  return new;
end $$;

create trigger trg_proveedores_insert instead of insert on proveedores
  for each row execute function fn_proveedores_insert();
create trigger trg_proveedores_update instead of update on proveedores
  for each row execute function fn_proveedores_update();

-- ---------------------------------------------------------------------------
-- 7. Permisos
--    La vista la ejecuta su dueño (sin security_invoker), así el rol anon
--    atraviesa el RLS de tes_proveedores SIN que se le abra la tabla cruda.
-- ---------------------------------------------------------------------------
grant select, insert, update on proveedores to anon, authenticated;

commit;

-- ============================================================================
-- VERIFICACIÓN (correr después, fuera de la transacción)
-- ============================================================================
-- select count(*) from proveedores;                       -- esperado: 18
-- select nombre, activo from proveedores order by nombre; -- cocina ve sus nombres
-- select count(*) from recepciones r join proveedores p on p.id=r.proveedor_id; -- 315
-- select count(*) from pedido_detalle d left join proveedores p on p.id=d.proveedor_id
--   where p.id is null;                                   -- esperado: 0 huérfanos
-- ============================================================================

-- ============================================================================
-- CÓMO REVERTIR
-- ============================================================================
-- 1. drop view proveedores cascade;  (se caen los 10 FK y los 2 triggers)
-- 2. create table proveedores as select * from _respaldo_proveedores_20261114;
-- 3. alter table proveedores add primary key (id);
-- 4. Repuntar los 3 fusionados al revés (nuevo → viejo) en las 10 tablas.
-- 5. Volver a crear los 10 FK contra proveedores.
-- ============================================================================
