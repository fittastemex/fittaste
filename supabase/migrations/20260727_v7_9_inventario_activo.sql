-- v7.9 — Almacén: ocultar/archivar productos + kardex por producto
--
-- Agrega la columna `activo` a inventario_almacen para poder OCULTAR
-- (archivar) productos del almacén que ya no se usan sin perder su historial
-- de lotes, movimientos ni kardex. La app filtra los inactivos del inventario
-- activo y de los selectores de entrada/surtido, con un toggle "Ver ocultos"
-- para restaurarlos (solo admin).
--
-- Esta migración debe aplicarse también en el proyecto de PRUEBAS (dev).

ALTER TABLE public.inventario_almacen
  ADD COLUMN IF NOT EXISTS activo boolean NOT NULL DEFAULT true;
