-- ============================================================
-- Fit Taste v7.2 — Insumos base + presentaciones de compra + tipo de control
--
-- Separa el INSUMO genérico ("CREMA", unidad base ml, quien vive en recetas
-- e inventario) de la PRESENTACIÓN de compra ("Crema Lala bote 900 ml", que
-- es el renglón del catálogo con proveedor y precio). catalogo.contenido es
-- el factor de conversión: cuántas unidades base trae una unidad de compra.
--
-- tipo_control del insumo:
--   'inventariable' → entra a inventario de sucursal, recetas, conteos, merma
--   'gasto'         → no lleva inventario; al recibirse se registra como
--                     gasto operativo con su categoría (jabón, fibras, etc.)
--
-- MIGRACIÓN DE DATOS: crea 1 insumo por cada artículo actual del catálogo
-- (contenido=1, misma unidad) y re-apunta recetas, inventario de sucursal,
-- kárdex y mermas del catálogo al insumo. La fusión de marcas (que 2
-- presentaciones apunten al mismo insumo) se hace después desde la UI.
-- Los artículos de tipo LIMPIEZA arrancan como 'gasto'.
-- ============================================================

create table if not exists public.insumos (
  id uuid primary key default gen_random_uuid(),
  nombre varchar not null,
  unidad_base varchar not null default 'pz',
  tipo_control varchar not null default 'inventariable' check (tipo_control in ('inventariable','gasto')),
  categoria_gasto text,
  activo boolean default true,
  origen_catalogo_id uuid, -- rastro de la migración inicial
  created_at timestamptz default now()
);

alter table public.catalogo
  add column if not exists insumo_id uuid references public.insumos(id),
  add column if not exists contenido numeric not null default 1;

insert into public.insumos (nombre, unidad_base, tipo_control, categoria_gasto, activo, origen_catalogo_id)
select c.articulo, coalesce(u.clave,'pz'),
       case when upper(coalesce(c.tipo_producto,''))='LIMPIEZA' then 'gasto' else 'inventariable' end,
       case when upper(coalesce(c.tipo_producto,''))='LIMPIEZA' then 'Limpieza' else null end,
       coalesce(c.activo,true), c.id
from public.catalogo c
left join public.unidades_medida u on u.id=c.unidad_id
where c.insumo_id is null;

update public.catalogo c set insumo_id=i.id
from public.insumos i where i.origen_catalogo_id=c.id and c.insumo_id is null;

-- Recetas ahora consumen insumos (o preparaciones), no presentaciones
alter table public.recetas add column if not exists insumo_id uuid references public.insumos(id);
update public.recetas r set insumo_id=c.insumo_id from public.catalogo c where r.catalogo_id=c.id and r.insumo_id is null;
alter table public.recetas drop constraint if exists recetas_un_insumo;
drop index if exists public.uq_recetas_prod_cat;
alter table public.recetas drop column if exists catalogo_id;
alter table public.recetas add constraint recetas_un_insumo check (
  (insumo_id is not null and preparacion_id is null) or (insumo_id is null and preparacion_id is not null)
);
create unique index if not exists uq_recetas_prod_ins on public.recetas(producto_venta_id, insumo_id) where insumo_id is not null;

-- Inventario de sucursal por insumo (en unidad base)
alter table public.inventario_sucursal add column if not exists insumo_id uuid references public.insumos(id);
update public.inventario_sucursal s set insumo_id=c.insumo_id from public.catalogo c where s.catalogo_id=c.id and s.insumo_id is null;
alter table public.inventario_sucursal drop constraint if exists inventario_sucursal_sucursal_id_catalogo_id_key;
alter table public.inventario_sucursal drop column if exists catalogo_id;
create unique index if not exists uq_inv_suc_insumo on public.inventario_sucursal(sucursal_id, insumo_id);

-- Kárdex por insumo
alter table public.movimientos_sucursal add column if not exists insumo_id uuid references public.insumos(id);
update public.movimientos_sucursal m set insumo_id=c.insumo_id from public.catalogo c where m.catalogo_id=c.id and m.insumo_id is null;
alter table public.movimientos_sucursal drop column if exists catalogo_id;
create index if not exists idx_mov_suc_insumo on public.movimientos_sucursal(insumo_id);

-- Mermas por insumo
alter table public.mermas add column if not exists insumo_id uuid references public.insumos(id);
update public.mermas m set insumo_id=c.insumo_id from public.catalogo c where m.catalogo_id=c.id and m.insumo_id is null;
alter table public.mermas drop column if exists catalogo_id;
