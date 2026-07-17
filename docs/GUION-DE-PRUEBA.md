# Guion de prueba integral — FitTaste v7.2 (entorno DEV)

Prueba de punta a punta que puedes correr **tú solo, sin ayuda**, en unos 30-40 minutos.
Recorre el ciclo completo: insumos → pedido → recepción → receta → venta SR → merma → estados financieros.

Cada paso dice **qué hacer** y **qué debes ver**. Si algo no coincide con lo esperado, anota el número de paso y qué salió diferente — con eso se diagnostica rápido.

---

## Preparación (5 min)

**P1.** En tu computadora, corre una vez:
```
node herramientas/copiar-datos-a-dev.js
```
☑️ *Debes ver:* una lista con ✓ y el número de filas copiadas (catálogo ~225, insumos ~225, proveedores 8...).

**P2.** Abre `index.html?env=dev` en el navegador.
☑️ *Debes ver:* el letrero naranja **"ENTORNO DE PRUEBAS"** en la pantalla de login. **Si no lo ves, DETENTE: estás en producción.**

**P3.** Entra como **Admin / Dueño**.

---

## Parte 1 — Configurar el insumo con presentaciones (el caso "crema")

**1.1** Ve a **Catálogo → pestaña Insumos**. Busca el insumo **CREMA** (o el lácteo que uses). Dale **Editar** y cambia su unidad base a **ml**. Guarda.

**1.2** Ve a **Catálogo → Productos**. Busca el artículo de crema, dale **Editar**, y en la columna **Insumo / contenido** pon: insumo = CREMA, contenido = **900**. Guarda.
☑️ *Debes ver:* en el renglón, "CREMA **×900 ml**".

**1.3 (opcional, para probar 2 marcas)** Crea un producto nuevo: "CREMA ALPURA 1L", proveedor el que sea, costo referencia $62. Luego edítalo y apúntalo al insumo CREMA con contenido **1000**.

---

## Parte 2 — Pedido con conversión (sucursal → compras)

**2.1** Sal y entra como **Sucursal**. Ve a **Mis pedidos → + Nuevo pedido**. Busca CREMA y pide **5** (lt... la unidad que muestre es **ml**, así que pide **5000**).
☑️ *Debes ver:* en la columna "Se pedirá": **6 pz = 5,400 ml (+400 ml)** — el sistema redondeó hacia arriba y te muestra el excedente. Si capturaste la Alpura, puedes cambiar de presentación en el selector y ver cómo cambia el cálculo (5 pz exactos).

**2.2** Agrega también 2-3 insumos de granel (jitomate, pollo). ☑️ *Debes ver:* esos se piden con cantidad exacta, sin redondeo. Envía el pedido.

**2.3** Entra como **Compras** (o Admin). Abre el pedido, captura el **precio real** de cada línea (ej. crema: $58 por bote) según el flujo de cada proveedor, y llévalo hasta **"Pedido comprado ✓"**.

---

## Parte 3 — Recepción → inventario de sucursal

**3.1** Como **Sucursal → Recepción**, recibe el pedido con "Todo correcto" y confirma.

**3.2** Ve a **Inv. Sucursal**.
☑️ *Debes ver:* **CREMA: 5,400 ml** de existencia, con costo ≈ **$0.064/ml** ($58 ÷ 900). Los granel con su cantidad y costo real tal cual.
☑️ *En la pestaña Movimientos:* una línea "entrada recepcion" por cada insumo, en verde.

**3.3** Entra como **Finanzas**. ☑️ *Debes ver:* las cuentas por pagar del pedido generadas (esto ya existía, confirma que sigue igual).

---

## Parte 4 — Receta con preparación (sub-receta)

**4.1** Como Admin, ve a **Ventas SR → Productos y recetas → Preparaciones → + Nueva preparación**: "SALSA DE PRUEBA", se mide en **kg**, rinde **2** por tanda. Ármale receta: jitomate 1.5 kg + crema 500 ml (los que recibiste en la parte 3).
☑️ *Debes ver:* el costo de la tanda calculado y el **costo por kg** = tanda ÷ 2.

