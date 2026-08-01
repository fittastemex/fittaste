# Cambiar el conector de PRUEBAS a PRODUCCIÓN

Guía para la persona que tiene acceso a la PC donde corre el conector.
Son 5 minutos de trabajo. No se toca nada de SoftRestaurant.

---

## ¿Qué es `config.json`?

Es el **archivo de configuración del conector**, y vive en la carpeta del
conector en la PC del POS (ej. `C:\fittaste\conector-sr\config.json`).
No está en el repositorio a propósito: contiene la contraseña de SQL Server.

Le dice tres cosas al conector:

1. **De dónde leer** — dónde está la base de SoftRestaurant y con qué usuario
   entrar (`sqlServer`).
2. **A dónde escribir** — a qué proyecto de Supabase mandar las ventas
   (`supabase`). ← **esto es lo único que vamos a cambiar**
3. **Cómo comportarse** — cada cuántos minutos revisar, si sincroniza el menú, y
   cómo clasificar las formas de pago en efectivo / tarjeta / plataforma.

Hoy el bloque `supabase` apunta al proyecto de **pruebas**. Cambiarlo a
producción es cambiar dos valores. Las credenciales de SQL Server **no se
tocan**: el conector seguirá leyendo el mismo SoftRestaurant.

---

## Paso 1 — Detener el conector

Si corre como tarea programada, deténla. Si corre en una ventana, ciérrala.
Verifica que no quede ninguna instancia: el conector usa un candado en el puerto
local 47653, y si queda una instancia vieja seguirá subiendo con la
configuración anterior.

## Paso 2 — Editar `config.json`

Abre `config.json` con el Bloc de notas y **reemplaza solo el bloque
`supabase`** por este:

```json
  "supabase": {
    "url": "https://jxyrbvgpjsxevbhaxprr.supabase.co/rest/v1",
    "apiKey": "PEGAR_AQUI_LA_ANON_KEY_DE_PRODUCCION"
  },
```

La `anon key` de producción es la misma que ya usa la app web en producción.
Todo lo demás del archivo (`sqlServer`, `intervaloMinutos`, `formaPagoMap`,
`canalPlataforma`) **se queda igual**.

> Guarda una copia del `config.json` anterior como `config.dev.json` por si
> algún día quieren volver a apuntar a pruebas.

## Paso 3 — Preparar el reproceso del histórico

Dirección pidió traer **todo el histórico que tenga la base de SR**.

El conector recuerda hasta dónde llegó en `estado-sync.json`. Ese archivo hoy
refleja lo que subió a **pruebas**, así que si se deja, producción arrancaría
desde ahí y **se perdería la historia sin avisar**.

**Borra `estado-sync.json`** y créalo de nuevo con este contenido exacto:

```json
{
  "ultimoCierre": "2000-01-01T00:00:00.000Z"
}
```

Con esa fecha el conector jala **todos** los tickets pagados y no cancelados que
existan en la base (el filtro es `cierre > ultimoCierre`).

> **Ojo con la primera corrida:** si hay miles de tickets va a tardar
> (aproximadamente media hora por cada 3,000 tickets). Es normal. El conector
> guarda su avance ticket por ticket, así que si se interrumpe, al volver a
> arrancar continúa donde quedó — no repite ni duplica.

## Paso 4 — Primera corrida EN MANUAL (no como servicio)

En la carpeta del conector, abre una terminal y corre:

```
node sync.js
```

**Sin `--daemon`.** Corre un ciclo y termina. Quédate viendo la salida:

- Debe decir cuántos tickets encontró y irlos subiendo.
- Si algo del lado de SoftRestaurant falla, se ve en los primeros 30 segundos.
- Si truena, **no** dejes el servicio prendido: manda la salida completa al chat.

## Paso 5 — Verificar en la app antes de dejarlo corriendo

Entra a la app **en producción** con rol Admin y revisa en el dashboard de
ventas que la venta del periodo cuadre contra SoftRestaurant.

Vas a ver un **aviso ámbar** diciendo que las recetas cubren un % bajo de la
venta y que la utilidad real es menor a la mostrada. **Es esperado**: el
recetario todavía no está en producción. Por ahora **la venta, los tickets, el
ticket promedio y las formas de pago sí son confiables; el costo de materia
prima y la utilidad NO.**

## Paso 6 — Dejarlo permanente

Cuando el paso 4 y 5 salgan bien:

```
node sync.js --daemon
```

y prográmalo para arrancar con Windows (Programador de tareas, desencadenador
"al iniciar sesión"). También sirve `iniciar-conector.bat`.

---

## Si algo sale mal

- **No borres nada de SoftRestaurant.** El conector solo lee (SELECT).
- Para regresar a pruebas: restaura `config.dev.json` como `config.json`.
- Para deshacer ventas mal subidas existe `limpiar-ventas.js`, que revierte el
  descuento de inventario y borra las ventas inconsistentes.
- Las ventas del conector llevan folio `TKT-*`; las importadas a mano, `SR-*`.
  Así se distingue el origen y se evita duplicar: **no importes a mano un día que
  el conector ya subió.**

## Garantías y límites (lo que se verificó el 2026-07-27)

Verificado contra el esquema de producción:

- Las 39 columnas que escribe el conector existen en producción.
- Ninguna columna obligatoria queda sin enviar (ningún insert va a fallar por eso).
- No hay triggers en esas tablas: sin efectos ocultos.
- `productos_venta.codigo_sr` es único: no va a duplicar productos del menú.
- `ventas.folio` ahora tiene **índice único** (migración v7.11): aunque se
  reprocese el histórico varias veces, es imposible duplicar una venta. Esto
  importa porque una venta duplicada descontaría inventario dos veces.
- La sucursal existe y la llave anon puede escribir.

**No verificable desde fuera:** el lado de SoftRestaurant. No hay acceso remoto a
ese SQL Server. La evidencia de que funciona es que el conector **ya lee
correctamente ese mismo SoftRestaurant** contra el entorno de pruebas; lo único
que cambia es el destino. Por eso el paso 4 es en manual.
