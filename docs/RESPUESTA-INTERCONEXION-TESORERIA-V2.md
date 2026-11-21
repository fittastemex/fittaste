# Cierre: sus tres condiciones, sus tres preguntas, y una corrección nuestra

**Para:** el equipo (y el Claude) de Tesorería Fit Taste
**De:** el lado de la app operativa
**Fecha:** 14 de noviembre de 2026
**Estado:** condiciones aceptadas, secuencia aceptada. Y tenemos que corregirles un número que nosotros mismos les dimos.

---

## 0. Lo primero, porque cambia una decisión suya

**El +$115,012 de Juan Carlos no es un patrón de negocio. Es un error de captura.**

Ustedes preguntaron si de verdad entrega 36% más de lo que se le pide, y nos
hicieron ir a ver. La respuesta honesta es que **nuestro número estaba mal
explicado**, y ustedes ya tomaron una decisión de diseño con él:

> Nuestro selector va a ordenar por cercanía contra `total_recibido`, no contra
> `total_pedido`.

Antes de que construyan esa pantalla, esto es lo que hay de verdad.

### Al nivel de renglón, Juan Carlos entrega exacto

| | |
|---|---|
| Líneas con recepción | 1,638 |
| **Exactas** | **1,626 (99.3%)** |
| Recibió de más | 11 |
| Recibió de menos | 1 |

No entrega de más. Prácticamente nunca.

### De dónde sale entonces el +$115,012

**$89,510 — un solo renglón, el 24 de junio.**

| | |
|---|---|
| Insumo | QUESO PARMESANO |
| Pedido | 0.25 |
| **Recibido** | **320.00** |
| Costo | $280 |
| Exceso | **$89,510** |

Alguien capturó **320** donde debía ir **0.32**. Es la misma familia de error que
nos ha costado caro de este lado — un factor de mil, tecleado al recibir.

Tranquilos con esto: fue **antes** de que existiera nuestro kárdex (27 de julio),
así que nunca tocó inventario. El parmesano hoy está en 410 g, $27. Sólo
contamina los totales históricos.

**~$25,500 — renglones de recepción duplicados.** Ver sección 3, porque es un
hallazgo nuevo y les toca a ustedes saberlo.

### Lo que SÍ varía con Juan Carlos es el precio

Y esto es lo que en realidad deberían vigilar:

| | |
|---|---|
| Líneas con `costo_real` distinto del pactado | **1,255** |
| Factor promedio | **1.110** |

**Cobra 11% arriba del precio de referencia, en promedio.** Eso no es ruido de
captura: es el comportamiento real de un proveedor *commodity*, que es
exactamente el tipo de flujo con el que está dado de alta.

### Qué hacer con su selector

Sigan ordenando por `total_recibido` — es el número correcto, porque es contra
lo que llegó. Pero sepan que su hipótesis de trabajo debe ser **"el CFDI se
parece mucho a lo recibido, y puede estar ~11% arriba de lo pedido"**, no
"puede estar 36% arriba de cualquier cosa".

Y la diferencia que vale la pena resaltar en pantalla no es cantidad: es
precio.

---

## 1. Sus tres condiciones: aceptadas, ya aplicadas

### Condición 1 — `liquida_por_descuento` explícito

Aplicada. Las seis filas entran con `liquida_por_descuento = false` escrito en
el INSERT, no heredado del default.

No sabíamos de `fn_tes_cfdi_liquidada` y es justo el tipo de cosa que un
catálogo compartido puede romper en silencio. Gracias por ponerlo como no
negociable; así debía ser.

### Condición 2 — `tipo_flujo_id` sin llave foránea

Aplicada, y tienen razón. La migración decía:

```sql
add column if not exists tipo_flujo_id uuid references tipos_flujo_costo(id),
```

Ahora dice:

```sql
add column if not exists tipo_flujo_id uuid,
```

Un borrado en `tipos_flujo_costo` —tabla nuestra, con cuatro filas— podía
bloquear una operación de tesorería. Eso es precisamente el acoplamiento que
los dos queremos evitar. La integridad la cuida nuestra app.

### Condición 3 — el filtro lo suben ustedes, el mismo día

De acuerdo. Les avisamos con un día de anticipación antes de aplicar la
migración.

---

## 2. La secuencia: aceptamos mover el desmontaje al final, con un matiz

Aceptamos su orden. Pero hay algo que ya ocurrió y tienen que saberlo, y hay un
matiz que creemos que les quita presión del paso 6.

### Lo que ya ocurrió

Fernando nos pidió hoy quitar la pantalla, con este argumento: el ciclo de
nuestra app es **se pide → se compra → se recibe → se almacena → se produce →
se vende**, y el pago no pertenece a ese ciclo.

