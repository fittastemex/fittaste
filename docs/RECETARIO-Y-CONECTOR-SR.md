# Recetario y arranque del conector SR — estado al 2026-07-27

Bitácora del diagnóstico del recetario (proyecto DEV) y de lo que falta para
apuntar el conector de SoftRestaurant a producción.

## 1. Cómo está modelado el menú (correcto, no tocar)

SoftRestaurant manda el ticket en **líneas separadas**: el producto base más sus
modificadores. El recetario refleja eso y está bien:

- `WAKANDA SHAKE` (grupo SHAKES) = hielo + cocoa + emplaye + vaso + tapa.
  **La proteína NO va en la base** — llega como modificador.
- `WHEY LOW CARBS` (MODS BEBIDAS) = WHEY PROTEIN VAINILLA 30 g
- `ISO ZERO CARBS` (MODS BEBIDAS) = ISO PROTEIN VAINILLA 30 g
- Las instrucciones de cocina (`SIN CEBOLLA`, `FRIA`, `PREPARADOS`…) están
  marcadas con `sin_insumos=true` y correctamente no consumen nada.

Al revisar un shake aislado *parece* que le falta la proteína. No es así: el
costo real de un shake es la suma de sus líneas de ticket.

## 2. Correcciones aplicadas en DEV el 2026-07-27

### Empaque desactualizado
El recetario venía de la época del vaso de 10 oz. Se re-apuntó:

| Productos | Antes | Ahora |
|-----------|-------|-------|
| 9 shakes + 2 amino refresher + power collagen (12) | VASO/TAPA 10 OZ | **VASO 16 OZ TIPO CRISTAL** + **TAPA PLANA PARA POPOTE** |
| CAFE AMERICANO, CAFFE ESPRESSO DOBLE | VASO/TAPA 10 OZ, cantidad **0** | **VASO 16 OZ BEBIDA CALIENTE** + **TAPA PLANA PARA BEBIDA CALIENTE**, cantidad **1** |

### Las 115 líneas con "?"
La app descarta los insumos inactivos al cargar
(`setInsumos(... .filter(i=>i.activo!==false))`) y el editor de recetas pinta
`"?"` cuando no encuentra el insumo. Cada `"?"` era **un ingrediente que la
receta usa pero que fue desactivado en el catálogo** — probablemente en la
limpieza de julio (ejercicio D/M/R). Nada avisó de la dependencia.

Resolución (115 → 0):
- **CUCHILLO** (30 líneas): ya no se usa → líneas eliminadas.
- **ENVACE 2 OZ** (19 líneas): es el mismo producto que "vaso 2 oz", que es el
  nombre correcto → el insumo se **renombró a `VASO 2 OZ` y se reactivó**
  (conserva sus líneas e historial), y se agregó `TAPA VASO 2 OZ` con la misma
  cantidad en esos 19 productos.
- **TOTOPOS** (3 líneas): la receta va en **gramos** y la compra en paquete de
  **200 g** → el insumo `TOTOPOS HORNEADOS` pasa a `unidad_base='g'` y su
  presentación a `contenido=200`. Para eso existe `contenido`: la sucursal pide
  gramos y el sistema convierte a paquetes al comprar.
- **Resto** (matcha, chile morita, esencia de menta, salsa wing, laurel,
  consomé, frutos rojos, agua, canela…): son ingredientes de platillos que
  siguen vendiéndose → **reactivados**. También se reactivó todo insumo inactivo
  con existencia en almacén (colágenos, aminos, protein cookie).

### Modificadores que consumían sin receta
Capturadas con los gramajes de dirección:

| Modificador | Receta | Costo |
|-------------|--------|------:|
| LECHE DE ALMENDRA (MODS BEBIDAS y MODS CAFE) | 250 ml | $12.25 |
| LECHE DESLACTO LIGHT / DESLACTOLIGHT | 250 ml | $7.25 |
| EXTRA SCOOP PROTEINA WHEY | 30 g | $9.21 |
| EXTRA SCOOP PROTEINA ISO ZERO CARBS | 30 g | $18.27 |

## 3. ⚠️ Divergencia de unidades DEV vs PROD — **113 insumos**

Decisión de dirección (2026-07-27): **DEV es la fuente de la verdad** en unidades,
recetas e insumos. La homologación va de DEV → PROD.

El alcance no son unos cuantos insumos: **113 de los 123 que usan las recetas
difieren**. Es un patrón sistemático, no errores sueltos:

- **PROD** quedó en el modelo viejo: la unidad del insumo *es* la unidad de compra
  (`kg`, `lt`, `pz`, `mj`, `gal`, `lata`) y `contenido = 1`.
- **DEV** usa el modelo correcto de v7.2: el insumo va en **unidad fina de receta**
  (`g`, `ml`, `pz`) y `catalogo.contenido` dice cuánta unidad base trae cada
  presentación de compra.

Ejemplos: CEBOLLA kg→g (contenido 1→1000) · CREMA lt→ml · LECHUGA ITALIANA pz→g
(1 pieza = 200 g) · AGUACATE kg→pz (1 presentación = 5 piezas) · PAN pz→rebanada
(1 bolsa = 14 rebanadas) · SERVILLETA pz→pz (1 paquete = 4,439 servilletas).

