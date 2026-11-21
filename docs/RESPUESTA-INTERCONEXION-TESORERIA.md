# Respuesta a la propuesta de interconexión

**Para:** el equipo (y el Claude) de Tesorería Fit Taste
**De:** el lado de la app operativa
**Fecha:** 14 de noviembre de 2026
**Estado:** contrapropuesta. Aceptamos el contrato; corregimos tres supuestos y ampliamos el alcance.

---

## 0. Resumen en diez líneas

Sí, estamos en la misma base. Es una vista y un grant.

Aceptamos el contrato de solo lectura tal como lo plantean, pero **la vista que
proponen no se puede construir**: parte de que un pedido tiene un proveedor, y
de nuestro lado un pedido abarca hasta cinco. El grano correcto existe ya, se
llama `pedido_proveedor_estatus`, y abajo va la vista funcionando y probada.

Dos cosas más que les van a importar: **lo pedido y lo recibido no son lo
mismo** (hay casos con $115,012 de diferencia), así que les entregamos ambos
totales; y **el CEDIS no pasa por pedidos** — compra $383,254 por otra puerta
que su vista no vería.

Y hay una cosa que sí necesitamos tocar de su lado. Va en la sección 4.

---

## 1. Respuestas a sus seis preguntas

### 1. ¿Están en la misma base de datos?

**Sí.** Proyecto `jxyrbvgpjsxevbhaxprr`, esquema `public`. Sus 17 tablas `tes_*`
conviven con nuestras 40. No hace falta API: es una vista y un grant, como
ustedes esperaban.

### 2. ¿Cómo se ve su identificador de pedido?

`PED-YYYYMMDD-NNN` — por ejemplo `PED-20261112-001`. El consecutivo es por día.
Vive en `pedidos.numero_pedido` (ojo: **no** se llama `folio`).

**Es único por sí solo, pero no es el identificador que necesitan.** Fernando se
lo describió como "un identificador del día, separado por proveedor", y ahí está
el malentendido: el número es del día, y la separación por proveedor ocurre un
nivel más abajo. Lo explicamos en la sección 2.

### 3. ¿Sus pedidos traen el RFC del proveedor?

**Hoy no. Ningún dato fiscal.** Nuestro catálogo tiene nueve proveedores con
nombres de cocina — "Pollo", "Yerina", "Meli" — y ni un RFC.

Pero **no armen la tabla de equivalencias**. Vamos a unificar el catálogo en
`tes_proveedores` (ya está la migración escrita), y en cuanto eso ocurra el
`proveedor_rfc` les sale de gratis en la vista. Detalle en la sección 4.

### 4. ¿Qué estados tiene un pedido?

Dos niveles, y el que les sirve es el segundo.

`pedidos.estatus` — 81 pedidos:

| Valor | Cuántos |
|---|---|
| `cerrado` | 53 |
| `en_proceso` | 23 |
| `comprado` | 5 |

`pedido_proveedor_estatus.estatus` — 303 filas, el estado real por proveedor:

| Valor | Cuántos | ¿Ya llegó? |
|---|---|---|
| `recibido_completo` | 194 | sí |
| `completo` | 50 | sí |
| `recibido_con_faltantes` | 35 | sí, parcial |
| `precios_capturados` | 15 | no |
| `pendiente` | 6 | no |
| `surtido` | 2 | no |
| `enviado` | 1 | no |

**Advertencia honesta:** `completo` y `recibido_completo` significan lo mismo.
Es deuda nuestra, de versiones distintas de la app. No les vamos a pedir que
carguen con eso: la vista expone un booleano `recibido` ya normalizado, y ese
es el que deben filtrar.

Dos campos más que **no** deben usar, porque no se mantienen:
`pedido_proveedor_estatus.estatus_entrega` está en `pendiente` en las 303 filas,
y `recepciones.estatus_general` está en `pendiente` en 298 de 315.

### 5. ¿Registran el precio pactado y el recibido por separado?

**Sí, y es de lo mejor que tenemos para ustedes.** En `pedido_detalle`:

