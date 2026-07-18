/**
 * Diagnóstico de precios: ¿dónde guarda SR12 los precios del menú?
 * Solo lectura. Uso: node diagnostico-precios.js > precios.txt
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
      console.log(JSON.stringify(r.recordset, null, 1).slice(0, 3000));
    } catch (e) { console.log(`\n--- ${label} --- ERROR: ${e.message}`); }
  };

  await q("A. Tablas cuyo nombre suena a precio",
    "SELECT name FROM sys.tables WHERE name LIKE '%precio%' OR name LIKE '%lista%' ORDER BY name");
  await q("B. Columnas de productosprecios",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('productosprecios') ORDER BY column_id");
  await q("C. Muestra de productosprecios (5 filas)",
    "SELECT TOP 5 * FROM productosprecios");
  await q("D. Columnas de productos que suenan a precio",
    "SELECT name FROM sys.columns WHERE object_id=OBJECT_ID('productos') AND (name LIKE '%precio%' OR name LIKE '%costo%' OR name LIKE '%importe%') ORDER BY column_id");
  await q("E. Un producto con lo que cobró SR hoy (para comparar)",
    "SELECT TOP 3 d.idproducto, p.descripcion, d.precio FROM tempcheqdet d JOIN productos p ON p.idproducto = d.idproducto");

  await pool.close();
  console.log("\nListo. Manda TODO este resultado al chat.");
})().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