### Por qué es seguro hacerlo AHORA (y peligroso después)

Se verificó en el código: `pedido_detalle.cantidad` guarda **unidades de
presentación**, no unidad base (`index.html`, armado de líneas del pedido:
`cantidad: l.calc.unidades`), y `costo_referencia` es el precio **por
presentación**. Por eso el historial de compras de PROD (35 pedidos) **no se
distorsiona**: cantidad × costo sigue dando el mismo dinero.

Y lo más importante: en PROD `inventario_sucursal` y `recetas` están **vacíos**.
No hay existencias ni recetas que reescalar. Una vez que el conector empiece a
descontar inventario de sucursal, este cambio sí se vuelve destructivo.

**Conclusión: la homologación debe ocurrir antes de prender el conector.**

### Verificación de coherencia de costos

Se recalculó el costo por unidad base tras la conversión. Casi todo cuadra:
aguacate $14/pz · manzana $5.83/pz · limón $2/pz · pan $4.43/rebanada ·
whey $307/kg · pollo $89/kg · cebolla $20/kg · leche de almendra $49/L.

**Dos casos a revisar antes de aplicar:**

1. **MIEL**: $110 ÷ 25,000 ml = **$4.40/litro**, demasiado barato. Probablemente
   el `contenido` de 25,000 corresponde a un tambo de 25 kg pero el precio de
   $110 es de una presentación menor. Además hay **7 insumos duplicados**
   ("MIEL AGAVE 25KG" ×3, "MIEL DE AGAVE 25 KG" ×4) que hay que fusionar.
2. **PAPA CAMOTE**: $140 ÷ 466.7 g = **$300/kg**, demasiado caro.

### Duplicado pendiente

`AMINO BCAA PEPINO LIMON` (g, sin existencia, es el que usa la receta) y
`AMINO (BCAA) PEPINO LIMON` (kg, con 29 kg). Fusionarlos **requiere convertir la
cantidad** (5 g = 0.005 kg), no solo re-apuntar.

## 4. Qué falta para apuntar el conector a PROD

El cambio técnico es trivial: en `conector-sr/config.json` de la PC del POS,
apuntar `supabase.url` y `supabase.apiKey` al proyecto de producción
(`config.example.json` ya los trae). Las credenciales de SQL Server no cambian.
Eso es **lo último**, no lo primero.

Bloqueantes reales:

1. **PROD no tiene recetario.** 0 productos de venta, 0 recetas, 0 inventario de
   sucursal. Sin recetas el conector sube ventas pero no descuenta inventario ni
   calcula costo: food cost inútil y utilidad inflada.
2. **Homologar unidades** (sección 3) antes de migrar las recetas.
3. **Cobertura del recetario**: 87 de 231 productos tienen receta (38%). Los
   demás caen en la alarma de "vendidos sin receta". Ver sección 5.
4. **Inventario inicial de sucursal**: está en cero; hace falta un conteo físico
   (el módulo ya tiene la Hoja de conteo). Sin él, los descuentos arrancan en
   negativo.
5. **`estado-sync.json`**: guarda hasta qué ticket se sincronizó y hoy refleja lo
   que subió a DEV. Al apuntar a PROD hay que decidir si se arranca limpio desde
   hoy o se borra el archivo para reprocesar histórico. Si no se toca, PROD
   arranca desde el último ticket visto en DEV y se pierde la historia.
6. **No mezclar con la importación manual** los días que el conector ya subió
   (folios `TKT-*` vs `SR-*`).

## 5. Modificadores que aún consumen sin receta

Además de los ya capturados, siguen sin receta (no descuentan nada):

- **Velvets**: VELVET FRAMBUESA / LYCHEE / MARACUYA
- **Porciones extra**: POLLO/RES/HUEVO/ARRACHERA/ATUN/BONELESS EXTRA,
  PORCION POLLO y RES 100G/200G, PAPA CAMOTE EXTRA
- **Aderezos y salsas**: ADEREZO DE AGUACATE, ADEREZO RANCH FIT, SALSA BUFALO,
  SALSA GUACAMOLE, SALSA AJO PARMESANO, SALSA ORIGINAL, SALSA PIMIENTA LIMÓN,
  SALSA VERDE
- **Wraps/ensaladas**: AGRANDA WRAP, VEGANO CHICO/GRANDE, MEDIA PORCIÓN ×3,
  WRAP 100G/200G ×4

Ojo con el patrón duplicado: existen `100G POLLO` (con receta) y `POLLO EXTRA`
(sin receta), y así con res, huevo, arrachera y atún. Probablemente solo una de
las dos familias se usa en el ticket real.

**Antes de capturar las ~40 restantes**, conviene revisar las 514 ventas que ya
hay en DEV para ver **qué modificadores se venden de verdad** y con qué
frecuencia. Eso reduce la lista a las que importan.

## 6. Composición real de los productos más vendidos (2026-07-28)

Análisis de los **551 tickets** de DEV para responder qué modificadores llegan
con cada platillo. `venta_detalle` no guarda el vínculo padre-hijo que manda
SoftRestaurant, así que la atribución se limita a los **259 tickets (47%) con un
solo platillo principal**; en tickets con 2+ platillos no se puede saber a cuál
pertenece cada modificador. Promedio: 2.94 modificadores por ticket.

