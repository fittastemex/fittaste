# Salida a producción — runbook

Estado verificado el 2026-08-01 contra los dos proyectos de Supabase.

## Punto de partida real

| | PROD (`jxyrbvgpjsxevbhaxprr`) | DEV (`whgfrfdqetjttlfsprtt`) |
|---|---:|---:|
| `insumos` | 225 | 235 |
| `catalogo` | 225 | 230 |
| `productos_venta` | **0** | 231 (26 preparaciones) |
| `recetas` | **0** | 890 líneas |
| `inventario_sucursal` | 45 filas · $20,125.31 | 123 |
| `inventario_almacen` | 34 SKU · 66 lotes | sin lotes |
| `pedidos` / `movimientos_almacen` | 39 / 107 | — |
| `ventas` | **0** | 614 |

**Los UUID de `insumos` son idénticos en los dos entornos** (DEV se clonó de
PROD). Verificado con 9 insumos de muestra: mismo `id`, mismo `unidad_base`. Eso
permite copiar `recetas` y `productos_venta` con sus UUID intactos y las llaves
foráneas resuelven solas — no hace falta remapear nada.

**PROD ya tiene las unidades finas** (`g`, `ml`, `pz`). La divergencia de
unidades que documentaba la sección 3 del recetario **ya está resuelta**; lo que
puede seguir difiriendo es `catalogo.contenido`.

Riesgo general: **bajo**. PROD no tiene recetas ni ventas, así que la carga del
recetario es puramente aditiva. Lo que sí tiene valor y no se debe tocar es el
historial de compras (39 pedidos, 66 lotes, $127,108.77 de almacén).

---

## Orden de ejecución

### Paso 0 — Respaldo (2 min)

Supabase tiene respaldo diario automático, pero antes de tocar producción
conviene un punto de restauración manual desde el dashboard
(Database → Backups). Es lo único irreversible si algo sale mal.

### Paso 1 — Código a `main` (yo)

`main` está en **v7.10**. La rama `claude/fittaste-system-expansion-1x0gwd`
tiene 12 commits por delante: v7.11 → v7.14.

Va **primero** porque v7.13 cambia la convención de costeo y v7.14 arregla el
conector. Si los datos se migran antes que el código, el almacén queda costeado
con IVA y la app lo vuelve a escribir así.

Requiere PR con squash merge (la rama `main` está protegida: PR obligatorio,
HTMLHint + Gitleaks). Vercel despliega solo. Un solo archivo sirve los dos
entornos, así que al publicar quedan iguales.

### Paso 2 — Migración de esquema en PROD (yo)

Sólo falta **una**: `20260728_v7_13_costeo_sin_iva.sql`. PROD ya tiene v7.9,
v7.10 y v7.11.

Efecto visible: el capital de almacén pasa de **$143,326.94 a $127,108.77**.
Los $16,218.17 de diferencia eran IVA acreditable contado como costo. **Esto
cambia un número que ya se reportó** — es la única parte del paso 2 que necesita
visto bueno explícito.

### Paso 3 — Recetario DEV → PROD (yo)

En este orden, por las llaves foráneas:

1. `insumos` — los 10 que faltan (mismos UUID).
2. `catalogo` — las 5 presentaciones nuevas y la sincronización de `contenido`.
   **Seguro para el historial de compras**: `pedido_detalle.cantidad` guarda
   unidades de *presentación* y `costo_referencia` es el precio *por
   presentación*, así que cantidad × costo sigue dando el mismo dinero.
3. `productos_venta` — 231 filas, incluidas las 26 preparaciones.
4. `recetas` — 890 líneas.

Verificación al terminar:

```sql
select (select count(*) from productos_venta) prods,      -- 231
       (select count(*) from recetas) lineas,             -- 890
       (select count(*) from recetas r
         where r.insumo_id is not null
           and not exists(select 1 from insumos i where i.id=r.insumo_id)) huerfanas; -- 0
```

### Paso 4 — Conteo físico de sucursal (**ustedes, en la sucursal**)

Las recetas usan **131 insumos**. PROD sólo tiene inventario de **39**. Faltan
**92**.

Sin este conteo, la primera venta deja esos 92 insumos en negativo y el food
cost arranca mal. Es lo único de toda la migración que exige estar en el local,
así que es el mejor uso del tiempo ahí.