- `costo_referencia` — el precio pactado o esperado.
- `costo_real` — el que capturó compras o el proveedor al surtir.

La vista entrega el total ya calculado con `coalesce(costo_real, costo_referencia)`
y el IVA aplicado según `catalogo.aplica_iva`, que es exactamente como lo calcula
hoy nuestra app. Pueden comparar contra el CFDI sin repetir la aritmética.

### 6. ¿Los pedidos distinguen entre ROMA y CEDIS?

**No, y esta es la respuesta incómoda.** Los 81 pedidos apuntan a la sucursal
Roma. Ni uno al CEDIS.

Eso **no** quiere decir que el CEDIS no compre. Quiere decir que compra por otra
puerta. Sección 5.

---

## 2. El supuesto que no se sostiene: un pedido no tiene un proveedor

Su vista propuesta hace:

```sql
join <su tabla de proveedores> pr on pr.id = p.proveedor_id
```

**`pedidos` no tiene columna `proveedor_id`.** Sus columnas reales son:

```
id, numero_pedido, fecha, sucursal_id, estatus,
total_teorico, total_real, creado_por, created_at,
updated_at, token_acceso, token_expira
```

Tampoco existen `folio`, `total`, `centro` ni `recibido_en`.

Un pedido nuestro es **la compra del día completa**, y se reparte entre varios
proveedores. `PED-20261112-001` tiene cinco: Almacén, Juan Carlos, Office Max,
Pollo y Walmart. Cada uno surte, entrega y factura por su cuenta.

### El grano correcto ya existe

`pedido_proveedor_estatus` es exactamente un renglón por (pedido, proveedor).
Lo verificamos: **303 filas, cero duplicados**. Su `id` es un uuid estable que
nace con el pedido y no cambia nunca.

**Ese `id` es el `pedido_id` de su contrato.** Su tabla `tes_pedidos_enlace`
funciona tal como la diseñaron, sin cambiarle una línea.

Y su índice `unique (pedido_id, cfdi_id)` queda bien: significa "esta factura
cubre esta entrega de este proveedor", que es justo lo que quieren amarrar.

---

## 3. La vista, construida y probada

Grano (pedido × proveedor). Nombres de la izquierda = el contrato.

```sql
create or replace view v_pedidos_tesoreria as
with linea as (
  select ppe.id as ppe_id,
         pd.id  as pd_id,
         pd.cantidad,
         coalesce(pd.costo_real, pd.costo_referencia) as cu,
         case when coalesce(cat.aplica_iva,false) then 1.16 else 1 end as f
    from pedido_proveedor_estatus ppe
    join pedido_detalle pd
      on pd.pedido_id = ppe.pedido_id
     and pd.proveedor_id = ppe.proveedor_id
    left join catalogo cat on cat.id = pd.catalogo_id
), recibido as (
  select pedido_detalle_id, sum(cantidad_recibida) as q
    from recepcion_detalle group by 1
)
select
  ppe.id::text                     as pedido_id,
  p.numero_pedido                  as pedido_folio,
  p.fecha                          as fecha_pedido,
  tp.rfc                           as proveedor_rfc,
  tp.nombre                        as proveedor_nombre,
  tp.alias_cocina                  as proveedor_alias,
  'ROMA'::text                     as centro,
  round(sum(l.cantidad * l.cu * l.f)::numeric, 2)            as total_pedido,
  round(sum(coalesce(r.q,0) * l.cu * l.f)::numeric, 2)       as total_recibido,
  ppe.estatus                      as estatus,
  (ppe.estatus in ('recibido_completo','completo','recibido_con_faltantes'))
                                   as recibido,
  (select max(x.fecha_recepcion)::date from recepciones x
    where x.pedido_id = ppe.pedido_id
      and x.proveedor_id = ppe.proveedor_id)                 as fecha_recepcion,
  coalesce(tp.es_interno, false)   as es_traspaso_interno
from pedido_proveedor_estatus ppe
join pedidos p          on p.id  = ppe.pedido_id
join tes_proveedores tp on tp.id = ppe.proveedor_id
join linea l            on l.ppe_id = ppe.id
left join recibido r    on r.pedido_detalle_id = l.pd_id
group by ppe.id, p.numero_pedido, p.fecha, tp.rfc, tp.nombre,
         tp.alias_cocina, ppe.estatus, ppe.pedido_id, ppe.proveedor_id,
         tp.es_interno;

grant select on v_pedidos_tesoreria to authenticated;
```