Clasificación usada: `productos_venta.grupo_sr LIKE 'MODS%'` o `= 'EXTRAS'` →
modificador; el resto → platillo. 1,016 unidades de platillo vs **1,681 de
modificador**: hay 1.65 modificadores por platillo vendido.

### 6.1 Los modificadores obligatorios (llegan en el 100%)

| Platillo | Modificador | Cobertura |
|----------|-------------|----------:|
| WRAP DE POLLO | `100G POLLO` (49%) + `200G POLLO` (51%) | **100%** |
| WRAP DE POLLO / SANDWICH DE POLLO | `CON CUBIERTOS` + `SIN CUBIERTOS` | **100%** |
| BOWL DE POLLO / CHICKEN BUFFALO / BONELESS | `ENSALADA MIXTA` | **100%** |
| BONELESS FIT + PAPAS GAJO | `ADEREZO RANCH FIT` | **100%** |
| CHILAQUILES FIT | `PREPARADOS` | **100%** |
| Todos los shakes | temperatura + proteína + leche | **100%** |

Los porcentajes de cada familia suman exactamente 100 en todos los casos: el
cajero **siempre** marca una opción. Eso confirma que la porción de proteína, la
leche y los cubiertos deben vivir **solo** en el modificador — es la misma regla
que ya se aplicó a proteína y leche en los shakes.

### 6.2 Doble conteo detectado

1. **Cubiertos.** 32 recetas de platillo traen `TENEDOR` + `SERVILLETA`, y
   `CON CUBIERTOS` (363 u) agrega otro par. Se descuentan ~656 piezas de más por
   cada 551 tickets (~$457 al costo actual de $0.6958 el par). Y al pedir
   `SIN CUBIERTOS` (293 u) el platillo **igual** consume cubiertos que nunca se
   entregaron. Corrección: quitarlos de las 32 recetas y dejar `CON CUBIERTOS`
   como única fuente.
2. **Empaque de bowls.** `ENSALADA MIXTA` (modificador, 100% de los bowls) trae
   su propio empaque completo: bolsa chica + vaso 2 oz + tapa 2 oz + cubiertos.
   El bowl base trae los mismos. Resultado: 2 bolsas, 2 vasos, 2 tapas y 2–3
   pares de cubiertos por bowl (~$6.77 de empaque duplicado). Requiere decisión
   de cocina: ¿la ensalada va en empaque aparte o dentro del mismo bowl?
3. **Verdura de bowls.** El bowl trae lechuga 40 g, jitomate 20 g, zanahoria
   15 g, cebolla morada 10 g, parmesano 5 g y ½ aguacate; `ENSALADA MIXTA` trae
   lo mismo más pepino 35 g y 80 g de lechuga. Un bowl con ensalada descuenta
   120 g de lechuga y **un aguacate entero**. Confirmar si es porción adicional
   real.
4. **Vaso de los shakes.** La receta trae fijo `VASO 16 OZ TIPO CRISTAL` +
   `TAPA PLANA PARA POPOTE`. El 7% que sale `CALIENTE` (6 de 87) debería
   consumir vaso caliente de papel + tapa de papel.

No hay recetas duplicadas: la consulta de líneas repetidas por
`(producto_venta_id, insumo_id)` regresa vacío. Las dos `ENSALADA MIXTA` son
productos distintos (grupo `ENSALADAS`, 12 líneas, y grupo `MODS BOWLS`, 14
líneas con cubiertos), no una receta duplicada.

### 6.3 Los combos: 2 de 5 no necesitan receta

`BREAKFAST POWER GAINS` ($217 prom., 63 u) es sólo el encabezado con el dinero.
SoftRestaurant desglosa sus componentes como líneas aparte a $0: PROTEIN WAFFLES
(85%), OMELETTE A LA MEXICANA (52%), TERMOENERGY COFFE (33%), CAFE AMERICANO
(30%); los cambios premium suben $25. **Ponerle receta duplicaría el costo** —
su `tiene_receta = false` es correcto, no un hueco.

`FITLAQUILES` ($246, 19 u) sí tiene receta propia (los chilaquiles) y el café
llega como línea a $0 en el 72% de sus tickets.

`BONELESS FIT + PAPAS GAJO` ($299, 7 u), `COMBO PAREJA` (9 u) y
`WRAP + PROTEIN SHAKE` (1 u) son combos cerrados: no mandan líneas de
componentes, así que **sí** requieren receta completa.

Consecuencia: **`TERMOENERGY COFFE` (36 u) no tiene receta** y es el café de los
dos combos de desayuno — es la pieza sin costear de mayor volumen.

### 6.4 Corregido en DEV

Gemelos de modificadores de porción resueltos copiando la receta del hermano ya
capturado (mismo criterio que los gemelos de `PROD MENUS`):

| Modificador sin receta | Copiado de |
|------------------------|------------|
| `WRAP 100G ARRACHERA` (13 u) | `100G ARRACHERA` → ARRACHERA 100 g |
| `WRAP 200G ARRACHERA` (2 u) | `200G ARRACHERA` → ARRACHERA 200 g |
| `WRAP 100G DE BONELESS` (3 u) | `100G BONELESS` → preparación 0.364 |

