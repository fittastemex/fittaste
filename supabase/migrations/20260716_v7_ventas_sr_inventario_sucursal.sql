-- ============================================================
-- Fit Taste v7.0 — Expansión: conexión SoftRestaurant (ventas),
-- inventario por sucursal, recetas/costeo, merma y base para
-- estados financieros.
--
-- TODO ES ADITIVO: no modifica ninguna tabla existente.
-- Rollback: DROP TABLE movimientos_sucursal, mermas, venta_detalle,
--           ventas, inventario_sucursal, recetas, productos_venta;
-- ============================================================

-- Productos de venta (platillos/artículos tal como existen en SoftRestaurant).
-- codigo_sr = clave del producto en SR; permite casar el reporte de ventas
-- importado (y en el futuro, un conector automático vía SQL Server o API).
create table if not exists public.productos_venta (
  id uuid primary key default gen_random_uuid(),
  codigo_sr varchar unique,
  nombre varchar not null,
  categoria varchar,
  precio_venta numeric not null default 0,
  aplica_iva boolean default true,
  activo boolean default true,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Receta (BOM): insumos del catálogo de compras que consume cada producto
-- de venta. merma_pct = % extra de consumo por rendimiento/desperdicio.
create table if not exists public.recetas (
  id uuid primary key default gen_random_uuid(),
  producto_venta_id uuid not null references public.productos_venta(id) on delete cascade,
  catalogo_id uuid not null references public.catalogo(id),
  cantidad numeric not null default 0,
  merma_pct numeric not null default 0,
  created_at timestamptz default now(),
  unique(producto_venta_id, catalogo_id)
);

-- Existencias de insumos en cada sucursal (el almacén central ya tiene
-- inventario_almacen; esto es el espejo en punto de venta).
create table if not exists public.inventario_sucursal (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id),
  catalogo_id uuid not null references public.catalogo(id),
  existencia numeric not null default 0,
  costo_promedio numeric not null default 0,
  minimo_stock numeric not null default 0,
  updated_at timestamptz default now(),
  unique(sucursal_id, catalogo_id)
);

-- Ventas importadas de SoftRestaurant (un registro por corte/día/canal).
-- origen distingue captura manual vs conector automático futuro.
create table if not exists public.ventas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid references public.sucursales(id),
  fecha date not null default current_date,
  folio varchar,
  origen varchar not null default 'importado_sr' check (origen in ('importado_sr','manual','api')),
  canal varchar not null default 'mostrador' check (canal in ('mostrador','ubereats','rappi','didi','otro')),
  subtotal numeric not null default 0,
  iva numeric not null default 0,
  total numeric not null default 0,
  total_efectivo numeric not null default 0,
  total_tarjeta numeric not null default 0,
  total_plataforma numeric not null default 0,
  total_otros numeric not null default 0,
  costo_teorico numeric not null default 0,
  estatus varchar not null default 'activa' check (estatus in ('activa','cancelada')),
  nota text,
  registrado_por text,
  created_at timestamptz default now()
);

create table if not exists public.venta_detalle (
  id uuid primary key default gen_random_uuid(),
  venta_id uuid not null references public.ventas(id) on delete cascade,
  producto_venta_id uuid not null references public.productos_venta(id),
  cantidad numeric not null default 0,
  precio_unitario numeric not null default 0,
  importe numeric not null default 0,
  costo_teorico numeric not null default 0,
  created_at timestamptz default now()
);

-- Registro de merma: en sucursal (catalogo_id) o en almacén central
-- (inventario_almacen_id); costo_total alimenta el estado de resultados.
create table if not exists public.mermas (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid references public.sucursales(id),
  catalogo_id uuid references public.catalogo(id),
  inventario_almacen_id uuid references public.inventario_almacen(id),
  cantidad numeric not null,
  motivo varchar not null default 'otro' check (motivo in ('caducidad','dano','produccion','robo','ajuste_inventario','otro')),
  costo_unitario numeric not null default 0,
  costo_total numeric not null default 0,
  fecha date not null default current_date,
  nota text,
  registrado_por text,
  created_at timestamptz default now()
);

-- Kárdex de sucursal: toda entrada/salida de insumos con su costo,
-- ligada a su documento origen (recepción, venta, merma, ajuste).
create table if not exists public.movimientos_sucursal (
  id uuid primary key default gen_random_uuid(),
  sucursal_id uuid not null references public.sucursales(id),
  catalogo_id uuid not null references public.catalogo(id),
  tipo varchar not null check (tipo in ('entrada_recepcion','entrada_compra_directa','entrada_ajuste','salida_venta','salida_merma','salida_ajuste')),
  cantidad numeric not null,
  costo_unitario numeric not null default 0,
  venta_id uuid references public.ventas(id),
  merma_id uuid references public.mermas(id),
  recepcion_id uuid references public.recepciones(id),
  fecha date not null default current_date,
  nota text,
  registrado_por text,
  created_at timestamptz default now()
);

create index if not exists idx_recetas_producto on public.recetas(producto_venta_id);
create index if not exists idx_inv_suc_catalogo on public.inventario_sucursal(catalogo_id);
create index if not exists idx_venta_detalle_venta on public.venta_detalle(venta_id);
create index if not exists idx_mov_suc_catalogo on public.movimientos_sucursal(catalogo_id);
create index if not exists idx_mov_suc_fecha on public.movimientos_sucursal(fecha);
create index if not exists idx_ventas_fecha on public.ventas(fecha);