Salida real de noviembre:

| pedido_folio | proveedor | estatus | total_pedido | total_recibido | recepción |
|---|---|---|---|---|---|
| PED-20261112-001 | Walmart | recibido_completo | 1,546.36 | 1,546.36 | 14-nov |
| PED-20261112-001 | Pollo | pendiente | 3,900.00 | 0.00 | — |
| PED-20261109-001 | Juan Carlos | recibido_con_faltantes | 5,566.16 | 5,566.16 | 11-nov |
| PED-20261109-001 | Meli | completo | 1,770.16 | 1,770.16 | 13-nov |
| PED-20261109-001 | Yerina | completo | 1,975.00 | 1,975.00 | 13-nov |
| PED-20261102-001 | Juan Carlos | precios_capturados | 3,099.00 | 3,099.00 | 06-nov |

Ese último renglón es casi exactamente el ejemplo de su sección 6.

### Sobre `security_invoker = true`

**Sugerimos que lo dejen en `false`** — el valor por omisión. Nos leímos la
diferencia con cuidado:

- Con `security_invoker = true`, la vista corre con los permisos de quien la
  consulta. Eso obliga a darle a `authenticated` permiso de SELECT sobre
  `pedidos`, `pedido_detalle`, `recepcion_detalle`, `catalogo` y
  `pedido_proveedor_estatus`. **Les abriríamos cinco tablas crudas.**
- Con `false`, la vista corre con los permisos de su dueño. Un solo
  `grant select on v_pedidos_tesoreria` y ustedes ven las doce columnas del
  contrato y nada más.

Menos acceso, no más. Si lo pidieron por auditabilidad, díganlo y lo
reconsideramos — pero el default nos parece el correcto aquí.

### Dos columnas de regalo

- **`total_recibido`**, aparte de `total_pedido`. Por qué, en la sección 6.
- **`es_traspaso_interno`**. Marca en `true` al Almacén surtiendo a sucursal.
  **Filtren esos renglones**: no son compras a terceros, nadie va a facturarlos
  y no deben generar pasivo. Son $245,772 de traspaso interno que si entran al
  libro inflan la deuda contra nosotros mismos.

---

## 4. Lo único que necesitamos tocar de su lado

Esto rompe su promesa de "no tocamos nada de ustedes" en espejo, así que lo
decimos de frente y **no lo hacemos sin su visto bueno**.

Para que exista `proveedor_rfc` hay que unificar los dos catálogos. Fernando ya
lo decidió: `tes_proveedores` es el catálogo único. Eso implica, de su lado:

**Tres columnas nuevas en `tes_proveedores`:**

| Columna | Para qué |
|---|---|
| `tipo_flujo_id` | Cómo se captura el costo en la app operativa |
| `alias_cocina` | El nombre que usa cocina. Su columna `alias` no se toca |
| `es_interno` | `true` sólo para el Almacén |

**Seis filas nuevas**, los proveedores que sólo existían de nuestro lado:

| Nombre que entra | RFC | Nota |
|---|---|---|
| NUEVA WAL MART DE MEXICO | NWM9709244W4 | lo sacamos de sus propios CFDI sueltos |
| DEREMATE.COM DE MEXICO | DCM991109KR2 | ídem — es Mercado Libre |
| Office Max | — | falta capturarle RFC |
| Del Mar | — | falta capturarle RFC |
| Proveedor Tortilla | — | falta capturarle RFC |
| Almacen | — | `es_interno = true`, colgado del centro CEDIS |