### 6.5 PLATANO resuelto: la unidad correcta es la pieza

Dirección confirmó el criterio: **el plátano se maneja por pieza**. Los 150 de
`CHOCOPLATANO SHAKE` eran gramos = **un plátano completo**, y el 0.5 de
`GREEN BEAST SHAKE` es medio plátano. De hecho 3 de las 4 recetas ya usaban
0.5 pz (`GREEN BEAST`, `AVOCADO`, `PLATANO Y MANZANA`); `CHOCOPLATANO` era la
única en gramos.

Pero mantener la pieza obligaba a un segundo arreglo: `catalogo.contenido` decía
**300 piezas por kilo**, lo que costeaba el plátano a $0.0667 la pieza — 50×
barato. La convención del resto de la fruta es *piezas por kilo*:

| Insumo | Compra | contenido (pz/kg) | Costo/pieza |
|--------|-------:|------------------:|------------:|
| LIMON | $30/kg | 15 | $2.00 |
| MANZANA | $35/kg | 6 | $5.83 |
| NARANJA | $28/kg | 5 | $5.60 |
| AGUACATE | $70/kg | 5 | $14.00 |
| **PLATANO** | $20/kg | ~~300~~ → **6** | ~~$0.0667~~ → **$3.33** |

Aplicado en DEV: `contenido` 300 → 6, receta de `CHOCOPLATANO` 150 → 1 pz, y
`inventario_sucursal.costo_promedio` 0.0667 → 3.3333 (la app le da prioridad
sobre `costo_referencia`, así que sin este último cambio el costo viejo seguía
mandando). El plátano de `CHOCOPLATANO` pasó de $10.00 a $3.33; los otros tres
shakes de $0.03 a $1.67. La existencia negativa de plátano en sucursal (−902 pz)
se corrige al reprocesar el histórico, que ya estaba en el plan.

**`CHILE MORITA`** salió en el mismo barrido: estaba en `pz` con
`contenido = 1` a $95, o sea $95 la pieza. La receta de `SALSA MORITA` pide
0.379, que son **kilos** (0.379 kg × $95 = $36.01 de chile por lote). Se
reetiquetó el insumo a `kg`; el número no cambia, sólo deja de invitar a que
alguien capture "2 chiles".

### 6.6 Hallazgo del barrido: 23 líneas de receta en cantidad 0

Buscando más casos como el plátano apareció algo de mayor impacto: **23 líneas**
en 11 insumos capturados en **cantidad 0**, que por lo tanto no descuentan ni
cuestan nada.

| Insumo | Recetas | Productos afectados |
|--------|--------:|---------------------|
| `EMPAQUE ALMEJA` ($7.01/pz) | 7 | **WRAP DE POLLO (176 u)**, BOWL DE CHICKEN BUFFALO, WRAP DE ATUN A LA VIZCAINA, WRAP BUFFALO, WRAP BRUNCH, WRAP DE ATUN, SANDWICH DE POLLO |
| `BLUEBERRIES` / `FRESAS` | 3 c/u | **WAFFLES FRUTOS ROJOS**, PRESERVICIO FRUTOS ROJOS, PRE SERVICIO COLAGENO |
| `FRAMBUESA` / `ZARZAMORAS` | 2 c/u | PRESERVICIO FRUTOS ROJOS, PRE SERVICIO COLAGENO |
| `JUGO DE NARANJA JUMEX`, `LECHE DE COCO` | 1 c/u | TROPI SHAKE |
| `COMINO`, `EPAZOTE` | 1 c/u | PORCION VIZCAINA, SALSA VERDE |
| `VASO 2 OZ`, `TAPA VASO 2 OZ` | 1 c/u | SANDWICH DE POLLO |

Las berries son las mismas cuyo tamaño de paquete está pendiente, así que el 0
viene de ahí: un waffle de frutos rojos hoy cuesta sin frutos rojos.

### 6.7 `EMPAQUE ALMEJA`: el empaque viaja con el modificador

Dirección resolvió el caso: **el wrap solo no lleva almeja**; la lleva cuando el
cliente pide el adicional de media ensalada. `PAPEL ANCERADO 30X30`, `ALUMINIO`
y `BOLSA DE PAPEL CHICA` se mantienen en el platillo.

Es la misma regla que la proteína, la leche y los cubiertos: **si el empaque
depende del modificador, vive en el modificador**. Aplicado en DEV:

1. Se borraron las **7 líneas** de `EMPAQUE ALMEJA` en cantidad 0 de
   `WRAP DE POLLO`, `WRAP DE ATUN`, `WRAP DE ATUN A LA VIZCAINA`, `WRAP BUFFALO`,
   `WRAP BRUNCH`, `BOWL DE CHICKEN BUFFALO` y `SANDWICH DE POLLO`. Quedan 17
   recetas con almeja en cantidad real (las ensaladas y los bowls, donde sí
   aplica).
2. Se capturó la receta de **`MEDIA PORCIÓN DE ENSALADA MIXTA`** (25 u) y
   **`MEDIA PORCIÓN DE ENSALADA EGG PROTEIN`** (18 u) derivándolas de la ensalada
   completa: **la comida a la mitad, el empaque no se parte**.

