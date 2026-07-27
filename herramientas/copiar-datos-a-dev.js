/**
 * Copia los datos maestros de PRODUCCIÓN → DEV (proyecto de pruebas)
 * ===================================================================
 * Copia catálogo, insumos, proveedores, unidades, sucursales, almacén,
 * productos de venta y recetas al proyecto DEV, para que el entorno de
 * pruebas se sienta como el real. NO copia operación (pedidos, ventas,
 * CxP, gastos): DEV arranca limpio para que experimentes sin miedo.
 *
 * SOLO ESCRIBE EN DEV. De producción únicamente LEE.
 * Puedes correrlo las veces que quieras para "refrescar" DEV
 * (borra y vuelve a copiar los datos maestros en DEV).
 *
 * Uso: node copiar-datos-a-dev.js       (requiere Node 18+ e internet)
 */

const PROD = {
  url: "https://jxyrbvgpjsxevbhaxprr.supabase.co/rest/v1",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imp4eXJidmdwanN4ZXZiaGF4cHJyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ3MTgyNTMsImV4cCI6MjA5MDI5NDI1M30.Tvo6vZq3yoWNbSY-mNMQkF-eZw16Qu4z7LJGvhn-LYs",
};
const DEV = {
  url: "https://whgfrfdqetjttlfsprtt.supabase.co/rest/v1",
  key: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndoZ2ZyZmRxZXRqdHRsZnNwcnR0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQyMzQzMTgsImV4cCI6MjA5OTgxMDMxOH0.TGDgkLM5rZocVopnQJXc6uegOHImAdtgpraPxc2PCE4",
};

// Orden respetando llaves foráneas (se insertan así; se borran al revés)
const TABLAS = [
  "unidades_medida",
  "tipos_flujo_costo",
  "sucursales",
  "categorias_gastos",
  "proveedores",
  "insumos",
  "inventario_almacen",
  "catalogo",
  "productos_venta",
  "recetas",
  "inventario_sucursal",
];

const h = (env) => ({ apikey: env.key, Authorization: `Bearer ${env.key}`, "Content-Type": "application/json" });

async function leerTodo(t) {
  const pageSize = 1000; let from = 0, all = [];
  while (true) {
    const r = await fetch(`${PROD.url}/${t}?select=*`, { headers: { ...h(PROD), "Range-Unit": "items", Range: `${from}-${from + pageSize - 1}` } });
    const d = await r.json();
    if (!Array.isArray(d)) throw new Error(`Error leyendo ${t} de PROD: ${JSON.stringify(d).slice(0, 200)}`);
    all = all.concat(d);
    if (d.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

async function borrarDev(t) {
  // borra todas las filas (filtro que siempre matchea)
  const r = await fetch(`${DEV.url}/${t}?id=not.is.null`, { method: "DELETE", headers: h(DEV) });
  if (!r.ok) throw new Error(`Error borrando ${t} en DEV: ${r.status} ${await r.text()}`);
}

async function insertarDev(t, rows) {
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const r = await fetch(`${DEV.url}/${t}`, { method: "POST", headers: h(DEV), body: JSON.stringify(chunk) });
    if (!r.ok) throw new Error(`Error insertando ${t} en DEV: ${r.status} ${await r.text()}`);
  }
}

(async () => {
  console.log("Copiando datos maestros PRODUCCIÓN → DEV...\n");

  // Limpiar DEV en orden inverso (hijos primero)
  for (const t of [...TABLAS].reverse()) {
    await borrarDev(t);
  }

  for (const t of TABLAS) {
    const rows = await leerTodo(t);
    if (rows.length === 0) { console.log(`  ${t}: 0 filas (nada que copiar)`); continue; }
    await insertarDev(t, rows);
    console.log(`  ✓ ${t}: ${rows.length} filas copiadas`);
  }

  console.log("\nListo. Abre la app con ?env=dev para usar el entorno de pruebas.");
  console.log("La operación (pedidos, ventas, finanzas) arranca vacía en DEV a propósito.");
})().catch((e) => { console.error("\n✗", e.message); process.exit(1); });
