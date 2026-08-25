/**
 * Conector SoftRestaurant → FitTaste (v1)
 * =========================================
 * Corre en la PC donde está instalado SoftRestaurant. Cada N minutos lee los
 * tickets COBRADOS nuevos de la base SQL Server de SR y los sube a Supabase
 * como ventas de FitTaste (origen='api'), explotando recetas y descontando
 * el inventario de sucursal — la misma lógica que la importación manual.
 *
 * Requisitos: Node.js 18+ y `npm install` dentro de esta carpeta.
 * Uso:        node sync.js            (un ciclo y termina)
 *             node sync.js --daemon   (queda corriendo cada intervaloMinutos)
 *
 * NOTA sobre el esquema de SR: las consultas de abajo usan las tablas clásicas
 * de SoftRestaurant 9.5/10/11 (cheques, cheqdet, chequespagos, formasdepago,
 * productos). Si tu versión usa otros nombres de columna, ajústalos en las
 * constantes SQL_* — están todas juntas aquí arriba a propósito.
 */

const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const STATE_FILE = path.join(__dirname, "estado-sync.json");

// Candado de instancia única: dos conectores a la vez suben datos dobles (o
// con versiones distintas del código). Si el puerto ya está tomado, hay otro
// conector vivo en esta PC y este se retira.
require("net").createServer()
  .once("error", () => { console.error("✗ Ya hay OTRO Conector FitTaste corriendo en esta computadora. Cierra esta ventana y usa el que ya está abierto."); process.exit(1); })
  .listen(47653, "127.0.0.1");

// ---------- Consultas al SQL Server de SoftRestaurant ----------
// SoftRestaurant guarda los tickets del TURNO EN CURSO en tablas temporales
// (tempcheques/tempcheqdet/tempchequespagos) y los mueve a las históricas
// (cheques/cheqdet/chequespagos) al hacer el corte de turno. Para tener la
// venta casi en tiempo real hay que leer AMBAS; si las temp no existen en tu
// versión, el conector cae solo a las históricas (venta visible tras corte).
let hayTemp = true;

const SQL_TICKETS = `
  SELECT c.folio, c.numcheque, c.fecha, c.cierre, c.total, c.subtotal
  FROM cheques c
  WHERE c.pagado = 1 AND c.cancelado = 0 AND c.cierre > @desde
  ORDER BY c.cierre ASC`;
// TURNO ABIERTO (tempcheques): los folios son POR TURNO (1,2,3…) y se
// reciclan, y el 'cierre' puede venir nulo aunque el ticket ya esté pagado.
// Por eso el turno abierto se lee COMPLETO en cada ciclo (es chico) y la
// deduplicación por numcheque global evita dobles; el detalle y los pagos
// de un ticket se leen SOLO de la tabla donde vive.
const SQL_TICKETS_TEMP = `
  SELECT t.folio, t.numcheque, t.fecha, t.cierre, t.total, t.subtotal
  FROM tempcheques t WHERE t.pagado = 1 AND t.cancelado = 0`;

// Detalle de productos de un ticket. (Calibrado a SR12: cheqdet no tiene
// columna 'cancelado'; el precio de cheqdet ya incluye impuestos.)
const SQL_DETALLE = `
  SELECT d.idproducto, p.descripcion, d.cantidad, d.precio,
         (d.cantidad * d.precio) AS importe
  FROM cheqdet d
  LEFT JOIN productos p ON p.idproducto = d.idproducto
  WHERE d.foliodet = @folio AND d.cantidad > 0`;
const SQL_DETALLE_TEMP = `
  SELECT d.idproducto, p.descripcion, d.cantidad, d.precio,
         (d.cantidad * d.precio) AS importe
  FROM tempcheqdet d
  LEFT JOIN productos p ON p.idproducto = d.idproducto
  WHERE d.foliodet = @folio AND d.cantidad > 0`;

// Formas de pago de un ticket.
const SQL_PAGOS = `
  SELECT f.descripcion, cp.importe
  FROM chequespagos cp
  LEFT JOIN formasdepago f ON f.idformadepago = cp.idformadepago
  WHERE cp.folio = @folio`;