| | Completa | Media porción |
|---|---:|---:|
| LECHUGA ITALIANA | 80 g | 40 g |
| PEPINO | 35 g | 17.5 g |
| JITOMATE | 20 g | 10 g |
| ZANAHORIA | 15 g | 7.5 g |
| CEBOLLA MORADA | 10 g | 5 g |
| QUESO PARMESANO | 5 g | 2.5 g |
| AGUACATE | 0.5 pz | 0.25 pz |
| EMPAQUE ALMEJA | 1 | **1** |
| VASO 2 OZ + TAPA | 1 | **1** |
| VINAGRETA DULCE | 1 | **1** |

`EGG PROTEIN` agrega además HUEVO 1 pz (de 2), MANZANA 0.25 pz y ALMENDRAS 3 g.
Se **excluyeron** `BOLSA DE PAPEL CHICA` (ya la trae el platillo) y
`SERVILLETA`/`TENEDOR` (llegan en `CON CUBIERTOS`). Costo resultante de la media
porción mixta: **$17.99**, de los cuales $7.01 son la almeja y $3.50 el aguacate.

Dos supuestos a validar en cocina: que la media porción lleve **vinagreta
completa** (va en un vaso de 2 oz normal, no medio) y que el aguacate se parta en
cuartos.

### 6.8 Por qué crear la presentación no cambiaba el costo (v7.12)

Dirección creó la presentación `GARRAFA AGUA 10 LT` ($40 con 10,000 ml) y la
receta de `SALSA VERDE` siguió costeando el agua a **$40 el mililitro**. El
catálogo estaba bien; el problema es la prioridad de fuentes en `costoInsumo()`:

```js
const inv=(invSucursal||[]).find(i=>i.insumo_id===insumoId);
if(inv&&parseFloat(inv.costo_promedio)>0)return parseFloat(inv.costo_promedio);
```

`inventario_sucursal.costo_promedio` **le gana siempre** al catálogo. Eso es
correcto por diseño — el costo real de compra debe mandar sobre el de referencia,
que es la regla que fijó dirección — pero en DEV ese promedio no viene de compras
reales: lo sembró el conector calculándolo con el `contenido` equivocado. O sea,
basura vieja disfrazada de verdad.

**Causa de fondo:** 11 presentaciones tenían `contenido = 1` con unidad de compra
**kg** e insumo en **gramos**, así que el costo por kilo se estaba usando como
costo por gramo — 1000× de más. Es el mismo error de homologación de una sesión
anterior, en los insumos que quedaron fuera de la corrección de entonces.

Aplicado en DEV:

1. `contenido` 1 → **1000** en las 11 presentaciones (kg → g). Sólo corrige la
   conversión de unidad; el precio por kilo no se toca.
2. `inventario_sucursal.costo_promedio` sincronizado en los **12 insumos**
   desfasados por factor de 1000: AGUA ($40 → $0.004/ml), MATCHA ($1,100 →
   $1.10/g), CONSOME DE POLLO ($80 → $0.08/g), COLAGENO FRESA KIWI, AMINO BCAA
   MANZANA y PEPINO LIMON, BLUEBERRIES, CANELA, LECHE ENTERA, AJO MOLIDO,
   BASE WAFFLE, ENELDO.
3. **`POLLO` se dejó como estaba** ($0.089/g contra $0.130 del catálogo): esa
   diferencia es real, no de unidad — es una compra a mejor precio y debe mandar.

`SALSA VERDE` pasó de **$8,808** a **$10.65** la tanda.

Esto además resuelve tres de los "tamaños de paquete pendientes" — canela,
consomé y berries: el dato nunca faltaba, la presentación ya decía **kg**, sólo
faltaba la conversión a gramos.

**Prevención (código, v7.12):** `origenCosto()` detecta cuando el costo que se
está usando viene del promedio de compra y difiere más de 20% de lo que dice el
catálogo. El editor de recetas marca esas líneas con **⚠** y un tooltip que
explica de dónde salió el número y qué actualizar. Así "corregí la presentación y
no cambió nada" deja de ser invisible.

### 6.9 Convención de IVA: todo el costeo va SIN IVA (v7.13)

Dirección resolvió: **el costeo va sin IVA**. Es lo correcto — el IVA de compras
es acreditable porque Fit Taste factura IVA en la venta, así que el food cost y
la valuación del inventario deben ir sobre el costo neto.

El sistema tenía las dos convenciones mezcladas y el mismo insumo costaba 16%
distinto según por qué camino entrara:

| Camino | Antes | Ahora |
|--------|-------|-------|
| Lote de almacén → `costo_unitario_actual` | `costo_unitario + iva` | **`costo_unitario`** |
| Consumo PEPS (`descontarAlmacenPEPS`) | `costo_unitario + iva` | **`costo_unitario`** |
| Capital de almacén / valor PEPS | con IVA | **sin IVA** |
| Kardex (costo de la entrada) | con IVA | **sin IVA** |
| Fallback del catálogo en `costoInsumo()` | sin IVA | sin IVA (no cambia) |
| `inventario_sucursal.costo_promedio` | heredado del almacén, con IVA | **sin IVA** |

**Lo que SÍ conserva el IVA**, porque es dinero que realmente se paga:

