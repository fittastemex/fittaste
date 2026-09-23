-- v7.28 — El conector reporta que sigue vivo
--
-- Reporte de dirección (2026-09-23): "Hola veo que no ha actualizado las
-- ventas el conector, pasó algo?"
--
-- ============================================================
-- POR QUÉ
-- ============================================================
-- El conector se murió el domingo 13-sep a las 15:44 y nos enteramos el
-- 23-sep: 10 días, ~500 tickets, ~$140,000 de venta sin subir. No es la
-- primera vez — 29-jul, 7-ago y 17-ago — y ninguna fue culpa del código:
-- el proceso vivía en una ventana que alguien abría a mano.
--
-- vigilante.bat y las tareas programadas resuelven que se levante solo.
-- Esta tabla resuelve la otra mitad, que es la que de verdad costó caro:
-- NADIE SE ENTERÓ. El conector podía estar muerto y desde afuera se veía
-- igual que un domingo tranquilo. La única señal era "hoy hay pocas
-- ventas", que es exactamente lo que parece un lunes flojo.
--
-- Un latido separa las dos cosas sin ambigüedad:
--   ventas nuevas y latido fresco  -> todo bien
--   sin ventas pero latido fresco  -> está vivo, de verdad no hubo ventas
--   latido viejo                   -> el conector está muerto, ve por él
--
-- Se guarda aparte de `ventas` a propósito. Si el latido viviera en
-- `ventas`, un conector que arranca pero no puede leer SoftRestaurant se
-- vería idéntico a uno muerto, y ése es justo el caso que hay que
-- distinguir para saber a dónde ir a buscar.

CREATE TABLE IF NOT EXISTS public.conector_latido (
  -- Una fila por sucursal: hoy es una, y el día que sean dos el tablero no
  -- cambia. El conector hace UPSERT sobre esta llave en cada ciclo.
  sucursal_id      uuid PRIMARY KEY REFERENCES public.sucursales(id),
  -- Cuándo se reportó por última vez. Ésta es la columna que importa.
  visto_en         timestamptz NOT NULL DEFAULT now(),
  -- Qué versión del sync está corriendo en la PC. Llevamos un mes sin
  -- saber si v7.27 llegó o no; con esto se ve de un vistazo.
  version          text,
  -- Hasta qué fecha de cierre alcanzó a leer. Si avanza, está trabajando;
  -- si el latido es fresco pero esto no se mueve, lee pero no sube.
  ultimo_cierre    timestamptz,
  -- {subidos, fallidos, revisados} del último ciclo.
  ultimo_resultado jsonb,
  -- Nombre de la PC. El día que haya dos, importa cuál se calló.
  host             text
);

COMMENT ON TABLE public.conector_latido IS
  'El conector escribe aquí en cada ciclo. Si visto_en tiene más de ~15 minutos, está muerto: hay que ir a la PC (v7.28).';

-- ============================================================
-- Permisos
-- ============================================================
-- LECCIÓN DE v7.20, repetida aquí porque ya costó 44 horas de ventas: la
-- tabla y el trigger de consumo por ticket se crearon y se probaron como
-- administrador, nunca con el rol que los usa. Faltó el GRANT para `anon`
-- y el conector estuvo dos días sin subir nada. Esta tabla la escribe el
-- conector (anon) y la lee la app (anon): se verifica con
-- `SET LOCAL ROLE anon;` ANTES de darla por buena.
GRANT SELECT, INSERT, UPDATE ON public.conector_latido TO anon, authenticated;
