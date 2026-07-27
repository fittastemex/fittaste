/* Prueba E2E enfocada: VARIANTES DE ALMACÉN y botón Surtir (v7.10).

   Cubre dos cosas que antes no tenían prueba:

   1. El botón "Surtir" del almacén. Hasta v7.10 tenía su propia copia inline
      de la lógica PEPS, distinta de descontarAlmacenPEPS(); esa duplicación fue
      la causa del inventario fantasma de julio 2026. Ahora hay una sola ruta y
      esta prueba la ejercita de punta a punta.

   2. Variantes (`variante_de`): varios SKU de almacén con el mismo insumo y
      distinto branding se surten como un grupo. La existencia disponible es la
      suma del grupo y el descuento PEPS toma el lote más antiguo de CUALQUIER
      variante, no solo del SKU base.

   Escenario: se piden 120 pz de vaso.
     - Base    "VASO FIT TASTE"  100 pz, lote 2026-03-01 @ $2.00
     - Variante "VASO NAVIDAD"    50 pz, lote 2026-01-15 @ $3.00  <- MÁS ANTIGUO
   Antes de v7.10 el pedido se habría rechazado por "inventario insuficiente"
   (el base solo tiene 100) aunque físicamente hay 150 en el almacén.
   Esperado: PEPS toma primero los 50 de Navidad (lote más viejo) y luego 70 del
   base; costo real de la línea = (50*3 + 70*2)/120 = $2.4167. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true}],
  tipos_flujo_costo:[{id:"tf-alm",nombre:"Almacen interno",quien_captura_precio:"almacen",proveedor_ve_pedido:false,costo_editable:false}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-alm",nombre:"Almacén Central",tipo_flujo_id:"tf-alm",activo:true}],
  insumos:[{id:"ins-vaso",nombre:"VASO 16 OZ",unidad_base:"pz",tipo_control:"inventariable",categoria_gasto:null,activo:true}],
  catalogo:[{id:"cat-vaso",sku:"EMP-100",articulo:"VASO 16 OZ",tipo_producto:"EMPAQUE",unidad_id:"u-pz",costo_referencia:2.5,proveedor_id:"prov-alm",aplica_iva:true,activo:true,insumo_id:"ins-vaso",contenido:1,inventario_almacen_id:"ia-base",notas:null}],
  // El catálogo apunta SOLO al SKU base; la variante se alcanza por variante_de.
  inventario_almacen:[
    {id:"ia-base",sku:"MP100",descripcion:"VASO FIT TASTE",unidad_id:"u-pz",existencia:100,costo_unitario_actual:2,lead_time:null,activo:true,variante_de:null},
    {id:"ia-nav", sku:"MP101",descripcion:"VASO NAVIDAD",  unidad_id:"u-pz",existencia:50, costo_unitario_actual:3,lead_time:null,activo:true,variante_de:"ia-base"},
  ],
  lotes_almacen:[
    {id:"lote-base",inventario_id:"ia-base",fecha_entrada:"2026-03-01",cantidad:100,existencia_restante:100,costo_unitario:2,iva:0,created_at:"2026-03-01T00:00:00Z"},
    {id:"lote-nav", inventario_id:"ia-nav", fecha_entrada:"2026-01-15",cantidad:50, existencia_restante:50, costo_unitario:3,iva:0,created_at:"2026-01-15T00:00:00Z"},
  ],
  pedidos:[{id:"ped-alm",numero_pedido:"PED-VAR-001",fecha:"2026-07-27",sucursal_id:"suc-1",estatus:"en_proceso",total_teorico:300}],
  pedido_detalle:[{id:"det-vaso",pedido_id:"ped-alm",catalogo_id:"cat-vaso",proveedor_id:"prov-alm",cantidad:120,costo_referencia:2.5,costo_real:null}],
  pedido_proveedor_estatus:[{id:"pe-alm",pedido_id:"ped-alm",proveedor_id:"prov-alm",estatus:"enviado",token_activo:false}],
  categorias_gastos:[],movimientos_almacen:[],salidas_peps:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],ventas:[],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],catalogo_historial:[],usuarios:[],
  pedido_reasignaciones:[],recepcion_proveedor:[],
};
const DEFAULTS={
  inventario_sucursal:{existencia:0,costo_promedio:0,minimo_stock:0},
  pedidos:{estatus:"creado",total_teorico:0,total_real:0},
  inventario_almacen:{existencia:0,costo_unitario_actual:0,activo:true,variante_de:null},
};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq.")){if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")){const list=v.slice(4,-1).split(",");if(!list.includes(String(row[k])))return false;}
    else if(v.startsWith("like.")){let pat=v.slice(5).replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/[*%]/g,".*");if(!new RegExp("^"+pat+"$","i").test(String(row[k]==null?"":row[k])))return false;}
    else if(v==="not.is.null"){if(row[k]==null)return false;}
  }
  return true;
}
function handleRest(method,table,search,body){
  if(!(table in DB))return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  const params=[...new URLSearchParams(search).entries()];
  const limit=params.find(p=>p[0]==="limit");
  if(method==="GET"){let rows=DB[table].filter(r=>matchFilters(r,params));if(limit)rows=rows.slice(0,parseInt(limit[1]));return{status:200,body:JSON.stringify(rows)};}
  if(method==="POST"){const arr=Array.isArray(body)?body:[body];const ins=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);if(!row.created_at)row.created_at=new Date().toISOString();DB[table].push(row);return row;});return{status:201,body:JSON.stringify(ins)};}
  if(method==="PATCH"){const upd=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};upd.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(upd)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}
const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};
const approx=(a,b,t=0.01)=>Math.abs(a-b)<=t;
const inv=(id)=>DB.inventario_almacen.find(x=>x.id===id);
const lote=(id)=>DB.lotes_almacen.find(x=>x.id===id);

(async()=>{
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  page.on("dialog",async d=>{await d.accept();});
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));
  await page.route("**/*",async route=>{
    const url=route.request().url();const m=route.request().method();
    if(url.startsWith("http://fittaste.local/"))return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html});
    if(url.includes("react-dom"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react-dom/umd/react-dom.production.min.js","utf8")});
    if(url.includes("/react@"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react/umd/react.production.min.js","utf8")});
    if(url.includes("babel"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/@babel/standalone/babel.min.js","utf8")});
    if(url.includes("cdn.tailwindcss.com"))return route.fulfill({status:200,contentType:"application/javascript",body:"window.tailwind={config:{}};"});
    if(url.includes("fonts.googleapis"))return route.fulfill({status:200,contentType:"text/css",body:""});
    const rest=url.match(/supabase\.co\/rest\/v1\/([a-z_]+)(\?(.*))?$/);
    if(rest){let body=null;try{body=route.request().postData()?JSON.parse(route.request().postData()):null;}catch(e){}const res=handleRest(m,rest[1],rest[3]||"",body);return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  console.log("\n== Variantes de almacén + botón Surtir (v7.10) ==");
  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Inventario",{exact:true}).click();       // tarjeta del rol Almacén
  await page.locator("input[type=password]").fill("almacen2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Almacén — Control PEPS").waitFor({timeout:20000});

  check("inicio: base 100 + variante 50 = 150 en el grupo",inv("ia-base").existencia===100&&inv("ia-nav").existencia===50);
  check("inicio: sin salidas de almacén",DB.movimientos_almacen.length===0);

  // La tabla de inventario debe mostrar la agrupación y el total del grupo
  const cuerpo=await page.locator("body").innerText();
  check("1. la tabla marca la variante y el total del grupo",/variante de MP100/i.test(cuerpo)&&/150/.test(cuerpo),cuerpo.match(/variante de \S+/)?.[0]);

  // Ir a la pestaña Surtir y abrir el pedido
  await page.getByRole("button",{name:/^Surtir \(/}).click();
  await page.getByRole("button",{name:"Ver y surtir"}).click();
  await page.waitForTimeout(400);

  // El panel de surtido debe ofrecer el grupo (existencia sumada, no solo el base)
  const panel=await page.locator("body").innerText();
  check("2. el panel muestra las 2 variantes del grupo",/2 variantes/.test(panel),panel.match(/\d+ variantes/)?.[0]);
  check("3. la existencia disponible es la del grupo (150), no la del base (100)",/150/.test(panel));
  check("4. ofrece surtir por PEPS automático del grupo",/PEPS autom/i.test(panel));

  // Marcar la línea como surtida y confirmar.
  // dispatchEvent en vez de click: en la prueba Tailwind está stubbeado, así que
  // los elementos no tienen tamaño y Playwright los considera "no visibles".
  await page.locator("div.w-7.h-7.rounded-lg.border-2").first().dispatchEvent("click");
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:/Pedido Surtido/}).dispatchEvent("click");
  await page.waitForTimeout(1500);

  // --- Verificaciones del descuento PEPS a través del grupo ---
  const sal=DB.movimientos_almacen.filter(x=>x.tipo==="salida"&&x.pedido_id==="ped-alm");
  check("5. se surtieron 120 pz aunque el SKU base solo tenía 100",
    approx(sal.reduce((s,x)=>s+parseFloat(x.cantidad),0),120),sal.map(s=>[s.inventario_id,s.cantidad]));
  check("6. un movimiento por cada SKU tocado (base + variante)",sal.length===2,sal.length);

  const salNav=sal.find(x=>x.inventario_id==="ia-nav");
  const salBase=sal.find(x=>x.inventario_id==="ia-base");
  check("7. PEPS tomó primero el lote MÁS ANTIGUO, que es el de la variante (50 pz)",
    salNav&&approx(parseFloat(salNav.cantidad),50),salNav?.cantidad);
  check("8. el resto (70 pz) salió del SKU base",
    salBase&&approx(parseFloat(salBase.cantidad),70),salBase?.cantidad);

  check("9. la variante quedó en 0 (50 → 0)",approx(inv("ia-nav").existencia,0),inv("ia-nav").existencia);
  check("10. el base quedó en 30 (100 → 30)",approx(inv("ia-base").existencia,30),inv("ia-base").existencia);
  check("11. el lote de la variante se agotó",approx(lote("lote-nav").existencia_restante,0),lote("lote-nav").existencia_restante);
  check("12. el lote del base bajó a 30",approx(lote("lote-base").existencia_restante,30),lote("lote-base").existencia_restante);

  check("13. se registró la salida PEPS de cada lote consumido",DB.salidas_peps.length===2,DB.salidas_peps.length);
  const spNav=DB.salidas_peps.find(x=>x.lote_id==="lote-nav");
  check("14. la salida de la variante se costeó a $3.00 (su propio lote)",
    spNav&&approx(parseFloat(spNav.costo_unitario_lote),3),spNav?.costo_unitario_lote);

  // Costo real de la línea = promedio ponderado del grupo: (50*3 + 70*2)/120
  const det=DB.pedido_detalle.find(d=>d.id==="det-vaso");
  check("15. costo real de la línea = promedio ponderado del grupo ($2.4167)",
    det&&approx(parseFloat(det.costo_real),2.4167,0.001),det?.costo_real);

  check("16. sin doble descuento (solo 2 salidas en total)",DB.movimientos_almacen.filter(x=>x.tipo==="salida").length===2);
  // La nota debe dejar rastro de que salió de una variante (auditoría)
  check("17. la salida de la variante queda anotada como tal",
    salNav&&/variante/i.test(String(salNav.nota||"")),salNav?.nota);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