- `montoConIva()` y la cuenta por pagar al proveedor.
- La pantalla de pedido del proveedor (Subtotal / IVA 16% / Gran Total).
- La columna `lotes_almacen.iva`, que se sigue capturando por factura.
- El IVA cobrado en ventas (`ventas.iva`) y el margen, que ya dividía entre 1.16.

La captura de lote ahora dice explícitamente cuál número se usa para costear, y
las columnas del detalle de lotes se renombraron a **"Costo unit. (costeo)"** y
**"Total/u c/IVA"** para que no se confundan.

**Impacto medido:**

- DEV: `MIEL` era el único insumo con el IVA dentro del `costo_promedio`
  ($0.11 → $0.0948/g). Los demás ya venían del catálogo, que siempre guardó neto.
- PROD: el capital de almacén pasa de **$143,326.94 a $127,108.77** — $16,218.17
  eran IVA acreditable contado como costo. **Pendiente de aplicar**: la migración
  cambia un número que dirección ya vio, así que requiere su visto bueno.

Migración: `20260728_v7_13_costeo_sin_iva.sql` (aplicada en DEV). Recostea
`costo_unitario_actual` desde el lote más reciente y le quita el IVA a los
`costo_promedio` que estén entre 1.10× y 1.22× del catálogo con `aplica_iva`.

Pruebas: `e2e-almacen.js` ahora carga el lote con **$50 + $8 de IVA** y verifica
en 3 puntos que lo que viaja a sucursal, al movimiento y a la salida PEPS es
**$50**, no $58. Total: 102/102.

**Historia previa sin recostear:** los `movimientos_almacen` y `salidas_peps` ya
registrados guardan el costo con IVA. No se tocaron: son el registro de lo que
pasó bajo la convención anterior. Si se quiere una serie histórica homogénea hay
que recostearlos aparte — decisión pendiente.

### 6.10 Pendiente de decisión

- **32 modificadores** con consumo real y sin receta, encabezados por
  `ADEREZO RANCH FIT` (43 u), `PAPA CAMOTE EXTRA 100G` (35 u) y las 10 salsas.
- **`MEDIA PORCIÓN DE ENSALADA ESPINACAS Y LECHUGA`** (10 u) no se pudo derivar:
  su ensalada completa (`ENSALADA DE ESPINACAS Y LECHUGA`, grupo `ENSALADAS`, y
  su gemela de `MODS BOWLS`) tampoco tiene receta. Es la única de las tres medias
  porciones que sigue en cero.
- **16 líneas siguen en cantidad 0**: las berries de `WAFFLES FRUTOS ROJOS` y los
  dos preservicios (falta tamaño de paquete), `JUGO DE NARANJA JUMEX` y
  `LECHE DE COCO` de `TROPI SHAKE`, `COMINO`, `EPAZOTE`, y el
  `VASO 2 OZ` + `TAPA` de `SANDWICH DE POLLO`. Este último probablemente es el
  mismo caso de la almeja — el vaso de aderezo viaja con la ensalada — pero se
  dejó sin tocar por no estar confirmado (el `VASO 2 OZ` de los wraps sí es real:
  es la salsa morita).
- **Duplicados a unificar antes de capturar**: `SALSA PIMIENTA LIMÓN` /
  `SALSA PIMIENTA LIMON` (con y sin acento, en dos grupos), `POLLO EXTRA`,
  `RES EXTRA` y `SALSA AJO PARMESANO` (cada uno en dos grupos).
- **20 platillos** vendidos sin receta; 4 de ellos son reventa (agua, Velvet
  Soda, Electrolit, Power Collagen) y sólo necesitan 1 pz del insumo.

Detalle completo en `Composicion_Productos_FitTaste.xlsx` (6 hojas: top ventas,
composición platillo×modificador, matriz de shakes, estructura de combos, doble
conteo y backlog de recetas por volumen).

## 7. Caída del conector — 29-jul-2026 (v7.14)

### Qué pasó

El conector dejó de subir ventas **el 29 de julio a las 11:15 hora local**
(17:15 UTC), a media jornada, después del ticket `TKT-8012`. No volvió a correr.
Se detectó el 1 de agosto: **3 días sin registrar venta**.

| Día | Tickets | Primera venta | Última venta |
|-----|--------:|---------------|--------------|
| 27-jul | 75 | 08:07 | 17:39 |
| 28-jul | 45 | 08:22 | 18:02 |
| **29-jul** | **18** | 08:09 | **11:15 ← se detuvo** |
| 30-jul a 1-ago | **0** | — | — |

Horas en formato local (UTC−6). El patrón normal es de ~08:00 a ~18:00, así que
el corte de las 11:15 es a media operación, no un cierre de turno.

### Qué NO fue

- **No hubo pérdida silenciosa de tickets.** Los folios `TKT-*` van perfectamente
  consecutivos hasta el 8012, sin un solo hueco. Nada se saltó: el proceso
  simplemente dejó de correr.
- **No fue el estado envenenado.** `ultimoCierre` no saltó al futuro (todas las
  ventas tienen fecha coherente), así que el conector no quedó "ciego".
- **No fueron los cambios en DEV.** La migración `v7_11_ventas_folio_unico` se
  aplicó el 28-jul a las 01:03 y ese día entraron 45 tickets sin problema.

