-- Esquema base Fit Taste (generado desde produccion, estado v7.2)
-- Uso: replicar la base en un proyecto DEV/staging vacio.
create extension if not exists "uuid-ossp" with schema extensions;

create table public.catalogo (
  id uuid default uuid_generate_v4() not null,
  sku character varying not null,
  articulo character varying not null,
  tipo_producto character varying not null,
  unidad_id uuid not null,
  costo_referencia numeric default 0 not null,
  proveedor_id uuid not null,
  notas text,
  activo boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  actualizado_por uuid,
  aplica_iva boolean default true,
  inventario_almacen_id uuid,
  insumo_id uuid,
  contenido numeric default 1 not null
);

create table public.catalogo_historial (
  id uuid default uuid_generate_v4() not null,
  catalogo_id uuid not null,
  campo_modificado character varying not null,
  valor_anterior text,
  valor_nuevo text,
  modificado_por uuid,
  fecha timestamp with time zone default now(),
  motivo text
);

create table public.categorias_gastos (
  id uuid default gen_random_uuid() not null,
  nombre text not null,
  activa boolean default true,
  created_at timestamp with time zone default now()
);

create table public.compras_directas (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid,
  proveedor_id uuid not null,
  catalogo_id uuid not null,
  cantidad numeric default 0 not null,
  costo_unitario numeric default 0 not null,
  costo_total numeric default 0 not null,
  metodo_pago text default 'efectivo'::text not null,
  fecha date default CURRENT_DATE not null,
  nota text,
  registrado_por text default 'sucursal'::text,
  created_at timestamp with time zone default now()
);

create table public.cuentas_por_pagar (
  id uuid default uuid_generate_v4() not null,
  pedido_id uuid not null,
  proveedor_id uuid not null,
  recepcion_id uuid,
  monto_subtotal numeric default 0 not null,
  monto_iva numeric default 0 not null,
  monto_total numeric default 0 not null,
  estatus character varying default 'pendiente'::character varying not null,
  fecha_generada date default CURRENT_DATE not null,
  fecha_vencimiento date,
  created_at timestamp with time zone default now(),
  monto_pagado numeric default 0,
  diferencia numeric default 0,
  numero_factura character varying,
  nota_finanzas text,
  fecha_pago date
);

create table public.gastos_operativos (
  id uuid default gen_random_uuid() not null,
  categoria text,
  descripcion text not null,
  monto numeric not null,
  metodo_pago text default 'transferencia'::text not null,
  fecha date default CURRENT_DATE not null,
  referencia text,
  nota text,
  registrado_por text default 'finanzas'::text,
  created_at timestamp with time zone default now()
);

create table public.insumos (
  id uuid default gen_random_uuid() not null,
  nombre character varying not null,
  unidad_base character varying default 'pz'::character varying not null,
  tipo_control character varying default 'inventariable'::character varying not null,
  categoria_gasto text,
  activo boolean default true,
  origen_catalogo_id uuid,
  created_at timestamp with time zone default now()
);

