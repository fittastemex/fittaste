/**
 * Diagnóstico: ¿dónde están los tickets de HOY en SoftRestaurant?
 * Solo lectura. Uso: node diagnostico-hoy.js > diag.txt
 */
const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

(async () => {
  const pool = await sql.connect({ ...CONFIG.sqlServer });
  console.log("✓ Conectado. Hora del servidor SQL:");
  const q = async (label, query) => {
    try {
      const r = await pool.request().query(query);
      console.log(`\n--- ${label} ---`);
      console.log(JSON.stringify(r.recordset, null, 1).slice(0, 3500));
    } catch (e) { console.log(`\n--- ${label} --- ERROR: ${e.message}`); }
  };

  await q("0. Hora actual del servidor", "SELECT GETDATE() AS ahora");
  await q("1. Últimos 10 cheques SIN NINGÚN filtro (¿aparece lo de hoy?)",
    "SELECT TOP 10 folio, numcheque, fecha, cierre, pagado, cancelado, total, idturno FROM cheques ORDER BY fecha DESC");
  await q("2. Resumen de cheques de HOY",
    `SELECT COUNT(*) total_hoy,
            SUM(CASE WHEN pagado=1 THEN 1 ELSE 0 END) pagados,
            SUM(CASE WHEN cierre IS NULL THEN 1 ELSE 0 END) sin_fecha_cierre,
            SUM(CASE WHEN cancelado=1 THEN 1 ELSE 0 END) cancelados
     FROM cheques WHERE fecha >= CAST(GETDATE() AS DATE)`);
  await q("3. Detalle de los cheques de HOY",
    "SELECT TOP 15 folio, fecha, cierre, pagado, cancelado, total FROM cheques WHERE fecha >= CAST(GETDATE() AS DATE) ORDER BY fecha DESC");
  await q("4. ¿Hay tickets de hoy en la tabla 'chequesf'? (SR12 a veces separa)",
    "SELECT TOP 5 * FROM (SELECT folio, fecha, total FROM chequesf WHERE fecha >= CAST(GETDATE() AS DATE)) t");

  await pool.close();
  console.log("\nListo. Manda TODO este resultado al chat.");
})().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
