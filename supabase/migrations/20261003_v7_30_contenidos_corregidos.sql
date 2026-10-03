-- v7.30 — Los siete contenidos rotos, y la guarda para que no vuelvan
--
-- Reporte de dirección (2026-10-03): "veo estos inventarios que están mal y no
-- hace ningún sentido" — orégano a $85 el GRAMO, jamaica a $140 el gramo.
--
-- ============================================================
-- QUÉ ESTABA MAL
-- ============================================================
-- Siete presentaciones con `contenido = 1` sobre insumos medidos en g/ml. El
-- sistema creía que el paquete traía UN GRAMO, así que el precio del paquete se
-- volvía el precio del gramo. Inflaba el inventario $260,000.
--
-- La causa NO era que faltaran los tamaños. En tres casos la presentación
-- correcta ya existía en el catálogo — y estaba DESACTIVADA, con la rota activa
-- a su lado:
--
--   OREGANO   ABA-024  kg  1000  $85   (inactiva)  vs  ABA-096  pz  1  $85  (activa)
--   JAMAICA   VER-025  kg  1000  $190  (inactiva)  vs  ABA-093  pz  1  $190 (activa)
--   GUAYABA   FRU-016  kg  1000  $32   (inactiva)  vs  FRU-024  kg  1  $30  (activa)
--
-- Otros dos se deducían del propio dato: CHILE MORITA se compra en `kg` con
-- contenido 1, y ESENCIA AZAHAR se llama "ESENCIA AZAHAR 120ML".
-- Los dos últimos los dio cocina leyendo el envase: pasta de cacahuate 510 g,
-- mantequilla en aerosol 170 ml.
--
-- ============================================================
-- DE DÓNDE NACEN
-- ============================================================
-- `saveNew` en index.html crea el insumo con unidad_base = unidad de compra y
-- contenido = 1. Eso es CORRECTO: 1 kg por kg. Su propio comentario dice qué
-- pasa después:
--
--   // si es una presentación de un insumo existente, se re-apunta después con Editar.
--
-- Y ahí está el daño: al re-apuntar la presentación a un insumo que se mide en
-- GRAMOS, el contenido se queda en 1 y nadie lo nota hasta ver el inventario en
-- millones. Por eso la guarda de v7.30 vive en `saveEdit` — el punto exacto.
--
-- ============================================================
-- LA CORRECCIÓN
-- ============================================================
-- Arreglar el catálogo NO basta, y esa es la lección de agosto con el ISO
-- PROTEIN CHOCOLATE: `costoInsumo` toma `inventario_sucursal.costo_promedio` sin
-- condiciones, y sólo cae al catálogo cuando no hay promedio. Hay que mover los
-- dos. Por eso cada corrección es un par.
--
-- Se aplicó sobre PROD el 2026-10-03; queda aquí para que el repo lo diga.

UPDATE public.catalogo SET contenido = 1000 WHERE sku = 'ABA-096';  -- OREGANO
UPDATE public.catalogo SET contenido = 1000 WHERE sku = 'ABA-093';  -- JAMAICA
UPDATE public.catalogo SET contenido = 1000 WHERE sku = 'FRU-024';  -- GUAYABA
UPDATE public.catalogo SET contenido = 1000 WHERE sku = 'VER-013';  -- CHILE MORITA
UPDATE public.catalogo SET contenido =  120 WHERE sku = 'ABA-095';  -- ESENCIA AZAHAR 120ML
UPDATE public.catalogo SET contenido =  510 WHERE sku = 'ABA-013';  -- PASTA DE CACAHUATE
UPDATE public.catalogo SET contenido =  170 WHERE sku = 'ABA-081';  -- MANTEQUILLA AEROSOL

-- El costo promedio llevaba el precio del PAQUETE como si fuera el de la unidad
-- base. Se divide entre el contenido real en vez de reponerlo desde el catálogo:
-- así se conserva el precio que de verdad se pagó, que no siempre es el de
-- referencia (jamaica traía $140 con referencia $190).
UPDATE public.inventario_sucursal iv
   SET costo_promedio = ROUND(iv.costo_promedio / c.contenido, 4), updated_at = now()
  FROM public.catalogo c
 WHERE c.insumo_id = iv.insumo_id
   AND c.sku IN ('ABA-096','ABA-093','FRU-024','VER-013','ABA-095','ABA-013','ABA-081')
   AND iv.costo_promedio > 5;   -- sólo las que todavía traen precio de paquete

-- ZARZAMORAS (FRU-004, pz, contenido 1, $80) sigue rota a propósito: hoy tiene
-- existencia 0, así que no infla nada, y nadie ha podido decir qué trae el
-- paquete. La guarda de v7.30 avisará en cuanto alguien la vuelva a tocar.