Entran con `token_activo = false`: ninguno usa el portal todavía.

**Necesitamos una línea de código suya:** su listado de proveedores debe filtrar
`where es_interno = false`. Si no, finanzas verá "Almacén" como si fuera un
tercero. Por eso preferimos aplicar la migración **el mismo día** que ustedes
suban ese filtro, para que nadie vea el estado intermedio.

### El mapeo, ya resuelto con evidencia

No hizo falta adivinar: las descripciones de sus propios CFDI lo resolvieron.

| Nosotros | Ustedes | Por qué lo sabemos |
|---|---|---|
| Pollo | King's Food de Santander | el CFDI dice literalmente *"Pollo"* |
| Yerina | Yerinha Arzate Yedra | *"ARRACHERA DE RES", "ESPEJO DE RES"* |
| Walmart | NUEVA WAL MART DE MEXICO | *"ACEITE AEROS", "PAN PREMIUM", "TOC SRF"* |
| Meli | DEREMATE.COM DE MEXICO | *"Jugo Sazonador La Dueña 5l"* |
| Juan Carlos Botello | Juan Carlos Juárez Salazar | *"DIVERSOS PRODUCTOS GRAVADOS / EXENTOS"* — él entrega leche y verdura (exentos) junto con aluminio (gravado). Confirmado por Fernando: es la misma persona, aunque cocina le dice por otro apellido |

Los tres primeros conservan **su** id, con su RFC y su portal intactos. Los seis
nuevos entran **conservando el uuid que ya tenían de nuestro lado**, de modo que
ni uno solo de los 81 pedidos ni de las 315 recepciones necesita repuntarse.

---

## 5. Lo que su propuesta no cubriría (y es mucho dinero)

Su vista ve los pedidos de la sucursal Roma. Eso deja fuera tres canales.

### a) El CEDIS no compra por pedidos — $383,254

El almacén entra mercancía por `lotes_almacen`, que no se parece en nada a un
pedido: no hay proveedor con llave foránea, **hay un campo de texto libre**.

| proveedor_origen (texto libre) | Lotes | Valor |
|---|---|---|
| Inventario inicial | 10 | $91,901 |
| **(vacío)** | **68** | **$70,851** |
| Nano | 5 | $52,057 |
| Bolsas MX | 3 | $41,920 |
| Cardi | 5 | $35,409 |
| SUSALIA | 2 | $27,418 |
| SI GRAFICA | 2 | $25,853 |
| NANO SCIENCE | 1 | $19,826 |
| CARDI | 2 | $9,229 |

Noten el desorden: "Cardi" y "CARDI" son el mismo, "Nano" y "NANO SCIENCE"
también, y **68 lotes por $70,851 no tienen proveedor alguno**.

Y noten también esto: **CARDI, $9,229, 11 de noviembre.** De su lado hay un CFDI
de HERIBERTO DIEGO LOPEZ, alias *SUMINISTROS Y SERVICIOS CARDI*, por
**$9,229** — vasos Reyma 16L y tapas. Es la misma compra, vista desde los dos
sistemas, sin que nada los una hoy. Ese es el caso de uso entero en un renglón.

Proponemos una **segunda vista, `v_compras_almacen_tesoreria`**, en una fase
posterior. Antes hay que limpiar el texto libre y amarrarlo al catálogo único,
que es trabajo nuestro.

### b) Compras directas de sucursal — $23,468

`compras_directas`: cuando cocina compra sin pedido previo. 46 operaciones.

| Método | Operaciones | Monto |
|---|---|---|
| transferencia | 13 | $14,515 |
| tarjeta | 21 | $4,643 |
| efectivo | 12 | $4,310 |

Las de transferencia y tarjeta **ya salieron del banco**, así que a ustedes les
llegaron por el estado de cuenta sin nada que las explique. Esas sí tienen
proveedor con llave foránea, así que la vista es fácil. ¿La quieren en esta
fase o en la siguiente?

### c) El pasivo nace en la recepción, no en la factura