Lo más probable es que se haya cerrado la ventana del conector en la PC del
punto de venta (o que la PC se reiniciara). Eso no se puede verificar desde
aquí: hay que mirar la máquina.

### Lo que se recupera solo

`SQL_TICKETS` lee `cheques` con `cierre > @desde`, así que **al reiniciar el
conector recupera todo lo pendiente** desde el último corte guardado. Los
tickets siguen en SQL Server; no hay que capturarlos a mano. Estimado de lo que
entrará: **~151 tickets / ~$44,585** (promedio de 50.2 tickets y $14,861 por día
sobre los 6 días previos, por 3 días).

### Dos defectos reales que salieron al revisar

**1. Un ticket que fallaba al subir se perdía para siempre, sin rastro.**

En los dos `continue` de error (`ventas` no se pudo insertar, o falló el detalle
y se revirtió) el código no llamaba a `avanzar(t)` — correcto — pero el
**siguiente** ticket bueno sí movía `ultimoCierre` más allá del que falló. Como
el query es `cierre > @desde`, ese ticket nunca se volvía a ver.

Con el índice único `ux_ventas_folio` que se agregó en v7.11 esto pasó de
improbable a esperable: cualquier colisión de folio se traga el ticket.

Corregido: el primer fallo del ciclo pone un **techo** y `avanzar()` no lo
rebasa. El estado se queda justo antes y el próximo ciclo lo reintenta (la
dedup por folio evita duplicar lo que sí entró). Al final del ciclo imprime en
rojo qué folios quedaron pendientes y hasta dónde se detuvo el avance.

**2. La única señal de vida era una consola en la PC del POS.**

Por eso pasaron 3 días. Ahora hay dos cosas:

- `estado-sync.json` guarda `ultimaCorrida` y `ultimoResultado`
  (`{subidos, fallidos, revisados}`), para distinguir "está vivo y no hubo
  venta" de "está muerto".
- El **Dashboard de ventas** muestra un aviso rojo cuando la última venta con
  `origen='api'` tiene más de 6 horas, con la fecha exacta, qué revisar y la
  aclaración de que los tickets no se pierden al reiniciar.

Pruebas: 105/105 (74 suite principal + 12 almacén + 19 variantes). Las 3 nuevas
verifican que el aviso aparece, cuantifica la antigüedad en días y explica que
no hay pérdida.

## 8. Detalle de ventas de julio 2026 en DEV

**El periodo NO es el mes completo.** El conector arrancó el 17 de julio y se
cayó el 29 a las 11:15, así que hay **13 días** (17–29) y faltan el 1–16 y el
30–31. Cualquier comparación mensual con esto es inválida.

| | |
|---|---:|
| Tickets | 614 |
| Venta cobrada | $184,577.55 |
| Ticket promedio | $300.61 |
| Venta por día | $14,198.27 |

### 8.1 Los $19,467 que no se veían

La suma de las líneas del ticket da **$204,045** pero lo cobrado es
**$184,577.55**. La diferencia de **$19,467.45** no es un error de captura: es el
descuento de plataforma, y se comprueba porque parte **exactamente** por canal.

| Canal | Tickets | Valor de menú | Cobrado | Diferencia |
|-------|--------:|--------------:|--------:|-----------:|
| Uber Eats | 556 | $190,620.00 | $171,152.55 | **−$19,467.45 (10.2%)** |
| Mostrador | 58 | $13,425.00 | $13,425.00 | **$0.00** |

Mostrador cuadra al centavo; todo el descuento vive en Uber Eats y ronda el 10%.
La app no lo muestra como línea de descuento en ningún lado — aparece sólo como
un total más bajo. **Vale la pena exponerlo**: es el 10.2% del valor de menú y
Uber es el 93% de la venta.

### 8.2 Mezcla

| Grupo | Venta de menú | % |
|-------|--------------:|--:|
| WRAPS | $57,926 | 28.4% |
| COMBOS FIT | $30,145 | 14.8% |
| SANDWICHES | $29,425 | 14.4% |
| ANTOJITOS | $23,048 | 11.3% |
| SHAKES | $11,717 | 5.7% |
| BOWLS | $10,915 | 5.3% |

`WRAP DE POLLO` solo es el **18.9%** de la venta (195 u, $38,567). Formas de
pago: plataforma $171,152.55 · tarjeta $10,495 · efectivo $2,930.

Mejor día: **lunes 20 de julio, $24,283.90 en 85 tickets**. Peor: domingo 26 con
$7,513.65.

### 8.3 El food cost de julio NO es publicable

El `costo_teorico` **guardado** en los tickets de julio suma **$2,897,493** sobre
una venta de $184,577 (1,570%). Es basura: se calculó cuando el agua costaba
$40/ml, el matcha $1,100/g y el consomé $80/g. **Ese campo no se puede usar**;
hay que recostear el histórico.

Al recalcular con los costos ya corregidos siguen saliendo $2.17M, porque quedan
**8 insumos con el mismo defecto de presentación** (`pz x1`, o sea el paquete
completo tratado como una unidad de receta):