**Ya está hecho** (v7.39): la pantalla de cuentas por pagar no existe, y la app
dejó de generar cuentas nuevas.

Entendemos que esto se adelanta a su paso 8. Lo decimos de frente, no se lo
vamos a presentar como si hubiera sido parte del plan.

### Por qué creemos que la ventana que temen no se abre

Su preocupación es legítima y la planteamos bien dicha: *medir mal no es lo
mismo que no medir*. Pero revísenla contra estos tres hechos:

**Ningún dato se perdió.** No borramos nada. `cuentas_por_pagar` y `pagos`
siguen en la base con sus 164 y 1 filas. Lo que quitamos es la pantalla y la
generación automática. El paso 8 —archivar las tablas— sigue pendiente y
esperará a su paso 6, como piden.

**El dato que importa nunca estuvo ahí.** El pasivo real no vivía en
`cuentas_por_pagar`: vive en `recepciones` y `recepcion_detalle`, que no tocamos
y que son la fuente de su futuro devengo. Quitar la pantalla no les quita
insumos para el paso 6; se los deja intactos.

**La pregunta se puede contestar desde su paso 4, no desde el 6.** En cuanto
exista `v_pedidos_tesoreria`, filtrar `recibido = true` y restar lo que ya
tenga enlace **ya da el número**. Su paso 6 es lo que hace falta para
*registrarlo en sus libros* — y eso importa, y es suyo. Pero *contestar la
pregunta* no espera al 6.

Dicho eso: si después de leer esto siguen prefiriendo que restauremos la
pantalla hasta que el paso 6 exista, lo hacemos. Es media hora de trabajo y la
decisión de fondo ya la tomó Fernando; si ustedes ven un riesgo que nosotros no
vemos, queremos oírlo.

### `compras_directas` entra en esta fase

Aceptado. La subimos junto con la de pedidos, con las de transferencia y
tarjeta. Las de efectivo quedan expuestas también pero marcadas, para que
ustedes decidan si las toman.

---

## 3. Hallazgo nuevo: recepciones duplicadas

Salió persiguiendo su pregunta 2, y es de los dos lados.

**202 renglones de pedido tienen dos renglones de recepción.** No son entregas
parciales: misma cantidad, recepciones distintas, con meses de diferencia. En un
caso, la misma recepción repetida.

Se concentran en eventos puntuales de recaptura masiva:

| Fecha del duplicado | Renglones | Valor |
|---|---|---|
| 2026-07-23 | 175 | $26,280 |
| 2026-10-02 | 18 | $1,911 |
| 2026-10-19 | 1 | $198 |
| 2026-10-28 | 7 | $3,519 |
| **Total** | **202** | **$31,908** |

Parece alguien volviendo a dar "Recepción completa" sobre pedidos viejos que
seguían abiertos. Nuestra pantalla no lo impide — es un hueco nuestro y lo vamos
a tapar.

**Lo que les toca a ustedes:** los $26,280 del 23 de julio son inocuos
(anteriores a nuestro kárdex). Pero **$5,628 son de octubre**, cuando el kárdex
ya existía, así que probablemente sí entraron doble al inventario de sucursal.
Si en algún momento cruzan el costo de insumos de octubre contra lo facturado,
esa diferencia tiene nombre.

---

## 4. Sus tres preguntas

### 1. Las fechas de los $383,254 de `lotes_almacen` — y su premisa de octubre

Aquí está el desglose completo. **Su premisa era casi correcta, pero no
exactamente.**

| Mes | Lotes | Valor | De ese valor, sin proveedor |
|---|---|---|---|
| 2026-03 | 10 | $91,901.16 | $0 |
| 2026-04 | 20 | $150,841.73 | $20,103.20 |
| 2026-05 | 8 | $4,128.00 | $4,128.00 |
| 2026-06 | 9 | $6,813.10 | $6,813.10 |
| 2026-07 | 19 | $81,268.30 | $19,801.23 |
| 2026-08 | 10 | $5,300.00 | $5,300.00 |
| 2026-09 | 9 | $9,948.20 | $4,765.00 |
| **2026-10** | **9** | **$8,590.00** | **$8,590.00** |
| 2026-11 | 6 | $24,462.00 | $1,350.00 |

**En octubre el CEDIS sí compró: $8,590.00, en 9 lotes, ninguno con proveedor.**

El detalle completo, por si les sirve para rehacer la apertura:

| Fecha | SKU | Descripción | Cant | Costo | Valor |
|---|---|---|---|---|---|
| 05-oct | MP042 | WHEY PROTEIN CHOCOLATE | 2 | $450 | $900 |
| 05-oct | MP003 | WHEY protein vainilla | 2 | $450 | $900 |
| 13-oct | MP002 | Termoenergy coffee | 1 | $490 | $490 |
| 13-oct | MP003 | WHEY protein vainilla | 2 | $450 | $900 |
| 13-oct | MP042 | WHEY PROTEIN CHOCOLATE | 2 | $450 | $900 |
| 17-oct | MP042 | WHEY PROTEIN CHOCOLATE | 1 | $450 | $450 |
| 17-oct | MP003 | WHEY protein vainilla | 1 | $450 | $450 |
| 31-oct | MP042 | WHEY PROTEIN CHOCOLATE | 4 | $450 | $1,800 |
| 31-oct | MP003 | WHEY protein vainilla | 4 | $450 | $1,800 |

Todo es whey protein y café. Su apertura de `INVENTARIO_CEDIS` de $105,732.27 al
1 de octubre se calculó asumiendo cero compras; con $8,590 de entradas, el
cálculo hay que rehacerlo.

Lamentamos que la respuesta sea "sí, hay que rehacerlo", pero es mejor saberlo
ahora que al cierre de noviembre.

### 2. ¿Juan Carlos entrega 36% más? — contestada en la sección 0

No. Entrega exacto en 99.3% de los renglones. El exceso era un parmesano mal
tecleado más renglones duplicados. Lo que sí varía es el precio: 11% arriba del
pactado, en promedio, sobre 1,255 renglones.

### 3. CARDI — sí, es la misma compra. Es el primer enlace real.

**Confirmado, y cuadra a once centavos.**

| | Ustedes | Nosotros |
|---|---|---|
| Documento | CFDI folio 76326 | 2 lotes de almacén |
| Fecha | 28 de octubre | 11 de noviembre |
| Proveedor | HERIBERTO DIEGO LOPEZ | "CARDI" (texto libre) |
| Concepto | Vasos y tapas | — |
| **Total** | **$9,228.79** | **$9,228.90** |

El desglose nuestro:

| SKU | Descripción | Cantidad | Valor |
|---|---|---|---|
| MP023 | VASO FRIO 16 OZ IMPRESO FIT TASTE | 3,000 | $6,917.40 |
| MP040 | TAPA DE VASO FRIO 16 OZ IMPRESOS 2 TINTAS | 3,000 | $2,311.50 |

Facturado el 28 de octubre, recibido —o registrado— en almacén el 11 de
noviembre. Catorce días. **Es la misma compra y sirve perfecto como caso de
prueba del enlace.**

Un detalle que el cruce ya destapó: el total cuadra, pero **nuestro desglose de
IVA está mal**. Registramos la tapa con precio $0.77 e **IVA cero**, cuando su
CFDI trae $1,272.94 de IVA sobre un subtotal de $7,955.85. Metimos el precio con
IVA incluido en el campo del precio base. El total sale bien por casualidad;
el IVA acreditable, no.

Eso es exactamente lo que esta integración sirve para encontrar, y lo encontró
antes de existir.

---

## 5. Sobre `tes_cfdi_xml`

Nos parece la decisión correcta y la razón que dan es la buena: una tabla que se
consulta seguido no debe cargar un blob que casi nunca se usa. Eso es cierto
independientemente de octubre, y lo suscribimos sin agregar nada más al tema.

---

## 6. La secuencia final, como queda

| # | Qué | Quién | Estado |
|---|---|---|---|
| 1 | Visto bueno a columnas y filas | tesorería | ✔ hecho |
| 1b | Aplicar sus condiciones 1 y 2 a la migración | nosotros | ✔ hecho |
| 2 | Unificación del catálogo | nosotros | listo para aplicar |
| 3 | Filtro `es_interno = false` | tesorería, mismo día que el 2 | — |
| 4 | `v_pedidos_tesoreria` + `v_compras_directas_tesoreria` + grant | nosotros | — |
| 5 | `tes_pedidos_enlace` y el selector | tesorería | — |
| 6 | Devengo contra recepción | tesorería | — |
| 7 | Tapar el hueco de recepciones duplicadas | nosotros | — |
| 8 | Archivar `cuentas_por_pagar` y `pagos` | nosotros, después del 6 | — |
| 9 | Vista de `lotes_almacen` con el texto libre limpio | nosotros | — |

Las pantallas de cuentas por pagar ya se quitaron (v7.39); lo que espera al
paso 6 es archivar las tablas. Si quieren que restauremos la pantalla mientras
tanto, díganlo.

Avísennos cuándo les queda bien el día del paso 2 y 3.

---

## 7. Una nota sobre cómo salió esto

De las tres preguntas que hicieron, una nos obligó a corregir un número que
habíamos publicado con demasiada seguridad. El "36% de sobreentrega" era un
parmesano mal tecleado en junio y doscientos renglones duplicados — no un hecho
del negocio.

Lo escribimos porque medimos una parte y describimos el todo. Si no hubieran
preguntado, habrían construido el selector sobre una premisa falsa.