const SQL_PAGOS_TEMP = `
  SELECT f.descripcion, cp.importe
  FROM tempchequespagos cp
  LEFT JOIN formasdepago f ON f.idformadepago = cp.idformadepago
  WHERE cp.folio = @folio`;

// Menú completo de SR. La tabla productos NO trae precio: según la
// instalación vive en listadepreciosdetalle (SR12 de FitTaste) o en
// productosprecios (otras versiones). Detectamos tabla y columna al vuelo
// consultando el esquema, y tomamos el precio máximo por producto entre
// las listas. Si no hay dónde leer precios, respaldo sin precio.
const SQL_MENU_SIN_PRECIO = `
  SELECT p.idproducto, p.descripcion, NULL AS precio, NULL AS grupo
  FROM productos p`;
let SQL_MENU = null; // se arma una sola vez en el primer ciclo
async function armarQueryMenu(pool) {
  // Grupo del menú (para separar platillos de adicionales en FitTaste):
  // productos.idgrupo → grupos.descripcion. Si la instalación no tiene la
  // tabla grupos, se sincroniza sin grupo.
  let selGrupo = "NULL";
  try {
    const gcols = (await pool.request().query(
      `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('grupos')`
    )).recordset.map((c) => String(c.name).toLowerCase());
    if (gcols.includes("idgrupo") && gcols.includes("descripcion"))
      selGrupo = "(SELECT MAX(g.descripcion) FROM grupos g WHERE g.idgrupo = p.idgrupo)";
  } catch { /* sin grupos */ }
  // Precios — candidatas en orden: productosdetalle (SR12 de FitTaste), luego
  // listas de precios (otras instalaciones). Una tabla solo califica si además
  // de las columnas correctas tiene precios de verdad (> 0):
  // listadepreciosdetalle puede existir vacía y ganarle el lugar a la buena.
  for (const tabla of ["productosdetalle", "listadepreciosdetalle", "productosprecios"]) {
    try {
      const cols = (await pool.request().query(
        `SELECT name FROM sys.columns WHERE object_id = OBJECT_ID('${tabla}')`
      )).recordset.map((c) => String(c.name).toLowerCase());
      if (!cols.includes("idproducto")) continue;
      const colPrecio = cols.find((c) => c === "precio")
        || cols.find((c) => c.includes("precio") && !c.startsWith("id"));
      if (!colPrecio) continue;
      const col = colPrecio.replace(/[\[\]]/g, "");
      const chk = (await pool.request().query(`SELECT MAX([${col}]) AS m FROM ${tabla}`)).recordset[0];
      if (!chk || !(parseFloat(chk.m) > 0)) continue;
      console.log(`  Precios del menú: ${tabla}.${col}${selGrupo !== "NULL" ? " · grupos: sí" : ""}`);
      return `
        SELECT p.idproducto, p.descripcion,
               (SELECT MAX(d.[${col}]) FROM ${tabla} d WHERE d.idproducto = p.idproducto) AS precio,
               ${selGrupo} AS grupo
        FROM productos p`;
    } catch { /* siguiente candidata */ }
  }
  console.log("  (No se encontró tabla de precios con datos: el menú se sincroniza sin precio.)");
  if (selGrupo !== "NULL") return `
    SELECT p.idproducto, p.descripcion, NULL AS precio, ${selGrupo} AS grupo
    FROM productos p`;
  return SQL_MENU_SIN_PRECIO;
}

// ---------- Helpers Supabase (REST/PostgREST) ----------
// Limpieza defensiva: al copiar/pegar la config es fácil que se cuelen
// caracteres invisibles (viñetas, comillas tipográficas). URL y clave solo
// llevan ASCII; cualquier otro carácter rompe los headers de fetch.
const limpiar = (s) => String(s || "").replace(/[^\x20-\x7E]/g, "").trim();
const SB = limpiar(CONFIG.supabase.url).replace(/\/+$/, "");
const KEY = limpiar(CONFIG.supabase.apiKey);
const H = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};
async function sbGet(t, params = "") {
  const r = await fetch(`${SB}/${t}?select=*${params ? "&" + params : ""}`, { headers: H });
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}
async function sbPost(t, data) {
  const r = await fetch(`${SB}/${t}`, {
    method: "POST",
    headers: { ...H, Prefer: "return=representation" },
    body: JSON.stringify(data),
  });
  if (!r.ok) { console.error(`  ✗ POST ${t}:`, r.status, await r.text()); return null; }
  return await r.json();
}
async function sbPatch(t, id, data) {
  const r = await fetch(`${SB}/${t}?id=eq.${id}`, { method: "PATCH", headers: H, body: JSON.stringify(data) });
  return r.ok;
}

