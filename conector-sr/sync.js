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

// ---------- Consultas al SQL Server de SoftRestaurant ----------
// Tickets cobrados y no cancelados, cerrados después de la última sincronización.
const SQL_TICKETS = `
  SELECT c.folio, c.numcheque, c.fecha, c.cierre, c.total, c.subtotal
  FROM cheques c
  WHERE c.pagado = 1 AND c.cancelado = 0 AND c.cierre > @desde
  ORDER BY c.cierre ASC`;

// Detalle de productos de un ticket.
const SQL_DETALLE = `
  SELECT d.idproducto, p.descripcion, d.cantidad, d.precio,
         (d.cantidad * d.precio) AS importe
  FROM cheqdet d
  LEFT JOIN productos p ON p.idproducto = d.idproducto
  WHERE d.foliodet = @folio AND ISNULL(d.cancelado, 0) = 0`;

// Formas de pago de un ticket.
const SQL_PAGOS = `
  SELECT f.descripcion, cp.importe
  FROM chequespagos cp
  LEFT JOIN formasdepago f ON f.idformadepago = cp.idformadepago
  WHERE cp.folio = @folio`;

// ---------- Helpers Supabase (REST/PostgREST) ----------
const SB = CONFIG.supabase.url;
const H = {
  apikey: CONFIG.supabase.apiKey,
  Authorization: `Bearer ${CONFIG.supabase.apiKey}`,
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
const r3 = (n) => Math.round(n * 1000) / 1000;

// ---------- Lógica de costeo (misma que el frontend, v7.2: insumos base) ----------
function costoInsumo(insumoId, invSucursal, catalogo) {
  const inv = invSucursal.find((i) => i.insumo_id === insumoId);
  if (inv && parseFloat(inv.costo_promedio) > 0) return parseFloat(inv.costo_promedio);
  const pres = catalogo.filter((c) => c.insumo_id === insumoId && parseFloat(c.costo_referencia) > 0);
  if (pres.length === 0) return 0;
  return Math.min(...pres.map((c) => parseFloat(c.costo_referencia) / (parseFloat(c.contenido) || 1)));
}
function costoReceta(prodId, recetas, invSucursal, catalogo, productosVenta, depth = 0) {
  if (depth > 5) return 0;
  return recetas
    .filter((r) => r.producto_venta_id === prodId)
    .reduce((s, r) => {
      const q = (parseFloat(r.cantidad) || 0) * (1 + (parseFloat(r.merma_pct) || 0) / 100);
      let cu = 0;
      if (r.insumo_id) cu = costoInsumo(r.insumo_id, invSucursal, catalogo);
      else if (r.preparacion_id) {
        const prep = productosVenta.find((p) => p.id === r.preparacion_id);
        const rend = parseFloat(prep?.rendimiento) || 1;
        cu = costoReceta(r.preparacion_id, recetas, invSucursal, catalogo, productosVenta, depth + 1) / rend;
      }
      return s + q * cu;
    }, 0);
}
// Explota una receta (incluyendo preparaciones/sub-recetas) a insumos del catálogo
function explotarReceta(prodId, cantidadVendida, recetas, productosVenta, consumo, depth = 0) {
  if (depth > 5) return consumo;
  recetas.filter((r) => r.producto_venta_id === prodId).forEach((r) => {
    const q = (parseFloat(r.cantidad) || 0) * (1 + (parseFloat(r.merma_pct) || 0) / 100) * cantidadVendida;
    if (r.insumo_id) consumo[r.insumo_id] = (consumo[r.insumo_id] || 0) + q;
    else if (r.preparacion_id) {
      const rend = parseFloat(productosVenta.find((p) => p.id === r.preparacion_id)?.rendimiento) || 1;
      explotarReceta(r.preparacion_id, q / rend, recetas, productosVenta, consumo, depth + 1);
    }
  });
  return consumo;
}

// ---------- Un ciclo de sincronización ----------
async function sincronizar() {
  const estado = leerEstado();
  console.log(`[${new Date().toLocaleString("es-MX")}] Buscando tickets desde ${estado.ultimoCierre}...`);

  const pool = await sql.connect({ ...CONFIG.sqlServer });
  const tickets = (await pool.request().input("desde", sql.DateTime, new Date(estado.ultimoCierre)).query(SQL_TICKETS)).recordset;
  if (tickets.length === 0) { console.log("  Sin tickets nuevos."); await pool.close(); return; }
  console.log(`  ${tickets.length} ticket(s) nuevo(s).`);

  // Datos de FitTaste necesarios para castear productos y explotar recetas
  const [sucursales, productosVenta, recetas, catalogo] = await Promise.all([
    sbGet("sucursales", "activa=eq.true&limit=1"),
    sbGet("productos_venta"),
    sbGet("recetas"),
    sbGet("catalogo"),
  ]);
  let invSucursal = await sbGet("inventario_sucursal");
  const sucId = sucursales[0]?.id || null;
  let prods = productosVenta;

  for (const t of tickets) {
    const folio = `TKT-${t.numcheque || t.folio}`;
    // Idempotencia: si el ticket ya se subió, saltarlo
    const ya = await sbGet("ventas", `folio=eq.${encodeURIComponent(folio)}&limit=1`);
    if (ya.length > 0) { estado.ultimoCierre = new Date(t.cierre).toISOString(); continue; }

    const det = (await pool.request().input("folio", t.folio).query(SQL_DETALLE)).recordset;
    const pagosSR = (await pool.request().input("folio", t.folio).query(SQL_PAGOS)).recordset;
    if (det.length === 0) { estado.ultimoCierre = new Date(t.cierre).toISOString(); continue; }

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
    if (lineas.length === 0) { estado.ultimoCierre = new Date(t.cierre).toISOString(); continue; }

    // Totales: SR maneja precios con IVA incluido
    let subtotal = 0, iva = 0, costoTotal = 0;
    const detRows = lineas.map((l) => {
      const sub = l.prod.aplica_iva !== false ? l.importe / 1.16 : l.importe;
      subtotal += sub; iva += l.importe - sub;
      const cT = r2(costoReceta(l.prod.id, recetas, invSucursal, catalogo, prods) * l.cantidad);
      costoTotal += cT;
      return { producto_venta_id: l.prod.id, cantidad: l.cantidad, precio_unitario: r2(l.precio), importe: r2(l.importe), costo_teorico: cT };
    });
    const fp = { efectivo: 0, tarjeta: 0, plataforma: 0, otros: 0 };
    pagosSR.forEach((p) => { fp[clasificarPago(p.descripcion)] += parseFloat(p.importe) || 0; });
    const fecha = new Date(t.fecha || t.cierre).toISOString().split("T")[0];

    // Insertar venta + detalle (rollback si falla el detalle)
    const vRes = await sbPost("ventas", {
      sucursal_id: sucId, fecha, folio, origen: "api", canal: detectarCanal(pagosSR),
      subtotal: r2(subtotal), iva: r2(iva), total: r2(parseFloat(t.total) || subtotal + iva),
      total_efectivo: r2(fp.efectivo), total_tarjeta: r2(fp.tarjeta),
      total_plataforma: r2(fp.plataforma), total_otros: r2(fp.otros),
      costo_teorico: r2(costoTotal), registrado_por: "conector-sr",
    });
    if (!(vRes && vRes[0])) { console.error(`  ✗ No se pudo subir ${folio}`); continue; }
    const ventaId = vRes[0].id;
    const dRes = await sbPost("venta_detalle", detRows.map((d) => ({ ...d, venta_id: ventaId })));
    if (!Array.isArray(dRes) || dRes.length !== detRows.length) {
      await fetch(`${SB}/ventas?id=eq.${ventaId}`, { method: "DELETE", headers: H });
      console.error(`  ✗ Falló el detalle de ${folio}; venta revertida.`);
      continue;
    }

    // Explosión de recetas (incluye sub-recetas) → descuento de inventario + kárdex
    const consumo = {};
    lineas.forEach((l) => explotarReceta(l.prod.id, l.cantidad, recetas, prods, consumo));
    if (sucId) for (const [insId, cant] of Object.entries(consumo)) {
      let row = invSucursal.find((i) => i.sucursal_id === sucId && i.insumo_id === insId);
      const costoU = costoInsumo(insId, invSucursal, catalogo);
      if (!row) {
        const res = await sbPost("inventario_sucursal", { sucursal_id: sucId, insumo_id: insId, existencia: 0, costo_promedio: costoU });
        if (res && res[0]) { row = res[0]; invSucursal.push(row); } else continue;
      }
      const nueva = r3((parseFloat(row.existencia) || 0) - cant);
      await sbPatch("inventario_sucursal", row.id, { existencia: nueva, updated_at: new Date().toISOString() });
      invSucursal = invSucursal.map((i) => (i.id === row.id ? { ...i, existencia: nueva } : i));
      await sbPost("movimientos_sucursal", {
        sucursal_id: sucId, insumo_id: insId, tipo: "salida_venta",
        cantidad: r3(cant), costo_unitario: costoU, venta_id: ventaId,
        fecha, nota: `Venta ${folio}`, registrado_por: "conector-sr",
      });
    }

    console.log(`  ✓ ${folio}: $${r2(parseFloat(t.total) || 0)} (${detRows.length} productos)`);
    estado.ultimoCierre = new Date(t.cierre).toISOString();
    guardarEstado(estado);
  }

  guardarEstado(estado);
  await pool.close();
}

// ---------- Main ----------
(async () => {
  const daemon = process.argv.includes("--daemon");
  const intervalo = (CONFIG.intervaloMinutos || 2) * 60 * 1000;
  do {
    try { await sincronizar(); }
    catch (e) { console.error("Error en ciclo de sync:", e.message); }
    if (daemon) await new Promise((r) => setTimeout(r, intervalo));
  } while (daemon);
})();
