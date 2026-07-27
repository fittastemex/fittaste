/**
 * Explorador de la base de SoftRestaurant (solo lectura)
 * ========================================================
 * Úsalo UNA VEZ el día de la conexión, antes de encender el conector.
 * Se conecta al SQL Server de SR (con el mismo config.json) y:
 *   1. Lista las bases de datos y DETECTA sola en cuál vive SR
 *      (busca la tabla de tickets) — no importa qué "database" pongas
 *      en config.json para esta primera corrida (puedes poner "master").
 *   2. Muestra las tablas de esa base (para confirmar nombres en SR12).
 *   3. Muestra las columnas de las tablas candidatas de ventas.
 *   4. Muestra una muestra de los últimos 3 tickets.
 *
 * Pega la salida completa en el chat de soporte y con eso se ajustan
 * los queries de sync.js a tu versión exacta. NO modifica nada: solo SELECT.
 *
 * Uso: node explorar-sr.js
 */
const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

(async () => {
  console.log("Conectando a", CONFIG.sqlServer.server, "...");
  const pool = await sql.connect({ ...CONFIG.sqlServer, database: CONFIG.sqlServer.database || "master" });
  console.log("✓ Conexión SQL exitosa\n");

  const q = async (label, query) => {
    try {
      const r = await pool.request().query(query);
      console.log(`--- ${label} ---`);
      console.log(JSON.stringify(r.recordset, null, 1).slice(0, 4000));
      console.log();
      return r.recordset;
    } catch (e) { console.log(`--- ${label} --- ERROR: ${e.message}\n`); return []; }
  };

  const bases = await q("1. Bases de datos disponibles", "SELECT name FROM sys.databases WHERE database_id > 4");

  // Detectar en qué base vive SoftRestaurant (la que tenga tabla de tickets)
  let baseSR = null;
  for (const b of bases) {
    try {
      const r = await pool.request().query(
        `SELECT COUNT(*) n FROM [${b.name}].sys.tables WHERE name IN ('cheques','cheqdet','ventas','comandas')`);
      if (r.recordset[0].n >= 2) { baseSR = b.name; break; }
    } catch (e) { /* sin permiso en esa base, seguir */ }
  }
  if (!baseSR) {
    console.log("✗ No encontré una base con tablas de tickets. Revisa permisos del usuario SQL.");
    console.log("  Pega de todos modos la lista de bases de arriba en el chat.");
    await pool.close(); return;
  }
  console.log(`★ Base de SoftRestaurant detectada: "${baseSR}"  ← pon esto en config.json → sqlServer.database\n`);

  const p = `[${baseSR}].dbo.`;
  await q("2. Tablas de la base " + baseSR,
    `SELECT TOP 100 name FROM [${baseSR}].sys.tables ORDER BY name`);
  await q("3a. Columnas de 'cheques' (tickets)",
    `SELECT c.name FROM [${baseSR}].sys.columns c WHERE c.object_id=OBJECT_ID('${p}cheques') ORDER BY c.column_id`);
  await q("3b. Columnas de 'cheqdet' (detalle)",
    `SELECT c.name FROM [${baseSR}].sys.columns c WHERE c.object_id=OBJECT_ID('${p}cheqdet') ORDER BY c.column_id`);
  await q("3c. Columnas de 'chequespagos' (pagos)",
    `SELECT c.name FROM [${baseSR}].sys.columns c WHERE c.object_id=OBJECT_ID('${p}chequespagos') ORDER BY c.column_id`);
  await q("3d. Columnas de 'productos'",
    `SELECT c.name FROM [${baseSR}].sys.columns c WHERE c.object_id=OBJECT_ID('${p}productos') ORDER BY c.column_id`);
  await q("4. Últimos 3 tickets cobrados",
    `SELECT TOP 3 folio, numcheque, fecha, cierre, total, pagado, cancelado FROM ${p}cheques WHERE pagado=1 ORDER BY cierre DESC`);

  await pool.close();
  console.log("Listo. Copia TODO lo de arriba y pégalo en el chat para calibrar el conector.");
})().catch((e) => { console.error("✗ No se pudo conectar:", e.message); process.exit(1); });