// ---------- Estado local (hasta dónde vamos) ----------
function leerEstado() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); }
  catch { return { ultimoCierre: new Date(Date.now() - 24 * 3600 * 1000).toISOString() }; }
}
function guardarEstado(s) { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2)); }

// ---------- Clasificación de pagos y canal ----------
function clasificarPago(descripcion) {
  const d = (descripcion || "").toUpperCase();
  for (const [tipo, claves] of Object.entries(CONFIG.formaPagoMap)) {
    if (claves.some((k) => d.includes(k))) return tipo;
  }
  return "otros";
}
function detectarCanal(pagos) {
  for (const p of pagos) {
    const d = (p.descripcion || "").toUpperCase();
    for (const [clave, canal] of Object.entries(CONFIG.canalPlataforma || {})) {
      if (d.includes(clave)) return canal;
    }
  }
  return "mostrador";
}
const r2 = (n) => Math.round(n * 100) / 100;
// v7.27: aquí vivían `costoInsumo`, `costoReceta` y `explotarReceta` — una copia
// de la lógica de costeo del frontend. Se borran a propósito, no sólo porque ya
// no se usan: fue esa copia la que quedó atrás. Cuando v7.25 cambió la app para
// que las ventas descontaran la PREPARACIÓN en lugar de sus ingredientes, esta
// copia siguió reventando preparaciones, y como el conector escribe el 100% de
// las ventas reales el cambio no se aplicó a ninguna. Dejarla aquí sin uso sería
// dejar la misma trampa armada para el próximo cambio de costeo.
//
// Ahora el costeo y el descuento viven en UN solo lugar: el trigger
// `trg_consumo_receta` de la base. El conector lee SoftRestaurant y sube la
// venta; nada más.

// ---------- Un ciclo de sincronización ----------
async function sincronizar() {
  // v7.20: el cierre del pool va en `finally`. Antes, si algo tronaba entre el
  // connect y el close, el pool quedaba abierto y el ciclo siguiente reconectaba
  // sobre un pool en mal estado — el conector podía quedarse trabado para siempre.
  let pool = null;
  try {
    return await unCiclo(() => pool, (p) => { pool = p; });
  } finally {
    if (pool) { try { await pool.close(); } catch (e) { /* ya estaba cerrado */ } }
  }
}

