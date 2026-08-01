/* Prueba E2E enfocada: red de seguridad de descuento de ALMACÉN (v7.8).
   Verifica que, si un pedido de "Almacén interno" se RECIBE en sucursal SIN
   haberse surtido, el sistema descuenta el almacén (PEPS) al recibir — para
   que no quede inventario fantasma. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true}],
  tipos_flujo_costo:[{id:"tf-alm",nombre:"Almacen interno",quien_captura_precio:"almacen",proveedor_ve_pedido:false,costo_editable:false}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-alm",nombre:"Almacén Central",tipo_flujo_id:"tf-alm",activo:true}],
  insumos:[{id:"ins-cafe",nombre:"CAFE",unidad_base:"pz",tipo_control:"inventariable",categoria_gasto:null,activo:true}],
  catalogo:[{id:"cat-cafe",sku:"SUP-100",articulo:"CAFE 100",tipo_producto:"SUPLEMENTO",unidad_id:"u-pz",costo_referencia:50,proveedor_id:"prov-alm",aplica_iva:true,activo:true,insumo_id:"ins-cafe",contenido:1,inventario_almacen_id:"ia-cafe",notas:null}],
  inventario_almacen:[{id:"ia-cafe",sku:"SUP-100",descripcion:"CAFE",unidad_id:"u-pz",existencia:100,costo_unitario_actual:50,lead_time:null}],
  // v7.13: el lote trae IVA para verificar que el costeo lo IGNORA (costo sin IVA).
  lotes_almacen:[{id:"lote-cafe",inventario_id:"ia-cafe",fecha_entrada:"2026-01-01",cantidad:100,existencia_restante:100,costo_unitario:50,iva:8,existencia_restante_num:100}],
  pedidos:[{id:"ped-alm",numero_pedido:"PED-ALM-001",fecha:"2026-07-25",sucursal_id:"suc-1",estatus:"en_proceso",total_teorico:500}],
  pedido_detalle:[{id:"det-cafe",pedido_id:"ped-alm",catalogo_id:"cat-cafe",proveedor_id:"prov-alm",cantidad:10,costo_referencia:50,costo_real:null}],
  pedido_proveedor_estatus:[{id:"pe-alm",pedido_id:"ped-alm",proveedor_id:"prov-alm",estatus:"enviado",token_activo:false}],
  tipos_flujo_costo_extra:[],
  categorias_gastos:[],inventario_almacen_mov:[],movimientos_almacen:[],salidas_peps:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],ventas:[],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],
};
const DEFAULTS={
  inventario_sucursal:{existencia:0,costo_promedio:0,minimo_stock:0},
  pedidos:{estatus:"creado",total_teorico:0,total_real:0},
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

  console.log("\n== Red de seguridad: descuento de almacén al recibir sin surtir (v7.8) ==");
  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").click();
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // Estado inicial: almacén con 100, sin salidas
  check("inicio: almacén CAFE en 100",DB.inventario_almacen[0].existencia===100);
  check("inicio: sin salidas de almacén",DB.movimientos_almacen.filter(x=>x.tipo==="salida").length===0);

  // Navegar a Recepción (sucursal) y recibir el pedido de almacén interno SIN surtir
  await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
  const it=page.getByRole("button",{name:"Recepción",exact:true});
  try{await it.waitFor({timeout:1500});await it.click();}catch(e){}
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:"Recibir mercancía"}).first().click();
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(900);

  // Verificaciones: el almacén se descontó al recibir
  const sal=DB.movimientos_almacen.filter(x=>x.tipo==="salida"&&x.pedido_id==="ped-alm");
  check("1. se creó salida de almacén al recibir (sin surtir)",sal.length===1,sal.map(s=>s.cantidad));
  check("2. la salida descontó 10 pz",sal[0]&&approx(parseFloat(sal[0].cantidad),10),sal[0]?.cantidad);
  check("3. existencia de almacén bajó 100 → 90",approx(DB.inventario_almacen[0].existencia,90),DB.inventario_almacen[0].existencia);
  check("4. el lote PEPS bajó 100 → 90",approx(DB.lotes_almacen[0].existencia_restante,90),DB.lotes_almacen[0].existencia_restante);
  check("5. se registró la salida PEPS por lote",DB.salidas_peps.length===1,DB.salidas_peps.length);
  check("6. entró al inventario de sucursal (10 pz)",DB.inventario_sucursal.some(i=>i.insumo_id==="ins-cafe"&&approx(parseFloat(i.existencia),10)),DB.inventario_sucursal.map(i=>i.existencia));
  check("7. sin doble descuento (una sola salida)",DB.movimientos_almacen.filter(x=>x.tipo==="salida").length===1);

  // v7.13: el costeo va SIN IVA. El lote es 50 + 8 de IVA: el costo que viaja a
  // la sucursal y a las recetas debe ser 50, no 58.
  const invS=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-cafe");
  check("8. el costo a sucursal es SIN IVA (50, no 58)",invS&&approx(parseFloat(invS.costo_promedio),50),invS?.costo_promedio);
  const movS=DB.movimientos_sucursal.filter(m=>m.insumo_id==="ins-cafe");
  check("9. el movimiento de sucursal registra el costo sin IVA",movS.length>0&&approx(parseFloat(movS[0].costo_unitario),50),movS.map(m=>m.costo_unitario));
  const sp=DB.salidas_peps[0];
  check("10. la salida PEPS costea sin IVA (50/u, 500 el total)",sp&&approx(parseFloat(sp.costo_unitario_lote),50)&&approx(parseFloat(sp.costo_total),500),sp);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
