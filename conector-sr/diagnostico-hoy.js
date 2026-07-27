/**
 * Diagnóstico v2: radiografía del TURNO ABIERTO (tablas temp de SR)
 * Solo lectura. Uso: node diagnostico-hoy.js > diag2.txt
 */
const fs = require("fs");
const path = require("path");
const sql = require("mssql");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));

(async () => {
  const pool = await sql.connect({ ...CONFIG.sqlServer });
  console.log("✓ Conectado.");
  const q = async (label, query) => {
    try {
      const r = await pool.request().query(query);
      console.log(`\n--- ${label} ---`);
      console.log(JSON.stringify(r.recordset, null, 1).slice(0, 3500));
    } catch (e) { console.log(`\n--- ${label} --- ERROR: ${e.message}`); }
  };

  await q("A. Tickets del turno abierto (tempcheques)",
    "SELECT TOP 10 folio, numcheque, fecha, cierre, pagado, cancelado, total, idturno FROM tempcheques ORDER BY fecha DESC");
  await q("B. Columnas de tempcheques",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('tempcheques') ORDER BY column_id");
  await q("C. Columnas de tempcheqdet",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('tempcheqdet') ORDER BY column_id");
  await q("D. Líneas por folio en tempcheqdet (¿coinciden con los tickets?)",
    "SELECT TOP 15 foliodet, COUNT(*) lineas, SUM(cantidad*precio) importe FROM tempcheqdet GROUP BY foliodet ORDER BY foliodet DESC");
  await q("E. Detalle crudo del ticket más reciente del turno",
    "SELECT TOP 25 foliodet, movimiento, cantidad, idproducto, precio FROM tempcheqdet WHERE foliodet = (SELECT TOP 1 folio FROM tempcheques ORDER BY fecha DESC)");
  await q("F. Pagos por folio en tempchequespagos",
    "SELECT TOP 15 folio, COUNT(*) pagos, SUM(importe) suma FROM tempchequespagos GROUP BY folio ORDER BY folio DESC");

  await pool.close();
  console.log("\nListo. Manda TODO este resultado al chat.");
})().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