async function unCiclo(getPool, setPool) {
  const estado = leerEstado();
  console.log(`[${new Date().toLocaleString("es-MX")}] Buscando tickets desde ${estado.ultimoCierre}...`);

  const pool = await sql.connect({ ...CONFIG.sqlServer });
  setPool(pool);
  // El pool avisa cuando se cae la conexión; sin este oyente Node mata el proceso.
  pool.on?.("error", (e) => gritar("Error del pool de SQL Server", e));
  // Históricos: solo lo nuevo desde la última vez (por fecha de cierre)
  const tickets = (await pool.request().input("desde", sql.DateTime, new Date(estado.ultimoCierre)).query(SQL_TICKETS)).recordset.map((t) => ({ ...t, tabla: "hist" }));
  // Turno abierto: completo en cada ciclo (la dedup evita dobles)
  if (hayTemp) {
    try {
      const temp = (await pool.request().query(SQL_TICKETS_TEMP)).recordset.map((t) => ({ ...t, tabla: "temp" }));
      tickets.push(...temp);
    } catch (e) {
      hayTemp = false;
      console.log("  (Sin tablas temp del turno en esta versión de SR: la venta del día entrará tras cada corte de turno.)");
    }
  }
  tickets.sort((a, b) => new Date(a.cierre || a.fecha) - new Date(b.cierre || b.fecha));

  // --- Sincronización del MENÚ (corre en cada ciclo, haya o no tickets) ---
  // Crea productos nuevos con su clave SR y actualiza nombre/precio de los
  // existentes. No toca preparaciones ni recetas (viven solo en FitTaste).
  let prods = await sbGet("productos_venta");
  if (CONFIG.sincronizarMenu !== false) {
    try {
      if (!SQL_MENU) SQL_MENU = await armarQueryMenu(pool);
      let menu;
      try { menu = (await pool.request().query(SQL_MENU)).recordset; }
      catch (e) { menu = (await pool.request().query(SQL_MENU_SIN_PRECIO)).recordset; }
      let creados = 0, actualizados = 0;
      for (const m of menu) {
        const codigo = String(m.idproducto || "").trim();
        const nombre = (m.descripcion || "").trim();
        if (!codigo || !nombre) continue;
        const precio = r2(parseFloat(m.precio) || 0);
        const grupo = String(m.grupo || "").trim() || null;
        const prod = prods.find((p) => p.codigo_sr && String(p.codigo_sr).toLowerCase() === codigo.toLowerCase());
        if (!prod) {
          const res = await sbPost("productos_venta", { codigo_sr: codigo, nombre, precio_venta: precio, grupo_sr: grupo });
          if (res && res[0]) { prods.push(res[0]); creados++; }
        } else if (!prod.es_preparacion && (prod.nombre !== nombre || (precio > 0 && r2(parseFloat(prod.precio_venta) || 0) !== precio) || (grupo && prod.grupo_sr !== grupo))) {
          const upd = { nombre, updated_at: new Date().toISOString() };
          if (precio > 0) upd.precio_venta = precio;
          if (grupo) upd.grupo_sr = grupo;
          await sbPatch("productos_venta", prod.id, upd);
          Object.assign(prod, upd);
          actualizados++;
        }
      }
      if (creados || actualizados) console.log(`  Menú sincronizado: ${creados} nuevo(s), ${actualizados} actualizado(s) de ${menu.length} en SR.`);
    } catch (e) { console.log("  (Menú no sincronizado: " + e.message + " — se calibra el query SQL_MENU con la salida de explorar-sr.js)"); }
  }

  if (tickets.length === 0) { console.log("  Sin tickets nuevos."); return; }
  // El estado solo avanza con tickets del HISTÓRICO (los del turno abierto se
  // re-revisan cada ciclo hasta que el corte los mueva; la dedup evita dobles).
  let subidos = 0;
  // v7.14: si un ticket falla al subir, el estado NO puede rebasarlo. Antes se
  // hacía `continue` sin avanzar, pero el SIGUIENTE ticket bueno sí avanzaba
  // ultimoCierre más allá del que falló, y ese ticket se perdía para siempre
  // sin dejar rastro. Ahora el primer fallo del ciclo pone un techo: el estado
  // se queda justo antes y el próximo ciclo lo vuelve a intentar (la dedup por
  // folio evita duplicar los que sí entraron).
  let techoFallo = null;
  const fallidos = [];
  const marcarFallido = (t) => {
    if (t.tabla === "temp" || !t.cierre) return;
    const c = new Date(t.cierre);
    if (!techoFallo || c < techoFallo) techoFallo = c;
  };
  const avanzar = (t) => {
    if (t.tabla === "temp" || !t.cierre) return;
    const c = new Date(t.cierre);
    if (techoFallo && c >= techoFallo) return;
    estado.ultimoCierre = c.toISOString();
    guardarEstado(estado);
  };

  // v7.27: el conector ya NO explota recetas ni descuenta inventario — lo hace el
  // trigger `trg_consumo_receta` de la base, sobre las ventas con origen
  // 'api_v2'. Por eso dejó de bajar recetas, catálogo e inventario: tres
  // peticiones menos por ciclo y, sobre todo, una sola copia de la lógica de
  // costeo en lugar de tres (app, conector, recosteo).
  const sucursales = await sbGet("sucursales", "activa=eq.true&limit=1");
  const sucId = sucursales[0]?.id || null;

  for (const t of tickets) {
    const folio = `TKT-${t.numcheque || t.folio}`;
    // Idempotencia: si el ticket ya se subió, saltarlo
    const ya = await sbGet("ventas", `folio=eq.${encodeURIComponent(folio)}&limit=1`);
    if (ya.length > 0) { avanzar(t); continue; }

    const esTemp = hayTemp && t.tabla === "temp";
    const det = (await pool.request().input("folio", t.folio).query(esTemp ? SQL_DETALLE_TEMP : SQL_DETALLE)).recordset;
    const pagosSR = (await pool.request().input("folio", t.folio).query(esTemp ? SQL_PAGOS_TEMP : SQL_PAGOS)).recordset;
    if (det.length === 0) { avanzar(t); continue; }

    // Casar/crear productos de venta por código SR
    const lineas = [];
    for (const d of det) {
      const codigo = String(d.idproducto || "").trim();
      const nombre = (d.descripcion || codigo).trim();
      const vendibles = prods.filter((p) => !p.es_preparacion);
      let prod = vendibles.find((p) => p.codigo_sr && String(p.codigo_sr).toLowerCase() === codigo.toLowerCase())
        || vendibles.find((p) => p.nombre.toLowerCase() === nombre.toLowerCase());
      if (!prod) {
        const res = await sbPost("productos_venta", { codigo_sr: codigo || null, nombre, precio_venta: r2(parseFloat(d.precio) || 0) });
        if (res && res[0]) { prod = res[0]; prods.push(prod); } else continue;
      }
      lineas.push({ prod, cantidad: parseFloat(d.cantidad) || 0, precio: parseFloat(d.precio) || 0, importe: parseFloat(d.importe) || 0 });
    }
    if (lineas.length === 0) { avanzar(t); continue; }

    // Totales: SR maneja precios con IVA incluido.
    // v7.27: el costo va en 0. El trigger de la base lo llena —por línea y en el
    // total de la venta— en cuanto se inserta el detalle. Antes se calculaba
    // aquí con una copia de `costoReceta`, y esa copia se quedó atrás cuando la
    // app cambió a descontar preparaciones en v7.25: las preparaciones nunca se
    // descontaron y quedó un doble cobro latente contra el módulo de producción.
    let subtotal = 0, iva = 0;
    const detRows = lineas.map((l) => {
      const sub = l.prod.aplica_iva !== false ? l.importe / 1.16 : l.importe;
      subtotal += sub; iva += l.importe - sub;
      return { producto_venta_id: l.prod.id, cantidad: l.cantidad, precio_unitario: r2(l.precio), importe: r2(l.importe), costo_teorico: 0 };
    });
    const fp = { efectivo: 0, tarjeta: 0, plataforma: 0, otros: 0 };
    pagosSR.forEach((p) => { fp[clasificarPago(p.descripcion)] += parseFloat(p.importe) || 0; });
    const fecha = new Date(t.fecha || t.cierre).toISOString().split("T")[0];

    // Insertar venta + detalle (rollback si falla el detalle)
    const vRes = await sbPost("ventas", {
      // 'api_v2' es LA SEÑAL: le dice al trigger de la base que este ticket ya
      // no viene descontado y que le toca a él. El conector viejo escribe 'api'
      // y el trigger lo ignora, así que las dos versiones conviven sin doble
      // cobro y el orden de despliegue no importa.
      //
      // ORDEN OBLIGATORIO: la migración v7.27 va ANTES que este archivo. Y la
      // base lo hace cumplir sola: sin la migración, 'api_v2' viola el CHECK de
      // `ventas.origen`, el alta falla, el ticket se marca como fallido y se
      // reintenta en el ciclo siguiente. Se ven errores en pantalla y las ventas
      // se encolan, pero NO se pierde ninguna ni se deja de descontar en
      // silencio — que es el modo de fallar que sí habría dolido. En cuanto la
      // migración esté aplicada, la cola entra sola.
      sucursal_id: sucId, fecha, folio, origen: "api_v2", canal: detectarCanal(pagosSR),
      subtotal: r2(subtotal), iva: r2(iva), total: r2(parseFloat(t.total) || subtotal + iva),
      total_efectivo: r2(fp.efectivo), total_tarjeta: r2(fp.tarjeta),
      total_plataforma: r2(fp.plataforma), total_otros: r2(fp.otros),
      costo_teorico: 0, registrado_por: "conector-sr",
    });
    if (!(vRes && vRes[0])) { console.error(`  ✗ No se pudo subir ${folio} — se reintenta en el próximo ciclo`); marcarFallido(t); fallidos.push(folio); continue; }
    const ventaId = vRes[0].id;
    const dRes = await sbPost("venta_detalle", detRows.map((d) => ({ ...d, venta_id: ventaId })));
    if (!Array.isArray(dRes) || dRes.length !== detRows.length) {
      await fetch(`${SB}/ventas?id=eq.${ventaId}`, { method: "DELETE", headers: H });
      console.error(`  ✗ Falló el detalle de ${folio}; venta revertida — se reintenta en el próximo ciclo`);
      marcarFallido(t); fallidos.push(folio);
      continue;
    }

    // v7.27: aquí iba la explosión de recetas y el descuento de inventario. Ahora
    // lo hace el trigger `trg_consumo_receta` al insertarse el detalle, junto con
    // la regla de la bolsa que ya vivía ahí desde v7.19c. El conector se quedó con
    // una sola responsabilidad: leer SoftRestaurant y subir la venta.

    console.log(`  ✓ ${folio}: $${r2(parseFloat(t.total) || 0)} (${detRows.length} productos)`);
    subidos++;
    avanzar(t);
  }

  if (subidos > 0) console.log(`  ${subidos} ticket(s) nuevo(s) subido(s).`);
  else console.log("  Sin tickets nuevos.");
  if (fallidos.length > 0) {
    console.error(`\n  ⚠️  ${fallidos.length} ticket(s) NO subieron: ${fallidos.join(", ")}`);
    console.error(`  El conector no avanzará más allá de ${new Date(techoFallo).toLocaleString("es-MX")} hasta lograrlo.`);
    console.error(`  Si el mismo folio falla ciclo tras ciclo, avisa a dirección: hay algo que revisar.\n`);
  }
  // v7.14: latido. Deja constancia de la última corrida para poder distinguir
  // "el conector está vivo y no hubo venta" de "el conector está muerto".
  estado.ultimaCorrida = new Date().toISOString();
  estado.ultimoResultado = { subidos, fallidos: fallidos.length, revisados: tickets.length };
  guardarEstado(estado);
}

