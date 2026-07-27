/**
 * Diagnóstico de precios v2: buscar en TODA la base dónde están los precios
 * reales del menú. Solo lectura. Uso: node diagnostico-precios.js > precios2.txt
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

  await q("A. TODAS las columnas llamadas *precio* en TODA la base",
    `SELECT t.name AS tabla, c.name AS columna
     FROM sys.columns c JOIN sys.tables t ON t.object_id = c.object_id
     WHERE c.name LIKE '%precio%' AND c.name NOT LIKE 'id%'
     ORDER BY t.name`);
  await q("B. Columnas de listadepreciosdetalle",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('listadepreciosdetalle') ORDER BY column_id");
  await q("C. ¿Cuántas filas tiene listadepreciosdetalle?",
    "SELECT COUNT(*) AS filas FROM listadepreciosdetalle");
  await q("D. Muestra de listadepreciosdetalle (5 filas)",
    "SELECT TOP 5 * FROM listadepreciosdetalle");
  await q("E. Muestra de listadeprecios (5 filas)",
    "SELECT TOP 5 * FROM listadeprecios");
  await q("F. Columnas COMPLETAS de la tabla productos (para ver dónde más puede vivir el precio)",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('productos') ORDER BY column_id");
  await q("G. Una fila completa de productos de un platillo vendido hoy",
    "SELECT TOP 1 * FROM productos WHERE idproducto = '01003'");

  await pool.close();
  console.log("\nListo. Manda el archivo precios2.txt al chat.");
})().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
