# Ajuste de almacén por conteo físico — 2026-07-27 (v7.9)

Bitácora del ajuste de inventario de almacén aplicado en **producción** tras el
conteo físico, y del desglose de los vasos por branding.

## 1. Ajustes por conteo físico

Registrados como **salida tipo "Ajuste por conteo físico"** (movimiento + consumo
PEPS del lote más antiguo), NO como merma al P&L. Corrigen el inventario fantasma
que dejó el bug de surtido corregido en v7.8.

| SKU | Producto | Antes | Físico | Δ |
|-----|----------|------:|------:|----:|
| MP001 | Harina waffles y hotcakes | 187 | 150 | −37 |
| MP002 | Termoenergy coffee | 62.6 | 0 | −62.6 |
| MP008 | BCAAs manzana verde | 12 | 6 | −6 |
| MP009 | BCAAs pepinolimon | 60 | 29 | −31 |
| MP013 | Colageno Fresa Kiwi | 34 | 17 | −17 |
| MP016 | Galletas | 978 | 489 | −489 |
| MP018 | Bolsas Papel Grande | 6123 | 5250 | −873 |
| MP019 | Bolsas Papel Chicas | 5725 | 3800 | −1925 |
| MP031 | Tapa vaso 16oz papel | 2450 | 2400 | −50 |
| MP040 | Tapa vaso frío 16oz | 850 | 4000 | +3150 (lote de entrada por ajuste) |

Los BCAAs/colágeno se capturaron en gramos y se convirtieron a kg (unidad del sistema).

## 2. Desglose de vasos por branding (reclasificación)

El SKU único se renombró a la variante "Fit Taste" y se crearon SKU nuevos. El
faltante se registró como salida de "Reclasificación".

**Vaso frío 16 oz** (antes MP023 = 1900) → total físico **3,050**:

| SKU | Variante | Existencia |
|-----|----------|-----------:|
| MP023 | Impreso Fit Taste | 1,550 |
| MP043 | Sin Logo | 200 |
| MP044 | Impreso Navidad | 900 |
| MP045 | Impreso Halloween | 400 |

**Vaso caliente 16 oz papel** (antes MP030 = 3500) → total físico **3,500**:

| SKU | Variante | Existencia |
|-----|----------|-----------:|
| MP030 | Impreso Fit Taste | 2,000 |
| MP046 | Impreso Navidad | 1,500 |

Costo unitario heredado del SKU original (frío $2.42, caliente $3.8674). Las
recetas siguen ligadas a la variante Fit Taste; las variantes de temporada son
buckets de inventario sin receta.

## 3. Limpieza

- `ABA-083` ("PRUEBA") → `activo = false` (oculto del inventario activo).

## Réplica en PRUEBAS (dev)

1. Aplicar la migración `20260727_v7_9_inventario_activo.sql`.
2. Re-sincronizar datos con `herramientas/copiar-datos-a-dev.js`, o re-ejecutar
   los ajustes equivalentes. Verificar siempre que `existencia = SUM(lotes.existencia_restante)`.

---

## 4. Corrección de costo de las bolsas (mismo día, hallazgo posterior)

Se detectó que los lotes del **13-jul-2026** de ambas bolsas tenían el **total de
la factura** capturado en el campo de *costo unitario*:

| SKU | Cantidad | Capturado (costo/u) | IVA | Total/u falso |
|-----|---------:|--------------------:|----:|-------------:|
| MP018 Bolsas Papel Grande | 3,000 | 18,000 | 2,880 | $20,880 |
| MP019 Bolsas Papel Chicas | 4,000 | 12,000 | 1,920 | $13,920 |

Eso inflaba el capital del almacén a ~$118 millones. Costos reales confirmados
por dirección: **$5.18** (grande) y **$3.99** (chica), ambos **sin IVA**; como
las dos presentaciones tienen `aplica_iva=true`, se registró IVA al 16%:

| SKU | costo_unitario | IVA | Costo total/u |
|-----|---------------:|----:|-------------:|
| MP018 | 5.18 | 0.8288 | **$6.0088** |
| MP019 | 3.99 | 0.6384 | **$4.6284** |

También se recosteó la salida PEPS del ajuste por conteo que ya había consumido
200 piezas del lote malo de MP019: su costo pasó de **$2,784,000** a **$925.68**.

Capital del almacén después de la corrección: **$143,326.94**.

### Pendiente de revisar (no modificado)

1. Los totales capturados implican $6.00 y $3.00 por pieza (18,000/3,000 y
   12,000/4,000), no $5.18 y $3.99. Vale confirmar contra la factura de Bolsas MX
   si el precio subió en esa compra.
2. `catalogo.costo_referencia` sigue en **$6.96** (grande) y **$3.48** (chica),
   que ya no coincide con el costo real ($6.0088 y $4.6284). Afecta el costeo de
   los pedidos de sucursal. Requiere decisión de dirección para actualizarlo.

### Prevención (código)

`handleNewLote` ahora exige confirmación explícita cuando el costo capturado es
más de 10× el costo actual del producto, o cuando el lote completo supera
$200,000 — y le sugiere el costo unitario correcto dividiendo entre la cantidad.
