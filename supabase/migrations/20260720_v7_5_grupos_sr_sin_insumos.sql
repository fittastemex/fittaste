-- v7.5: clasificación de productos de venta
-- 1. grupo_sr: grupo del menú tal como está en SoftRestaurant (lo sincroniza
--    el conector en cada ciclo). Permite separar platillos de adicionales en
--    la analítica sin catalogar nada a mano.
-- 2. sin_insumos: marca para instrucciones de cocina que no consumen nada
--    (SIN CEBOLLA, PREPARADOS, INGREDIENTES POR SEPARADO...). Se excluyen de
--    la alarma de "vendidos sin receta".
-- Aplicada en DEV (whgfrfdqetjttlfsprtt) y PROD (jxyrbvgpjsxevbhaxprr) el 2026-07-20.

alter table productos_venta add column if not exists grupo_sr text;
alter table productos_venta add column if not exists sin_insumos boolean not null default false;
comment on column productos_venta.grupo_sr is 'Grupo del menú en SoftRestaurant (sincronizado por el conector)';
comment on column productos_venta.sin_insumos is 'true = instrucción de cocina sin consumo de insumos (SIN CEBOLLA, etc.); se excluye de la alarma de recetas faltantes';
