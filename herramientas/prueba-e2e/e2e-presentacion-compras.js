/* Prueba E2E enfocada: sucursal declara la necesidad, compras decide la
   presentación (v7.18).

   Verifica las cuatro piezas del acuerdo con dirección (2026-08-08):
   1. Sucursal ve como default la presentación PREFERIDA, no la más barata por
      unidad base (que en los dos casos reales era la que nunca se compra).
   2. El pedido guarda cantidad_base — la NECESIDAD en unidad base. Sin ella
      compras no tiene desde dónde recalcular al cambiar de envase.
   3. Compras puede cambiar la presentación, y el recálculo sale de la necesidad,
      NO del volumen que iba a llegar (el excedente del envase es artefacto del
      empaque, no un requerimiento).
   4. Si la presentación nueva es de otro proveedor, la línea se mueve con la
      mecánica completa: estatus del proveedor nuevo, limpieza del huérfano y
      bitácora. Un PATCH pelón al catalogo_id dejaría el pedido colgado del
      proveedor equivocado.

   Escenario: CLARAS DE HUEVO en ml, con litro (1000 ml, $47 — más barata por ml)
   y galón (3800 ml, $180 — la PREFERIDA, la que de verdad se compra), más un
   galón de otro proveedor para probar el cambio de proveedor. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[
    {id:"u-lt",clave:"lt",nombre:"Litro",tipo:"volumen",activa:true},
    {id:"u-gal",clave:"gal",nombre:"Galon",tipo:"volumen",activa:true},
  ],
  tipos_flujo_costo:[{id:"tf-com",nombre:"Commodity",quien_captura_precio:"proveedor",proveedor_ve_pedido:true,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[
    {id:"prov-bot",nombre:"Botello",tipo_flujo_id:"tf-com",activo:true},
    {id:"prov-meli",nombre:"Meli",tipo_flujo_id:"tf-com",activo:true},
  ],
  insumos:[{id:"ins-claras",nombre:"CLARAS DE HUEVO",unidad_base:"ml",tipo_control:"inventariable",categoria_gasto:null,activo:true}],
  catalogo:[
    // La MÁS BARATA por ml ($0.0470) — antes de v7.18 ésta ganaba el default.
    {id:"cat-lt",sku:"ABA-003",articulo:"CLARAS DE HUEVO 1 LT",tipo_producto:"ABARROTES",unidad_id:"u-lt",costo_referencia:47,proveedor_id:"prov-bot",aplica_iva:false,activo:true,insumo_id:"ins-claras",contenido:1000,inventario_almacen_id:null,notas:null,preferida:false},
    // La PREFERIDA ($0.0474/ml) — un pelo más cara por ml, pero es la real.
    {id:"cat-gal",sku:"ABA-004",articulo:"CLARAS DE HUEVO GALON 3.8",tipo_producto:"ABARROTES",unidad_id:"u-gal",costo_referencia:180,proveedor_id:"prov-bot",aplica_iva:false,activo:true,insumo_id:"ins-claras",contenido:3800,inventario_almacen_id:null,notas:null,preferida:true},
    // Mismo insumo, OTRO proveedor: para el cambio de proveedor.
    {id:"cat-gal-meli",sku:"ABA-005",articulo:"CLARAS DE HUEVO GALON MELI",tipo_producto:"ABARROTES",unidad_id:"u-gal",costo_referencia:175,proveedor_id:"prov-meli",aplica_iva:false,activo:true,insumo_id:"ins-claras",contenido:3800,inventario_almacen_id:null,notas:null,preferida:false},
  ],
  inventario_almacen:[],lotes_almacen:[],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],pedido_reasignaciones:[],
  pedido_presentacion_cambios:[],
  tipos_flujo_costo_extra:[],categorias_gastos:[],inventario_almacen_mov:[],movimientos_almacen:[],salidas_peps:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],ventas:[],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],
};
const DEFAULTS={
  pedidos:{estatus:"creado",total_teorico:0,total_real:0},
  catalogo:{activo:true,contenido:1,preferida:false},
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

async function login(page,html,texto,pass){
  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText(texto).first().click();
  await page.locator("input[type=password]").fill(pass);
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});
}

(async()=>{
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const ctx=await browser.newContext();
  const page=await ctx.newPage();
  let ultimoDialogo="";
  page.on("dialog",async d=>{ultimoDialogo=d.message();await d.accept();});
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));
  // El route va en el CONTEXTO, no en la página: la parte 3 abre una segunda
  // pestaña (compras) y necesita el mismo backend simulado.
  await ctx.route("**/*",async route=>{
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

  console.log("\n== Sucursal pide en consumo; compras decide la presentación (v7.18) ==");

  // ---------- PARTE 1: sucursal pide 4,000 ml ----------
  await login(page,html,"Crea pedidos","roma2026");
  await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
  const itPed=page.getByRole("button",{name:"Nuevo pedido",exact:true});
  try{await itPed.waitFor({timeout:1500});await itPed.click();}catch(e){}
  await page.waitForTimeout(400);
  try{await page.getByRole("button",{name:"Nuevo pedido"}).first().click();}catch(e){}
  await page.waitForTimeout(400);

  await page.getByRole("heading",{name:"Nuevo pedido"}).waitFor({timeout:10000});
  // El default del selector debe ser la PREFERIDA (galón), no la más barata (litro).
  const sel=page.locator("select").first();
  const defaultSel=await sel.inputValue();
  check("1. el default de sucursal es la PREFERIDA (galón), no la más barata",defaultSel==="cat-gal",defaultSel);

  await page.locator("input[type=number]").first().fill("4000");
  await page.waitForTimeout(400);
  const cuerpo=await page.locator("body").innerText();
  check("2. con galón se piden 2 unidades (ceil 4000/3800)",/2\s*gal/i.test(cuerpo),cuerpo.match(/.{0,40}gal.{0,40}/i)?.[0]);

  await page.getByRole("button",{name:/Enviar pedido/}).click();
  await page.waitForTimeout(900);

  const det=DB.pedido_detalle[0];
  check("3. se creó la línea del pedido",!!det,DB.pedido_detalle.length);
  check("4. quedó guardada cantidad_base = 4000 ml (la NECESIDAD)",det&&approx(parseFloat(det.cantidad_base),4000),det?.cantidad_base);
  check("5. la cantidad es 2 galones",det&&approx(parseFloat(det.cantidad),2),det?.cantidad);
  check("6. la línea apunta al galón y a Botello",det&&det.catalogo_id==="cat-gal"&&det.proveedor_id==="prov-bot",{c:det?.catalogo_id,p:det?.proveedor_id});

  // ---------- PARTE 2: compras cambia a litros (mismo proveedor) ----------
  const page2=await ctx.newPage();
  page2.on("dialog",async d=>{ultimoDialogo=d.message();await d.accept();});
  page2.on("pageerror",e=>console.log("  [pageerror2]",e.message));
  await login(page2,html,"Acceso total","fittaste2026");
  await page2.getByRole("button",{name:new RegExp("Compras")}).first().click();
  const itBan=page2.getByRole("button",{name:"Pedidos",exact:true});
  try{await itBan.waitFor({timeout:1500});await itBan.click();}catch(e){}
  await page2.waitForTimeout(500);
  await page2.getByRole("button",{name:/^Pedido PED-/}).first().click();
  await page2.waitForTimeout(700);

  const cuerpo2=await page2.locator("body").innerText();
  check("7. compras ve lo que pidió sucursal en unidad base (4,000 ml)",/Sucursal pidió/.test(cuerpo2)&&/4,?000/.test(cuerpo2),cuerpo2.match(/Sucursal pidió.{0,40}/)?.[0]);

  // El selector de presentación es el primer select de la tabla de la línea.
  const selPres=page2.locator("select").filter({hasText:"CLARAS DE HUEVO GALON 3.8"}).first();
  await selPres.waitFor({timeout:5000});
  await selPres.selectOption("cat-lt");
  await page2.waitForTimeout(900);

  const det2=DB.pedido_detalle[0];
  check("8. recalculó DESDE LA NECESIDAD: 4 litros, no 8",det2&&approx(parseFloat(det2.cantidad),4),det2?.cantidad);
  check("9. la línea quedó en la presentación de litro",det2&&det2.catalogo_id==="cat-lt",det2?.catalogo_id);
  check("10. se actualizó el costo de referencia a $47",det2&&approx(parseFloat(det2.costo_referencia),47),det2?.costo_referencia);
  check("11. cantidad_base NO se movió (sigue 4,000 ml)",det2&&approx(parseFloat(det2.cantidad_base),4000),det2?.cantidad_base);
  check("12. se registró el cambio en la bitácora",DB.pedido_presentacion_cambios.length===1,DB.pedido_presentacion_cambios.length);
  const log1=DB.pedido_presentacion_cambios[0];
  check("13. la bitácora guarda de dónde a dónde",log1&&log1.catalogo_original_id==="cat-gal"&&log1.catalogo_nuevo_id==="cat-lt",log1);
  check("14. la bitácora marca que NO hubo cambio de proveedor",log1&&log1.cambio_proveedor===false,log1?.cambio_proveedor);
  const ped1=DB.pedidos[0];
  check("15. el total teórico se recalculó (4 × $47 = $188)",ped1&&approx(parseFloat(ped1.total_teorico),188),ped1?.total_teorico);

  // ---------- PARTE 3: compras cambia al galón de OTRO proveedor ----------
  const selPres2=page2.locator("select").filter({hasText:"CLARAS DE HUEVO 1 LT"}).first();
  await selPres2.waitFor({timeout:5000});
  await selPres2.selectOption("cat-gal-meli");
  await page2.waitForTimeout(1000);

  const det3=DB.pedido_detalle[0];
  check("16. la línea se movió al proveedor nuevo",det3&&det3.proveedor_id==="prov-meli",det3?.proveedor_id);
  check("17. volvió a 2 unidades (ceil 4000/3800)",det3&&approx(parseFloat(det3.cantidad),2),det3?.cantidad);
  check("18. el aviso advirtió del cambio de proveedor",/Meli/.test(ultimoDialogo),ultimoDialogo);
  check("19. se creó el estatus del proveedor nuevo",DB.pedido_proveedor_estatus.some(pe=>pe.proveedor_id==="prov-meli"),DB.pedido_proveedor_estatus.map(p=>p.proveedor_id));
  check("20. se limpió el estatus del proveedor que quedó sin líneas",!DB.pedido_proveedor_estatus.some(pe=>pe.proveedor_id==="prov-bot"),DB.pedido_proveedor_estatus.map(p=>p.proveedor_id));
  check("21. quedó registrada la reasignación de proveedor",DB.pedido_reasignaciones.length===1,DB.pedido_reasignaciones.length);
  check("22. la bitácora marca el cambio de proveedor",DB.pedido_presentacion_cambios.length===2&&DB.pedido_presentacion_cambios[1].cambio_proveedor===true,DB.pedido_presentacion_cambios[1]);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
