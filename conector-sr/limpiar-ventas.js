/**
 * Limpieza de una sola vez: borra de Supabase los tickets que subió la versión
 * anterior del conector con pagos revueltos (los pagos suman más que el total).
 *
 * Qué hace por cada ticket dañado:
 *   1. Regresa al inventario lo que ese ticket había descontado (kárdex salida_venta).
 *   2. Borra sus movimientos de kárdex, su detalle y la venta.
 * Después, el conector nuevo los vuelve a subir limpios en el siguiente ciclo.
 *
 * Uso (una sola vez): node limpiar-ventas.js
 * Solo toca la base de Supabase configurada en config.json. NO toca SoftRestaurant.
 */
const fs = require("fs");
const path = require("path");

const CONFIG = JSON.parse(fs.readFileSync(path.join(__dirname, "config.json"), "utf8"));
const limpiar = (s) => String(s || "").replace(/[^\x20-\x7E]/g, "").trim();
const SB = limpiar(CONFIG.supabase.url).replace(/\/+$/, "");
const KEY = limpiar(CONFIG.supabase.apiKey);
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };

async function sbGet(t, params = "") {
  const r = await fetch(`${SB}/${t}?select=*${params ? "&" + params : ""}`, { headers: H });
  const d = await r.json();
  return Array.isArray(d) ? d : [];
}
async function sbDelete(t, params) {
  const r = await fetch(`${SB}/${t}?${params}`, { method: "DELETE", headers: H });
  if (!r.ok) console.error(`  ✗ DELETE ${t}:`, r.status, await r.text());
  return r.ok;
}
async function sbPatch(t, id, data) {
  const r = await fetch(`${SB}/${t}?id=eq.${id}`, { method: "PATCH", headers: H, body: JSON.stringify(data) });
  return r.ok;
}
const r3 = (n) => Math.round(n * 1000) / 1000;

(async () => {
  console.log("Buscando tickets con pagos que no cuadran con el total...");
  const ventas = await sbGet("ventas", "origen=eq.api&order=folio.asc");
  const dañadas = ventas.filter((v) => {
    const pagos = (parseFloat(v.total_efectivo) || 0) + (parseFloat(v.total_tarjeta) || 0)
      + (parseFloat(v.total_plataforma) || 0) + (parseFloat(v.total_otros) || 0);
    return Math.abs(pagos - (parseFloat(v.total) || 0)) > 0.05;
  });

  if (dañadas.length === 0) {
    console.log("✓ Todo cuadra. No hay nada que limpiar.");
    return;
  }
  console.log(`Se encontraron ${dañadas.length} ticket(s) dañado(s):`);
  dañadas.forEach((v) => console.log(`  - ${v.folio} (${v.fecha}) total $${v.total}`));

  for (const v of dañadas) {
    // 1. Revertir descuentos de inventario que hizo este ticket
    const movs = await sbGet("movimientos_sucursal", `venta_id=eq.${v.id}&tipo=eq.salida_venta`);
    for (const m of movs) {
      const inv = await sbGet("inventario_sucursal", `sucursal_id=eq.${m.sucursal_id}&insumo_id=eq.${m.insumo_id}&limit=1`);
      if (inv[0]) {
        await sbPatch("inventario_sucursal", inv[0].id, {
          existencia: r3((parseFloat(inv[0].existencia) || 0) + (parseFloat(m.cantidad) || 0)),
          updated_at: new Date().toISOString(),
        });
      }
    }
    // 2. Borrar kárdex, detalle y la venta
    await sbDelete("movimientos_sucursal", `venta_id=eq.${v.id}`);
    await sbDelete("venta_detalle", `venta_id=eq.${v.id}`);
    await sbDelete("ventas", `id=eq.${v.id}`);
    console.log(`  ✓ ${v.folio} borrado (el conector lo volverá a subir limpio).`);
  }
  console.log("\nListo. Ahora arranca el conector con iniciar-conector.bat.");
})().catch((e) => { console.error("✗ Error:", e.message); process.exit(1); });