| Insumo | Costo actual | Venta bloqueada | Qué falta preguntar |
|--------|-------------:|----------------:|---------------------|
| PULPA AGUACATE | $76/pz | $64,532 | ¿cuántas piezas o gramos trae? |
| SALSA WING | **$500/ml** | $18,423 | ¿cuántos ml trae la botella de $500? |
| PULPA GUACAMOLE | $143/g | $6,753 | ¿cuántos gramos trae el paquete? |
| LAUREL | $20/g | $2,260 | ¿cuánto pesa el manojo? |
| ZARZAMORAS / FRAMBUESA | $80/g | $987 | ¿cuántos gramos trae la caja? |
| ESENCIA MENTA | $105/ml | $665 | ¿cuántos ml trae el frasco? |
| MANTEQUILLA AEROSOL | $55/pz | — | la receta pide 1 lata entera: ¿son gramos? |

`SALSA WING` a $500/ml es lo que hace que `BONELESS FIT` cueste **$40,040** por
orden: la receta pide 80 ml.

Reparto de la venta según qué tan confiable es su costeo:

| Estado | Productos | Venta de menú | % |
|--------|----------:|--------------:|--:|
| Confiable | 66 | $60,883 | 29.8% |
| Costo dudoso (8 insumos) | 15 | $93,620 | 45.9% |
| Sin receta | 61 | $49,542 | 24.3% |

**El único food cost defendible: 28.8%**, medido sobre los **34 tickets**
($7,004) cuyos productos son todos confiables. Muestra chica (5.5% de los
tickets) y sesgada a mostrador — sirve de referencia, no de cierre.

Con sólo tres datos —pulpa de aguacate, salsa wing y pulpa de guacamole— se
desbloquea el **44%** de la venta.

Resueltos en el mismo barrido, porque la unidad de compra ya daba el factor:
`SALSA DE SOYA` (1 lt = 1000 ml, $0.11/ml) y `ACEITE VEGETAL` (1 gal = 3785 ml,
$0.0254/ml).

Entregable: `Ventas_Julio2026_FitTaste_DEV.xlsx` (6 hojas: resumen, día por día,
top 25 productos, grupos, diagnóstico del food cost y los 8 bloqueadores).

## 9. Alta de insumo que "no aparece" — 8-ago-2026 (v7.17)

**Reporte:** Fernanda dio de alta el insumo `ALBUMINA DE HUEVO` con su
presentación de compra y no le aparecía en el sistema.

**Verificación:** el registro **no existe en ninguno de los dos entornos**. No
es un problema de visibilidad ni de `activo=false` (que ya nos había mordido tres
veces): nunca se escribió.

```
insumos  ilike '%albumin%'   → 0 filas en PROD y en DEV
insumos  más recientes       → COMINO, 2026-08-01 18:50 (nada nuevo desde
                               la migración del 1-ago)
catalogo más reciente        → INS-COMINO / ABA-085, 2026-08-01 19:19
```

Descartado además: RLS está apagada en `insumos`, `catalogo` y `proveedores`
(los INSERT del anon sí pasan); `insumos` no tiene UNIQUE en `nombre`; las
columnas NOT NULL de las dos tablas son exactamente las que manda la app; y
sólo existen dos proyectos Supabase, así que no se guardó "en otro lado".

**Causa raíz — el aviso quedaba detrás del popup.** El popup de alta es
`fixed inset-0 z-50` con un overlay negro al 45 %. Todos sus avisos se
escribían con `setMsg(...)`, y ese banner se renderiza **en el cuerpo de la
vista de Catálogo**, o sea *debajo* del overlay. Resultado:

1. Faltaba el proveedor (es el único campo obligatorio sin valor por omisión:
   arranca en `Seleccionar...`).
2. `guardarNuevo` hacía `setMsg("Elige el proveedor"); return;` — antes incluso
   de `setSaving(true)`, así que el botón no cambiaba a "Guardando...".
3. El popup se quedaba abierto y **nada visible cambiaba**. Se interpreta como
   guardado y se cierra con la ✕.

El mismo camino silencioso aplicaba a los errores del servidor. Y como
`guardarNuevo` borra el insumo cuando falla la presentación
(`if(createdIns) await sbDelete("insumos", insumoId)`), un fallo en el segundo
INSERT dejaba cero rastro — coherente con lo que se observó.

**Corregido en v7.17:**

* Aviso propio del popup (`modalMsg`), renderizado **dentro** del popup, arriba
  de los botones, siempre en rojo. Los textos ahora dicen qué falta y en qué
  paso: *"Falta elegir el proveedor (paso 2). Sin proveedor no se puede guardar
  la presentación."*
* El error del servidor ya no se adivina: el alta del insumo pasó de `sbPost` a
  `sbPostE`, así que en lugar de `"Error al crear el insumo (¿nombre
  repetido?)"` se ve el mensaje real de Postgres.
* Cuando el alta falla se dice explícitamente **"No se guardó nada."**, porque
  el rollback del insumo lo hace verdad.
* Los tres campos obligatorios llevan `*` y el selector de proveedor se pinta
  con borde rojo mientras esté vacío.

**Regresión cubierta:** `herramientas/prueba-e2e/e2e-alta-insumo.js` (12
verificaciones). La clave es la 5, que comprueba que el aviso esté dentro de
`.fixed.inset-0.z-50`; con el código anterior falla. Ojo: la 4 (`isVisible`) no
alcanza por sí sola — para Playwright un banner tapado por un overlay sigue
siendo "visible".