Hoy tesorería se entera de que debemos algo cuando llega el CFDI. La mercancía
recibida y no facturada no existe en sus libros. Ustedes mismos lo pusieron en
su sección 6 como una de las cosas que esto abre — queremos subrayar que **es
la más valiosa de las dos**, y que la vista ya se las entrega lista: filtren
`recibido = true` y resten lo que ya tenga enlace.

---

## 6. Por qué les mandamos dos totales y no uno

Su contrato pide `total`. Les mandamos `total_pedido` **y** `total_recibido`,
porque de nuestro lado no son lo mismo y la diferencia no es cosmética:

| Proveedor | Pedido | Recibido | Diferencia |
|---|---|---|---|
| Juan Carlos Botello | $318,874 | $433,886 | **+$115,012** |
| Walmart | $81,703 | $84,193 | +$2,490 |
| Meli | $110,027 | $111,865 | +$1,838 |
| Almacén | $241,690 | $245,772 | +$4,082 |
| Pollo | $195,250 | $195,250 | 0 |

**Si sugieren el enlace comparando el CFDI contra `total_pedido`, van a fallar
justo con el proveedor más grande.**

Decimos esto con conocimiento de causa: nuestro propio módulo de cuentas por
pagar comete exactamente ese error. Genera el pasivo desde `pedido_detalle` —
lo pedido — y nunca lo ajusta con lo que llegó. Resultado: **163 cuentas
"pendientes" desde abril por $583,465**, ninguna con número de factura y un
solo pago registrado en toda su historia. Está midiendo la cosa equivocada
desde el primer día.

Por eso Fernando decidió que **tesorería manda en pasivos y pagos**, y que ese
módulo nuestro se desmonta. Lo cual les pone encima una responsabilidad que
conviene decir en voz alta: **a partir de esa fecha, la pregunta "¿cuánto le
debemos a este proveedor?" sólo la puede contestar tesorería.** Nosotros vamos
a dejar de tener respuesta.

---

## 7. Lo que proponemos hacer, en orden

| # | Qué | Quién | Bloquea a |
|---|---|---|---|
| 1 | Visto bueno a las 3 columnas y 6 filas en `tes_proveedores` | ustedes | todo |
| 2 | Aplicar la unificación del catálogo | nosotros | 3 |
| 3 | Filtro `es_interno = false` en su listado de proveedores | ustedes | — |
| 4 | Crear `v_pedidos_tesoreria` + grant | nosotros | 5 |
| 5 | `tes_pedidos_enlace` y el selector en el estado de cuenta | ustedes | — |
| 6 | Desmontar cuentas por pagar de la app operativa | nosotros | — |
| 7 | Vistas de `compras_directas` y `lotes_almacen` | nosotros | — |

Los pasos 2 y 3 queremos hacerlos **el mismo día**, por lo del estado
intermedio. El resto puede ir en paralelo.

---

## 8. Dos cosas que conviene dejar dichas

**Sobre el incidente de octubre.** Mencionan que se sospechó de una tabla de
tesorería y resultó no serlo. Aclaramos lo que encontramos entonces, porque la
versión a medias es peor que ninguna: la saturación **sí venía de `tes_cfdi`**
—es la tabla más pesada de la base, con 48 columnas incluyendo el XML completo—
pero no por culpa de nadie ni por un error de diseño. Fue volumen. La lección
que sacan ustedes es la correcta y la suscribimos: compartimos base y lo que uno
hace le pega al otro. Por eso la vista va con `security_invoker = false` y
columnas contadas.

**Sobre los dos portales.** Un proveedor como Juan Carlos entra hoy por dos
puertas distintas con dos tokens distintos: el de ustedes en
`tes_proveedores.token_acceso` para subir su factura, y el nuestro en
`pedido_proveedor_estatus.token_acceso` para confirmar el pedido. Unificar el
catálogo pone los dos tokens en la misma fila por primera vez. No proponemos
fusionar los portales ahora — pero a partir del paso 2 se vuelve posible, y
vale la pena tenerlo en el radar.
