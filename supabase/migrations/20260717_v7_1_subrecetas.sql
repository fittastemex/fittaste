-- ============================================================
-- Fit Taste v7.1 — Sub-recetas (preparaciones)
--
-- Una "preparación" (salsa, arroz cocido, aderezo…) es un producto_venta con
-- es_preparacion=true: tiene su propia receta (de UNA TANDA) y un rendimiento
-- (cuánto produce esa tanda, en su unidad). Los platillos la usan como un
-- ingrediente más; al vender, la explosión llega en cadena hasta los insumos
-- del catálogo, que son los que descuentan inventario.
--
-- ADITIVO: no borra ni modifica datos existentes.
-- ============================================================

alter table public.productos_venta
  add column if not exists es_preparacion boolean not null default false,
  add column if not exists unidad varchar,
  add column if not exists rendimiento numeric not null default 1;

-- Una línea de receta ahora puede apuntar a un insumo del catálogo O a una
-- preparación (exactamente uno de los dos).
alter table public.recetas alter column catalogo_id drop not null;
alter table public.recetas add column if not exists preparacion_id uuid references public.productos_venta(id);

-- La unicidad por (producto, catálogo) se vuelve parcial y se agrega la de
-- (producto, preparación).
alter table public.recetas drop constraint if exists recetas_producto_venta_id_catalogo_id_key;
create unique index if not exists uq_recetas_prod_cat on public.recetas(producto_venta_id, catalogo_id) where catalogo_id is not null;
create unique index if not exists uq_recetas_prod_prep on public.recetas(producto_venta_id, preparacion_id) where preparacion_id is not null;

alter table public.recetas drop constraint if exists recetas_un_insumo;
alter table public.recetas add constraint recetas_un_insumo check (
  (catalogo_id is not null and preparacion_id is null) or
  (catalogo_id is null and preparacion_id is not null)
);

-- Una preparación no puede contenerse a sí misma directamente
alter table public.recetas drop constraint if exists recetas_no_self;
alter table public.recetas add constraint recetas_no_self check (
  preparacion_id is null or preparacion_id <> producto_venta_id
);