**4.2** En **Platillos → + Nuevo producto**: código SR **BOWL01**, nombre "BOWL DE PRUEBA", precio **$129**. Créale receta: pollo 0.18 kg + crema **30 ml** + SALSA DE PRUEBA **0.05 kg**.
☑️ *Debes ver:* costo total de la receta, y el **margen bruto %** contra el precio (verde si es sano, rojo si es bajo).

---

## Parte 5 — Importar venta de SoftRestaurant

**5.1** En **Ventas SR → Importar de SR**, pega esto tal cual:
```
Clave	Descripción	Cantidad	Importe
BOWL01	BOWL DE PRUEBA	10	1290.00
JUGO99	JUGO DE PRUEBA	4	220.00
```
Fecha: hoy. Canal: mostrador. Formas de pago: efectivo **710**, tarjeta **800**.
☑️ *Debes ver ANTES de importar:* BOWL01 en verde ("ok", con insumos), JUGO99 en amarillo ("nuevo") y rojo "sin receta"; y una advertencia de que las formas de pago ($1,510) coinciden con el importe ($1,510) — no debe aparecer alerta naranja.

**5.2** Importa. ☑️ *Debes ver:* alerta de éxito con folio `SR-...` y costo teórico > 0.

**5.3** Verifica el efecto en **Inv. Sucursal**:
- CREMA bajó: 10 bowls × (30 ml directos + 0.05 kg de salsa × 250 ml/kg de la salsa...) — lo importante: **bajó más de 300 ml** (receta directa + lo que arrastra la sub-receta).
- Pollo bajó 1.8 kg. Jitomate bajó por la salsa.
☑️ *En Movimientos:* líneas "salida venta" ligadas al folio.

**5.4** En **Ventas SR → Historial**: ☑️ la venta con total $1,510, su costo teórico, utilidad y **food cost %**. Ábrela con "Ver detalle" y confirma las formas de pago.

**5.5** JUGO99 quedó creado sin receta (así pasará con productos nuevos reales). ☑️ En **Productos**, créale una receta después — así verificas el flujo "producto que llegó solo desde el reporte".

---

## Parte 6 — Merma y ajuste

**6.1** En **Inv. Sucursal → Registrar merma**: CREMA, **200 ml**, motivo caducidad.
☑️ *Debes ver:* pérdida estimada **$12.89**, la existencia baja 200 ml, y la merma en la lista con su costo.

**6.2** En **Inventario → Ajustar** (cualquier insumo): cambia la existencia simulando un conteo físico y pon un motivo.
☑️ *Debes ver:* el movimiento "entrada/salida ajuste" en el kárdex.

---

## Parte 7 — Estados financieros

**7.1** Como Admin o Finanzas, abre **Estados** (mes actual):
☑️ **Estado de resultados:** Ventas netas ≈ **$1,301.72** ($1,510 ÷ 1.16) − costo de ventas (tu consumo real) = utilidad bruta; abajo la merma (~$12.90) y gastos si registraste alguno; utilidad operativa y food cost %.
☑️ **Flujo de efectivo:** entradas efectivo $710 + tarjeta $800; salidas lo que hayas pagado.
☑️ **Posición:** valor de inventario sucursal > 0 y las CxP del pedido de la parte 2.

---

## Veredicto

- **Pasó** si los 7 bloques cuadraron. Anota cualquier número que te haya parecido raro aunque "pasara".
- **Prueba extra de estrés (opcional):** importa el MISMO reporte de la parte 5 otra vez → debe crear una segunda venta (el sistema no adivina duplicados en importación manual — regla: un reporte por corte).
- Cuando termines, si quieres dejar DEV limpio para otra ronda: vuelve a correr `node herramientas/copiar-datos-a-dev.js` (borra y recopia los datos maestros; las ventas/pedidos de prueba se van).

## Si algo falla

Anota: número de paso, qué esperabas, qué viste (captura de pantalla ayuda), y con qué rol estabas. Con eso se corrige sin adivinar. Errores típicos:
- No ves las pestañas nuevas → revisa el rol con el que entraste.
- "Error al guardar" → revisa que estés en DEV (letrero naranja) y con internet.
- Los números de costo no cuadran → casi siempre es el **contenido** de la presentación (¿pusiste 900 en la crema?) o la **unidad base** del insumo.
