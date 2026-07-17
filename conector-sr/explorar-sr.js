/**
 * Explorador de la base de SoftRestaurant (solo lectura)
 * ========================================================
 * Úsalo UNA VEZ el día de la conexión, antes de encender el conector.
 * Se conecta al SQL Server de SR (con el mismo config.json) y muestra:
 *   1. Las bases de datos disponibles
 *   2. Las tablas de la base configurada (para confirmar nombres en SR12)
 *   3. Las columnas de las tablas candidatas de ventas
 *   4. Una muestra de los últimos 3 tickets (sin datos sensibles)
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
  const pool = await sql.connect({ ...CONFIG.sqlServer });
  console.log("✓ Conexión SQL exitosa\n");

  const q = async (label, query) => {
    try {
      const r = await pool.request().query(query);
      console.log(`--- ${label} ---`);
      console.log(JSON.stringify(r.recordset, null, 1).slice(0, 4000));
      console.log();
    } catch (e) { console.log(`--- ${label} --- ERROR: ${e.message}\n`); }
  };

  await q("1. Bases de datos", "SELECT name FROM sys.databases WHERE database_id > 4");
  await q("2. Tablas de la base actual", "SELECT TOP 80 name FROM sys.tables ORDER BY name");
  await q("3a. Columnas de 'cheques' (tickets)", "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('cheques') ORDER BY column_id");
  await q("3b. Columnas de 'cheqdet' (detalle)", "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('cheqdet') ORDER BY column_id");
  await q("3c. Columnas de 'chequespagos' (pagos)", "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('chequespagos') ORDER BY column_id");
  await q("3d. Columnas de 'productos'", "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('productos') ORDER BY column_id");
  await q("4. Últimos 3 tickets cobrados", "SELECT TOP 3 folio, numcheque, fecha, cierre, total, pagado, cancelado FROM cheques WHERE pagado=1 ORDER BY cierre DESC");

  await pool.close();
  console.log("Listo. Copia TODO lo de arriba y pégalo en el chat para calibrar el conector.");
})().catch((e) => { console.error("✗ No se pudo conectar:", e.message); process.exit(1); });