create table public.inventario_almacen (
  id uuid default uuid_generate_v4() not null,
  sku character varying not null,
  descripcion character varying not null,
  unidad_id uuid not null,
  existencia numeric default 0 not null,
  costo_unitario_actual numeric default 0 not null,
  lead_time character varying,
  minimo_stock numeric default 0,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table public.inventario_sucursal (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid not null,
  existencia numeric default 0 not null,
  costo_promedio numeric default 0 not null,
  minimo_stock numeric default 0 not null,
  updated_at timestamp with time zone default now(),
  insumo_id uuid
);

create table public.lotes_almacen (
  id uuid default uuid_generate_v4() not null,
  inventario_id uuid not null,
  fecha_entrada date default CURRENT_DATE not null,
  cantidad numeric not null,
  costo_unitario numeric not null,
  iva numeric default 0,
  sobreprecio_transporte numeric default 0,
  costo_total_unitario numeric generated always as (((costo_unitario + iva) + sobreprecio_transporte)) stored,
  proveedor_origen character varying,
  nota text,
  created_at timestamp with time zone default now(),
  existencia_restante numeric
);

create table public.mermas (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid,
  inventario_almacen_id uuid,
  cantidad numeric not null,
  motivo character varying default 'otro'::character varying not null,
  costo_unitario numeric default 0 not null,
  costo_total numeric default 0 not null,
  fecha date default CURRENT_DATE not null,
  nota text,
  registrado_por text,
  created_at timestamp with time zone default now(),
  insumo_id uuid
);

create table public.movimientos_almacen (
  id uuid default uuid_generate_v4() not null,
  inventario_id uuid not null,
  pedido_id uuid,
  fecha date default CURRENT_DATE not null,
  tipo character varying not null,
  cantidad numeric not null,
  nota text,
  usuario_id uuid,
  created_at timestamp with time zone default now()
);

create table public.movimientos_sucursal (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid not null,
  tipo character varying not null,
  cantidad numeric not null,
  costo_unitario numeric default 0 not null,
  venta_id uuid,
  merma_id uuid,
  recepcion_id uuid,
  fecha date default CURRENT_DATE not null,
  nota text,
  registrado_por text,
  created_at timestamp with time zone default now(),
  insumo_id uuid
);

create table public.pagos (
  id uuid default uuid_generate_v4() not null,
  cuenta_id uuid not null,
  numero_factura character varying,
  monto_pagado numeric not null,
  fecha_pago date default CURRENT_DATE not null,
  metodo_pago character varying,
  nota text,
  registrado_por uuid,
  created_at timestamp with time zone default now(),
  referencia text
);

create table public.pedido_detalle (
  id uuid default uuid_generate_v4() not null,
  pedido_id uuid not null,
  catalogo_id uuid not null,
  proveedor_id uuid not null,
  cantidad numeric not null,
  costo_referencia numeric not null,
  costo_real numeric,
  capturado_por character varying,
  fecha_captura timestamp with time zone,
  created_at timestamp with time zone default now()
);

create table public.pedido_proveedor_estatus (
  id uuid default uuid_generate_v4() not null,
  pedido_id uuid not null,
  proveedor_id uuid not null,
  estatus character varying default 'pendiente'::character varying not null,
  fecha_envio timestamp with time zone,
  fecha_completado timestamp with time zone,
  token_acceso character varying,
  token_activo boolean default true,
  created_at timestamp with time zone default now(),
  estatus_entrega character varying default 'pendiente'::character varying,
  fecha_entrega timestamp with time zone,
  recibido_por character varying
);

create table public.pedido_reasignaciones (
  id uuid default uuid_generate_v4() not null,
  pedido_detalle_id uuid not null,
  pedido_id uuid not null,
  proveedor_original_id uuid not null,
  proveedor_nuevo_id uuid not null,
  motivo text,
  reasignado_por uuid,
  fecha timestamp with time zone default now()
);

create table public.pedidos (
  id uuid default uuid_generate_v4() not null,
  numero_pedido character varying not null,
  fecha date default CURRENT_DATE not null,
  sucursal_id uuid not null,
  estatus character varying default 'creado'::character varying not null,
  total_teorico numeric default 0,
  total_real numeric default 0,
  creado_por uuid,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  token_acceso character varying,
  token_expira boolean default false
);

create table public.productos_venta (
  id uuid default gen_random_uuid() not null,
  codigo_sr character varying,
  nombre character varying not null,
  categoria character varying,
  precio_venta numeric default 0 not null,
  aplica_iva boolean default true,
  activo boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  es_preparacion boolean default false not null,
  unidad character varying,
  rendimiento numeric default 1 not null
);

create table public.proveedores (
  id uuid default uuid_generate_v4() not null,
  nombre character varying not null,
  tipo_flujo_id uuid not null,
  contacto character varying,
  telefono character varying,
  email character varying,
  activo boolean default true,
  created_at timestamp with time zone default now()
);

create table public.recepcion_detalle (
  id uuid default uuid_generate_v4() not null,
  recepcion_id uuid not null,
  pedido_detalle_id uuid not null,
  cantidad_pedida numeric not null,
  cantidad_recibida numeric default 0 not null,
  estatus_linea character varying generated always as (
CASE
    WHEN (cantidad_recibida = cantidad_pedida) THEN 'completo'::text
    WHEN (cantidad_recibida = (0)::numeric) THEN 'no_entregado'::text
    WHEN (cantidad_recibida < cantidad_pedida) THEN 'faltante'::text
    WHEN (cantidad_recibida > cantidad_pedida) THEN 'excedente'::text
    ELSE NULL::text
END) stored,
  nota text,
  cantidad_esperada numeric default 0,
  tiene_discrepancia boolean default false
);

create table public.recepcion_proveedor (
  id uuid default uuid_generate_v4() not null,
  pedido_id uuid not null,
  proveedor_id uuid not null,
  pedido_detalle_id uuid not null,
  cantidad_pedida numeric not null,
  cantidad_recibida numeric default 0 not null,
  notas text,
  created_at timestamp with time zone default now()
);

create table public.recepciones (
  id uuid default uuid_generate_v4() not null,
  pedido_id uuid not null,
  proveedor_id uuid not null,
  recibido_por text default 'sucursal'::text,
  fecha_recepcion timestamp with time zone default now(),
  estatus_general character varying default 'pendiente'::character varying not null,
  notas text,
  estatus text default 'completo'::text,
  created_at timestamp with time zone default now()
);

create table public.recetas (
  id uuid default gen_random_uuid() not null,
  producto_venta_id uuid not null,
  cantidad numeric default 0 not null,
  merma_pct numeric default 0 not null,
  created_at timestamp with time zone default now(),
  preparacion_id uuid,
  insumo_id uuid
);

create table public.salidas_peps (
  id uuid default uuid_generate_v4() not null,
  movimiento_id uuid,
  lote_id uuid not null,
  cantidad_consumida numeric not null,
  costo_unitario_lote numeric not null,
  costo_total numeric not null,
  created_at timestamp with time zone default now()
);

create table public.sucursales (
  id uuid default uuid_generate_v4() not null,
  nombre character varying not null,
  direccion text,
  activa boolean default true,
  created_at timestamp with time zone default now()
);

create table public.tipos_flujo_costo (
  id uuid default uuid_generate_v4() not null,
  nombre character varying not null,
  quien_captura_precio character varying not null,
  proveedor_ve_pedido boolean default false not null,
  costo_editable boolean default true not null,
  descripcion text,
  created_at timestamp with time zone default now()
);

create table public.unidades_medida (
  id uuid default uuid_generate_v4() not null,
  clave character varying not null,
  nombre character varying not null,
  tipo character varying not null,
  activa boolean default true,
  created_at timestamp with time zone default now()
);

create table public.usuarios (
  id uuid default uuid_generate_v4() not null,
  auth_id uuid,
  nombre character varying not null,
  email character varying not null,
  rol character varying not null,
  sucursal_id uuid,
  proveedor_id uuid,
  puede_editar_catalogo boolean default false,
  activo boolean default true,
  created_at timestamp with time zone default now()
);

create table public.venta_detalle (
  id uuid default gen_random_uuid() not null,
  venta_id uuid not null,
  producto_venta_id uuid not null,
  cantidad numeric default 0 not null,
  precio_unitario numeric default 0 not null,
  importe numeric default 0 not null,
  costo_teorico numeric default 0 not null,
  created_at timestamp with time zone default now()
);

create table public.ventas (
  id uuid default gen_random_uuid() not null,
  sucursal_id uuid,
  fecha date default CURRENT_DATE not null,
  folio character varying,
  origen character varying default 'importado_sr'::character varying not null,
  canal character varying default 'mostrador'::character varying not null,
  subtotal numeric default 0 not null,
  iva numeric default 0 not null,
  total numeric default 0 not null,
  total_efectivo numeric default 0 not null,
  total_tarjeta numeric default 0 not null,
  total_plataforma numeric default 0 not null,
  total_otros numeric default 0 not null,
  costo_teorico numeric default 0 not null,
  estatus character varying default 'activa'::character varying not null,
  nota text,
  registrado_por text,
  created_at timestamp with time zone default now()
);

alter table public.catalogo add constraint catalogo_pkey PRIMARY KEY (id);
alter table public.catalogo_historial add constraint catalogo_historial_pkey PRIMARY KEY (id);
alter table public.categorias_gastos add constraint categorias_gastos_pkey PRIMARY KEY (id);
alter table public.compras_directas add constraint compras_directas_pkey PRIMARY KEY (id);
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_pkey PRIMARY KEY (id);
alter table public.gastos_operativos add constraint gastos_operativos_pkey PRIMARY KEY (id);
alter table public.insumos add constraint insumos_pkey PRIMARY KEY (id);
alter table public.inventario_almacen add constraint inventario_almacen_pkey PRIMARY KEY (id);
alter table public.inventario_sucursal add constraint inventario_sucursal_pkey PRIMARY KEY (id);
alter table public.lotes_almacen add constraint lotes_almacen_pkey PRIMARY KEY (id);
alter table public.mermas add constraint mermas_pkey PRIMARY KEY (id);
alter table public.movimientos_almacen add constraint movimientos_almacen_pkey PRIMARY KEY (id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_pkey PRIMARY KEY (id);
alter table public.pagos add constraint pagos_pkey PRIMARY KEY (id);
alter table public.pedido_detalle add constraint pedido_detalle_pkey PRIMARY KEY (id);
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_pkey PRIMARY KEY (id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_pkey PRIMARY KEY (id);
alter table public.pedidos add constraint pedidos_pkey PRIMARY KEY (id);
alter table public.productos_venta add constraint productos_venta_pkey PRIMARY KEY (id);
alter table public.proveedores add constraint proveedores_pkey PRIMARY KEY (id);
alter table public.recepcion_detalle add constraint recepcion_detalle_pkey PRIMARY KEY (id);
alter table public.recepcion_proveedor add constraint recepcion_proveedor_pkey PRIMARY KEY (id);
alter table public.recepciones add constraint recepciones_pkey PRIMARY KEY (id);
alter table public.recetas add constraint recetas_pkey PRIMARY KEY (id);
alter table public.salidas_peps add constraint salidas_peps_pkey PRIMARY KEY (id);
alter table public.sucursales add constraint sucursales_pkey PRIMARY KEY (id);
alter table public.tipos_flujo_costo add constraint tipos_flujo_costo_pkey PRIMARY KEY (id);
alter table public.unidades_medida add constraint unidades_medida_pkey PRIMARY KEY (id);
alter table public.usuarios add constraint usuarios_pkey PRIMARY KEY (id);
alter table public.venta_detalle add constraint venta_detalle_pkey PRIMARY KEY (id);
alter table public.ventas add constraint ventas_pkey PRIMARY KEY (id);
alter table public.catalogo add constraint catalogo_sku_key UNIQUE (sku);
alter table public.categorias_gastos add constraint categorias_gastos_nombre_key UNIQUE (nombre);
alter table public.inventario_almacen add constraint inventario_almacen_sku_key UNIQUE (sku);
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_pedido_id_proveedor_id_key UNIQUE (pedido_id, proveedor_id);
alter table public.productos_venta add constraint productos_venta_codigo_sr_key UNIQUE (codigo_sr);
alter table public.recepcion_proveedor add constraint recepcion_proveedor_pedido_detalle_id_key UNIQUE (pedido_detalle_id);
alter table public.tipos_flujo_costo add constraint tipos_flujo_costo_nombre_key UNIQUE (nombre);
alter table public.unidades_medida add constraint unidades_medida_clave_key UNIQUE (clave);
alter table public.usuarios add constraint usuarios_auth_id_key UNIQUE (auth_id);
alter table public.usuarios add constraint usuarios_email_key UNIQUE (email);
alter table public.compras_directas add constraint compras_directas_metodo_pago_check CHECK ((metodo_pago = ANY (ARRAY['efectivo'::text, 'transferencia'::text, 'tarjeta'::text, 'credito'::text])));
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_estatus_check CHECK (((estatus)::text = ANY ((ARRAY['pendiente'::character varying, 'parcial'::character varying, 'pagado'::character varying])::text[])));
alter table public.gastos_operativos add constraint gastos_operativos_metodo_pago_check CHECK ((metodo_pago = ANY (ARRAY['efectivo'::text, 'transferencia'::text, 'tarjeta'::text])));
alter table public.insumos add constraint insumos_tipo_control_check CHECK (((tipo_control)::text = ANY ((ARRAY['inventariable'::character varying, 'gasto'::character varying])::text[])));
alter table public.mermas add constraint mermas_motivo_check CHECK (((motivo)::text = ANY ((ARRAY['caducidad'::character varying, 'dano'::character varying, 'produccion'::character varying, 'robo'::character varying, 'ajuste_inventario'::character varying, 'otro'::character varying])::text[])));
alter table public.movimientos_almacen add constraint movimientos_almacen_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['entrada'::character varying, 'salida'::character varying])::text[])));
alter table public.movimientos_sucursal add constraint movimientos_sucursal_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['entrada_recepcion'::character varying, 'entrada_compra_directa'::character varying, 'entrada_ajuste'::character varying, 'salida_venta'::character varying, 'salida_merma'::character varying, 'salida_ajuste'::character varying])::text[])));
alter table public.pedido_detalle add constraint pedido_detalle_capturado_por_check CHECK (((capturado_por)::text = ANY ((ARRAY['proveedor'::character varying, 'compras'::character varying, 'sistema'::character varying])::text[])));
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_estatus_check CHECK (((estatus)::text = ANY ((ARRAY['pendiente'::character varying, 'enviado'::character varying, 'precios_capturados'::character varying, 'completo'::character varying, 'surtido'::character varying, 'recibido_completo'::character varying, 'recibido_con_faltantes'::character varying])::text[])));
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_estatus_entrega_check CHECK (((estatus_entrega)::text = ANY ((ARRAY['pendiente'::character varying, 'entregado'::character varying, 'entregado_parcial'::character varying])::text[])));
alter table public.pedidos add constraint pedidos_estatus_check CHECK (((estatus)::text = ANY ((ARRAY['creado'::character varying, 'en_proceso'::character varying, 'comprado'::character varying, 'cerrado'::character varying])::text[])));
alter table public.recepciones add constraint recepciones_estatus_general_check CHECK (((estatus_general)::text = ANY ((ARRAY['pendiente'::character varying, 'completo'::character varying, 'con_faltantes'::character varying, 'rechazado'::character varying])::text[])));
alter table public.recetas add constraint recetas_no_self CHECK (((preparacion_id IS NULL) OR (preparacion_id <> producto_venta_id)));
alter table public.recetas add constraint recetas_un_insumo CHECK ((((insumo_id IS NOT NULL) AND (preparacion_id IS NULL)) OR ((insumo_id IS NULL) AND (preparacion_id IS NOT NULL))));
alter table public.tipos_flujo_costo add constraint tipos_flujo_costo_quien_captura_precio_check CHECK (((quien_captura_precio)::text = ANY ((ARRAY['proveedor'::character varying, 'compras'::character varying, 'sistema'::character varying, 'sucursal'::character varying])::text[])));
alter table public.unidades_medida add constraint unidades_medida_tipo_check CHECK (((tipo)::text = ANY ((ARRAY['peso'::character varying, 'volumen'::character varying, 'conteo'::character varying])::text[])));
alter table public.usuarios add constraint usuarios_rol_check CHECK (((rol)::text = ANY ((ARRAY['admin'::character varying, 'compras'::character varying, 'sucursal'::character varying, 'proveedor'::character varying, 'almacen'::character varying, 'finanzas'::character varying])::text[])));
alter table public.ventas add constraint ventas_canal_check CHECK (((canal)::text = ANY ((ARRAY['mostrador'::character varying, 'ubereats'::character varying, 'rappi'::character varying, 'didi'::character varying, 'otro'::character varying])::text[])));
alter table public.ventas add constraint ventas_estatus_check CHECK (((estatus)::text = ANY ((ARRAY['activa'::character varying, 'cancelada'::character varying])::text[])));
alter table public.ventas add constraint ventas_origen_check CHECK (((origen)::text = ANY ((ARRAY['importado_sr'::character varying, 'manual'::character varying, 'api'::character varying])::text[])));
alter table public.catalogo add constraint catalogo_actualizado_por_fkey FOREIGN KEY (actualizado_por) REFERENCES usuarios(id);
alter table public.catalogo add constraint catalogo_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES insumos(id);
alter table public.catalogo add constraint catalogo_inventario_almacen_id_fkey FOREIGN KEY (inventario_almacen_id) REFERENCES inventario_almacen(id);
alter table public.catalogo add constraint catalogo_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.catalogo add constraint catalogo_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id);
alter table public.catalogo_historial add constraint catalogo_historial_catalogo_id_fkey FOREIGN KEY (catalogo_id) REFERENCES catalogo(id);
alter table public.catalogo_historial add constraint catalogo_historial_modificado_por_fkey FOREIGN KEY (modificado_por) REFERENCES usuarios(id);
alter table public.compras_directas add constraint compras_directas_catalogo_id_fkey FOREIGN KEY (catalogo_id) REFERENCES catalogo(id);
alter table public.compras_directas add constraint compras_directas_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.compras_directas add constraint compras_directas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.cuentas_por_pagar add constraint cuentas_por_pagar_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id);
alter table public.inventario_almacen add constraint inventario_almacen_unidad_id_fkey FOREIGN KEY (unidad_id) REFERENCES unidades_medida(id);
alter table public.inventario_sucursal add constraint inventario_sucursal_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES insumos(id);
alter table public.inventario_sucursal add constraint inventario_sucursal_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.lotes_almacen add constraint lotes_almacen_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES inventario_almacen(id);
alter table public.mermas add constraint mermas_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES insumos(id);
alter table public.mermas add constraint mermas_inventario_almacen_id_fkey FOREIGN KEY (inventario_almacen_id) REFERENCES inventario_almacen(id);
alter table public.mermas add constraint mermas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.movimientos_almacen add constraint movimientos_almacen_inventario_id_fkey FOREIGN KEY (inventario_id) REFERENCES inventario_almacen(id);
alter table public.movimientos_almacen add constraint movimientos_almacen_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
alter table public.movimientos_almacen add constraint movimientos_almacen_usuario_id_fkey FOREIGN KEY (usuario_id) REFERENCES usuarios(id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES insumos(id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_merma_id_fkey FOREIGN KEY (merma_id) REFERENCES mermas(id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.movimientos_sucursal add constraint movimientos_sucursal_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id);
alter table public.pagos add constraint pagos_cuenta_id_fkey FOREIGN KEY (cuenta_id) REFERENCES cuentas_por_pagar(id);
alter table public.pagos add constraint pagos_registrado_por_fkey FOREIGN KEY (registrado_por) REFERENCES usuarios(id);
alter table public.pedido_detalle add constraint pedido_detalle_catalogo_id_fkey FOREIGN KEY (catalogo_id) REFERENCES catalogo(id);
alter table public.pedido_detalle add constraint pedido_detalle_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
alter table public.pedido_detalle add constraint pedido_detalle_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
alter table public.pedido_proveedor_estatus add constraint pedido_proveedor_estatus_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_pedido_detalle_id_fkey FOREIGN KEY (pedido_detalle_id) REFERENCES pedido_detalle(id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_proveedor_nuevo_id_fkey FOREIGN KEY (proveedor_nuevo_id) REFERENCES proveedores(id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_proveedor_original_id_fkey FOREIGN KEY (proveedor_original_id) REFERENCES proveedores(id);
alter table public.pedido_reasignaciones add constraint pedido_reasignaciones_reasignado_por_fkey FOREIGN KEY (reasignado_por) REFERENCES usuarios(id);
alter table public.pedidos add constraint pedidos_creado_por_fkey FOREIGN KEY (creado_por) REFERENCES usuarios(id);
alter table public.pedidos add constraint pedidos_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.proveedores add constraint proveedores_tipo_flujo_id_fkey FOREIGN KEY (tipo_flujo_id) REFERENCES tipos_flujo_costo(id);
alter table public.recepcion_detalle add constraint recepcion_detalle_pedido_detalle_id_fkey FOREIGN KEY (pedido_detalle_id) REFERENCES pedido_detalle(id);
alter table public.recepcion_detalle add constraint recepcion_detalle_recepcion_id_fkey FOREIGN KEY (recepcion_id) REFERENCES recepciones(id) ON DELETE CASCADE;
alter table public.recepcion_proveedor add constraint recepcion_proveedor_pedido_detalle_id_fkey FOREIGN KEY (pedido_detalle_id) REFERENCES pedido_detalle(id) ON DELETE CASCADE;
alter table public.recepcion_proveedor add constraint recepcion_proveedor_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id) ON DELETE CASCADE;
alter table public.recepcion_proveedor add constraint recepcion_proveedor_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.recepciones add constraint recepciones_pedido_id_fkey FOREIGN KEY (pedido_id) REFERENCES pedidos(id);
alter table public.recepciones add constraint recepciones_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.recetas add constraint recetas_insumo_id_fkey FOREIGN KEY (insumo_id) REFERENCES insumos(id);
alter table public.recetas add constraint recetas_preparacion_id_fkey FOREIGN KEY (preparacion_id) REFERENCES productos_venta(id);
alter table public.recetas add constraint recetas_producto_venta_id_fkey FOREIGN KEY (producto_venta_id) REFERENCES productos_venta(id) ON DELETE CASCADE;
alter table public.salidas_peps add constraint salidas_peps_lote_id_fkey FOREIGN KEY (lote_id) REFERENCES lotes_almacen(id);
alter table public.salidas_peps add constraint salidas_peps_movimiento_id_fkey FOREIGN KEY (movimiento_id) REFERENCES movimientos_almacen(id);
alter table public.usuarios add constraint usuarios_proveedor_id_fkey FOREIGN KEY (proveedor_id) REFERENCES proveedores(id);
alter table public.usuarios add constraint usuarios_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);
alter table public.venta_detalle add constraint venta_detalle_producto_venta_id_fkey FOREIGN KEY (producto_venta_id) REFERENCES productos_venta(id);
alter table public.venta_detalle add constraint venta_detalle_venta_id_fkey FOREIGN KEY (venta_id) REFERENCES ventas(id) ON DELETE CASCADE;
alter table public.ventas add constraint ventas_sucursal_id_fkey FOREIGN KEY (sucursal_id) REFERENCES sucursales(id);

create index if not exists idx_catalogo_proveedor ON public.catalogo USING btree (proveedor_id);
create index if not exists idx_catalogo_tipo ON public.catalogo USING btree (tipo_producto);
create index if not exists idx_catalogo_unidad ON public.catalogo USING btree (unidad_id);
create index if not exists idx_cxp_estatus ON public.cuentas_por_pagar USING btree (estatus);
create index if not exists idx_cxp_pedido_prov ON public.cuentas_por_pagar USING btree (pedido_id, proveedor_id);
create index if not exists idx_cxp_proveedor ON public.cuentas_por_pagar USING btree (proveedor_id);
create unique index if not exists uq_inv_suc_insumo ON public.inventario_sucursal USING btree (sucursal_id, insumo_id);
create index if not exists idx_lotes_inventario ON public.lotes_almacen USING btree (inventario_id);
create index if not exists idx_lotes_restante ON public.lotes_almacen USING btree (existencia_restante);
create index if not exists idx_movimientos_fecha ON public.movimientos_almacen USING btree (fecha);
create index if not exists idx_movimientos_inventario ON public.movimientos_almacen USING btree (inventario_id);
create index if not exists idx_mov_suc_fecha ON public.movimientos_sucursal USING btree (fecha);
create index if not exists idx_mov_suc_insumo ON public.movimientos_sucursal USING btree (insumo_id);
create index if not exists idx_pagos_cuenta ON public.pagos USING btree (cuenta_id);
create index if not exists idx_pagos_fecha ON public.pagos USING btree (fecha_pago);
create index if not exists idx_pedido_detalle_pedido ON public.pedido_detalle USING btree (pedido_id);
create index if not exists idx_pedido_detalle_proveedor ON public.pedido_detalle USING btree (proveedor_id);
create index if not exists idx_ppe_pedido ON public.pedido_proveedor_estatus USING btree (pedido_id);
create index if not exists idx_ppe_proveedor ON public.pedido_proveedor_estatus USING btree (proveedor_id);
create index if not exists idx_ppe_token ON public.pedido_proveedor_estatus USING btree (token_acceso);
create index if not exists idx_reasing_pedido ON public.pedido_reasignaciones USING btree (pedido_id);
create index if not exists idx_pedidos_estatus ON public.pedidos USING btree (estatus);
create index if not exists idx_pedidos_fecha ON public.pedidos USING btree (fecha);
create index if not exists idx_pedidos_sucursal ON public.pedidos USING btree (sucursal_id);
create index if not exists idx_recprov_pedido ON public.recepcion_proveedor USING btree (pedido_id);
create index if not exists idx_recprov_prov ON public.recepcion_proveedor USING btree (proveedor_id);
create index if not exists idx_recepciones_pedido ON public.recepciones USING btree (pedido_id);
create index if not exists idx_recetas_producto ON public.recetas USING btree (producto_venta_id);
create unique index if not exists uq_recetas_prod_ins ON public.recetas USING btree (producto_venta_id, insumo_id) WHERE (insumo_id IS NOT NULL);
create unique index if not exists uq_recetas_prod_prep ON public.recetas USING btree (producto_venta_id, preparacion_id) WHERE (preparacion_id IS NOT NULL);
create index if not exists idx_salidas_lote ON public.salidas_peps USING btree (lote_id);
create index if not exists idx_salidas_mov ON public.salidas_peps USING btree (movimiento_id);
create index if not exists idx_venta_detalle_venta ON public.venta_detalle USING btree (venta_id);
create index if not exists idx_ventas_fecha ON public.ventas USING btree (fecha);