Hoja de captura: `Conteo_Sucursal_PROD.xlsx`, ordenada por categoría y por
impacto (los de arriba de cada bloque son los que más recetas tocan). Se cuenta
en la **unidad fina** (g, ml, pz), no en paquetes. Los 6 primeros por impacto:
`SERVILLETA` (47 recetas), `TENEDOR` (44), `TAPA VASO 2 OZ` y `VASO 2 OZ` (24),
`EMPAQUE ALMEJA` (23), `PAPEL ANCERADO 30X30` y `EMPLAYE` (22).

La app ya tiene el módulo de Hoja de conteo para capturarlo.

### Paso 5 — Los 8 tamaños de paquete (**ustedes, en la sucursal**)

Bloquean el **45.9%** del food cost. Con los tres primeros se desbloquea el 44%.

| Insumo | Costo actual (absurdo) | Qué medir |
|--------|-----------------------:|-----------|
| PULPA AGUACATE | $76/pz | ¿cuántas piezas o gramos trae el envase? |
| SALSA WING | **$500/ml** | ¿cuántos ml trae la botella de $500? |
| PULPA GUACAMOLE | $143/g | ¿cuántos gramos trae el paquete? |
| LAUREL | $20/g | ¿cuánto pesa el manojo? |
| ZARZAMORAS / FRAMBUESA | $80/g | ¿cuántos gramos trae la caja? |
| ESENCIA MENTA | $105/ml | ¿cuántos ml trae el frasco? |
| MANTEQUILLA AEROSOL | $55/pz | la receta pide 1 lata entera: ¿son gramos? |

### Paso 6 — Conector a PROD (**ustedes, en la PC del POS**)

1. Copiar el `sync.js` de v7.14 (trae el techo de fallos y el latido). El que
   corre hoy en la PC es la versión anterior.
2. En `conector-sr/config.json`, cambiar `supabase.url` y `supabase.apiKey` a los
   de producción — `config.example.json` ya los trae. Las credenciales de SQL
   Server no cambian.
3. Decidir `estado-sync.json`:
   - **borrarlo** → reprocesa el histórico que SoftRestaurant tenga guardado;
   - **dejarlo** → PROD arranca desde el último ticket que se subió a DEV
     (TKT-8012, 29-jul 11:15) y recupera todo lo de esos días.
   La segunda opción es la que recupera los ~151 tickets pendientes.
4. Levantar con `iniciar-conector.bat` y **ver el primer ciclo completo** en la
   consola antes de irse.

Ojo: los folios son `TKT-<numcheque>` y `ventas.folio` es único. Como PROD no
tiene ventas, no hay colisión posible en el arranque.

### Paso 7 — Verificación en caliente (15 min con la app abierta)

- Entran tickets con `origen='api'` y folio `TKT-*`.
- El Dashboard de ventas **no** muestra el aviso rojo de "conector callado".
- El inventario de sucursal baja al vender, y ningún insumo contado en el paso 4
  se va a negativo en las primeras horas.
- La alarma de "vendido sin receta" sale sólo en los 61 productos conocidos
  (24.3% de la venta), no en los de siempre.

---

## Lo que NO va a estar bien el primer día

Conviene saberlo antes para no perseguir fantasmas:

1. **El food cost estará mal en el 45.9% de la venta** hasta cerrar el paso 5.
2. **24.3% de la venta no tiene receta** (61 productos: PAPAS CAMOTE,
   PROTEIN COOKIE, CHOCOWAFFLES, BOWL BONELESS, COMBO PAREJA…). No descuentan
   inventario.
3. **Los cubiertos se descuentan doble** hasta quitar `TENEDOR` y `SERVILLETA` de
   las 32 recetas de platillo (llegan también en `CON CUBIERTOS`).
4. **El empaque de los bowls se descuenta doble** (bolsa, vaso 2 oz, tapa) porque
   `ENSALADA MIXTA` trae el suyo y llega en el 100% de los bowls.
5. **El descuento de Uber Eats (~10%) no se ve como descuento** en ningún lado:
   sólo como un total más bajo que la suma de líneas.

Ninguno impide arrancar. Los puntos 3 y 4 son decisiones de cocina ya
identificadas; el 5 es una mejora de reporte.