// ---------- Red de seguridad del proceso (v7.20) ----------
// Node MATA el proceso ante una promesa rechazada sin manejar o una excepción no
// atrapada. Y `mssql` emite un evento 'error' en el pool cuando se cae la conexión
// con SQL Server: si nadie lo escucha, Node lo convierte en excepción y el conector
// muere. Eso explica las caídas del 29-jul, 7-ago y 17-ago en una PC que nunca se
// apaga: se cae la conexión de madrugada y el proceso se va con ella.
//
// Cada ciclo es independiente y `estado.ultimoCierre` sólo avanza cuando un ticket
// se sube bien, así que seguir vivo tras un error es seguro: en el siguiente ciclo
// se reintenta desde el mismo punto. Morir, en cambio, cuesta días de ventas.
const gritar = (que, e) => {
  console.error(`\n${"!".repeat(60)}`);
  console.error(`  ${que}: ${e && e.message ? e.message : e}`);
  console.error(`  El conector NO se detuvo: reintenta en el próximo ciclo.`);
  console.error(`${"!".repeat(60)}\n`);
};
process.on("unhandledRejection", (e) => gritar("Promesa rechazada sin manejar", e));
process.on("uncaughtException", (e) => gritar("Excepción no atrapada", e));
sql.on?.("error", (e) => gritar("Error del pool de SQL Server", e));

// ---------- Main ----------
(async () => {
  const daemon = process.argv.includes("--daemon");
  const intervalo = (CONFIG.intervaloMinutos || 2) * 60 * 1000;
  let fallosSeguidos = 0;
  do {
    try {
      await sincronizar();
      fallosSeguidos = 0;
    } catch (e) {
      fallosSeguidos++;
      console.error(`Error en ciclo de sync (${fallosSeguidos} seguidos):`, e.message);
      // Si falla ciclo tras ciclo, que se vea a simple vista desde lejos: la
      // consola vive minimizada y nadie lee líneas sueltas.
      if (fallosSeguidos >= 3) {
        console.error(`\n${"*".repeat(60)}`);
        console.error(`  ATENCIÓN: ${fallosSeguidos} ciclos seguidos fallando.`);
        console.error(`  Las ventas NO están subiendo. Avisa a dirección.`);
        console.error(`${"*".repeat(60)}\n`);
      }
    }
    if (daemon) await new Promise((r) => setTimeout(r, intervalo));
  } while (daemon);
})();
