# Conector SoftRestaurant → FitTaste

Programa pequeño que sube los tickets cobrados de SR a FitTaste cada 2 minutos (configurable). Con esto ya no hace falta importar el reporte a mano: ventas, formas de pago e inventario de sucursal se actualizan casi en tiempo real.

**¿Dónde corre?** En cualquier computadora Windows que esté prendida durante el horario de venta y que pueda llegar al SQL Server de SR:
- **SR local (9.5/10/11):** en la misma PC del POS (`localhost\NATIONALSOFT`).
- **SR12 con base remota (vía Radmin VPN):** en cualquier PC unida a la VPN. Instala [Radmin VPN](https://www.radmin-vpn.com/es/), únete a la red que te dio soporte de SR (nombre y contraseña de red), y en `config.json` usa la IP del servidor dentro de la VPN con su puerto: `"server": "26.x.x.x,PUERTO"`. **Ojo:** la VPN da acceso a la red; el usuario y contraseña de SQL Server son credenciales aparte (pídelas a soporte de SR).

**Primer día de conexión:** antes de encender el conector, corre `node explorar-sr.js` — se conecta en solo-lectura, lista las tablas y columnas reales de tu versión, y muestra los últimos 3 tickets. Pega esa salida en el chat de soporte para calibrar los queries de `sync.js` a tu versión exacta (los nombres de tabla varían entre SR11 y SR12).

## Qué hace en cada ciclo

1. Lee de la base SQL Server de SR los tickets **cobrados y no cancelados** nuevos desde la última corrida (tablas `cheques`, `cheqdet`, `chequespagos`).
2. Casa cada producto por su **clave de SR** contra `productos_venta` de FitTaste (si no existe, lo da de alta).
3. Sube la venta con folio `TKT-<numero>` (`origen='api'`), su detalle y el desglose de formas de pago (efectivo / tarjeta / plataformas). Detecta canal UberEats/Rappi/DiDi por la forma de pago.
4. Explota las **recetas** y descuenta el **inventario de sucursal**, registrando el kárdex — la misma lógica que la importación manual.
5. Es **idempotente**: si un ticket ya se subió, lo salta. Si se apaga la PC, al volver retoma desde donde quedó (`estado-sync.json`).

## Instalación (una sola vez, en la PC del POS)

1. Instala [Node.js 18 o superior](https://nodejs.org) (LTS).
2. Copia esta carpeta `conector-sr` a la PC (ej. `C:\fittaste\conector-sr`).
3. Dentro de la carpeta: `npm install`
4. Copia `config.example.json` como `config.json` y llena:
   - `sqlServer`: instancia (normalmente `localhost\NATIONALSOFT`), nombre de la base (ej. `softrestaurant11`), usuario y contraseña de SQL Server. *Si no los tienes, te los da tu distribuidor de National Soft.*
   - `supabase.apiKey`: la clave anon del proyecto (la misma que usa `index.html`).
5. Prueba manual: `node sync.js` — debe listar los tickets del día y subirlos.
6. Clic derecho en **`instalar-arranque-automatico.bat`** → *Ejecutar como administrador*. Una sola vez. Deja el conector arrancando solo y lo mantiene vivo.

## Que no se vuelva a morir (v7.28)

El conector se murió cuatro veces: 29-jul, 7-ago, 17-ago y 13-sep. **Ninguna fue culpa del código.** Vivía en una ventana negra que alguien abría a mano; se apagaba la PC un domingo y nadie la volvía a abrir. La última vez tardamos diez días en notarlo: ~500 tickets y ~$140,000 de venta.

`instalar-arranque-automatico.bat` cubre las tres formas en que se ha muerto:

| Qué pasa | Qué lo levanta | En cuánto |
|---|---|---|
| node truena | el bucle de `vigilante.bat` | 30 segundos |
| reinician la PC | tarea *Conector FitTaste*, al iniciar sesión | al arrancar |
| cierran la ventana | tarea *Conector FitTaste revisión*, cada 15 min | ≤ 15 minutos |

Ya no se usa `iniciar-conector.bat`: terminaba en `pause`, así que cuando node tronaba la ventana se quedaba en *"Presione una tecla para continuar"* — se veía viva estando muerta.

**Y además avisa.** Cada ciclo el conector escribe su latido en la tabla `conector_latido`, y el semáforo del Dashboard de ventas lo pinta:

- 🟢 **verde** — visto hace menos de 15 min, trabajando.
- 🟠 **ámbar** — está vivo pero algo le impide trabajar (SQL Server caído, red). **No vayas a la PC**: el problema está en SoftRestaurant o en la red.
- 🔴 **rojo** — lleva ≥ 15 min sin dar señal. El proceso no existe: hay que ir a la PC.

Esa distinción entre ámbar y rojo es el punto: mandan a lugares distintos.

Si algo falla, el registro está en `conector.log` (junto a `sync.js`; se corta solo a los 5 MB).

## Si algo no coincide con tu versión de SR

Los nombres de tablas/columnas usados son los clásicos de SoftRestaurant 9.5/10/11. Si tu versión difiere, las tres consultas están juntas al inicio de `sync.js` (`SQL_TICKETS`, `SQL_DETALLE`, `SQL_PAGOS`) — es lo único que habría que ajustar. Para SoftRestaurant 12 / en la nube, lo correcto es usar la API oficial de National Soft en lugar de leer SQL Server; este conector sirve como base.

## Seguridad

- `config.json` contiene contraseñas: está en `.gitignore` y **nunca debe subirse al repositorio**.
- El conector solo **lee** de SoftRestaurant (SELECT); jamás escribe ni modifica nada del POS.
- Requiere que las tablas v7 existan en Supabase (migración `supabase/migrations/20260716_v7_ventas_sr_inventario_sucursal.sql`).

## Convivencia con la importación manual

Puedes seguir usando "Ventas SR → Importar" para días históricos o si la PC del POS estuvo sin internet. Solo cuida no duplicar: si el conector ya subió los tickets de un día, no importes también el reporte de ese día (los folios `TKT-*` vs `SR-*` te permiten distinguir el origen en el historial).
