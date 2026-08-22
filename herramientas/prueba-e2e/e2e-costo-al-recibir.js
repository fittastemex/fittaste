/* Prueba enfocada: el COSTO UNITARIO se captura al RECIBIR (v7.23).

   Decisión de dirección (2026-08-22): "necesito que cuando reciban pongan el
   precio unitario para que se reciba con un costo."

   Qué estaba mal. Se podía recibir sin precio y no pasaba nada visible: la
   entrada tomaba el costo del catálogo, o el promedio anterior si el catálogo
   estaba en 0. El pedido sólo exigía el precio para poder CERRARSE, y ahí está
   el hueco: `capturarPrecio` sólo hace PATCH a `pedido_detalle`, **nunca
   recostea la entrada ya registrada**. El movimiento de kárdex y el
   costo_promedio se quedaban con el estimado para siempre, así que el promedio
   nunca aprendía el precio real del lote — y el P&L, que lee el kárdex,
   arrastraba el estimado.

   Ya ocurría en producción: recepciones sin `costo_real` de Del Mar (10-ago),
   Yerina, Pollo y Juan Carlos Botello.

   Verifica: (1) sin costo NO se recibe y se dice qué artículo falta,
   (2) con costo capturado la entrada al inventario usa ESE precio (no el del
       catálogo), (3) el costo queda escrito en pedido_detalle.costo_real,
   (4) un precio 5 veces arriba del catálogo se marca (¿capturaste el total en
       vez del unitario?), (5) al proveedor de almacén interno NO se le pide
       precio, porque ahí costea el sistema por PEPS. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[
    {id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true},
    {id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true},
  ],
  tipos_flujo_costo:[
    {id:"tf-manual",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true},
    {id:"tf-alm",nombre:"Almacen interno",quien_captura_precio:"sistema",proveedor_ve_pedido:false,costo_editable:false},
  ],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[
    {id:"prov-pollo",nombre:"Pollo",tipo_flujo_id:"tf-manual",activo:true},
    {id:"prov-alm",nombre:"Almacen",tipo_flujo_id:"tf-alm",activo:true},
  ],
  insumos:[{id:"ins-pollo",nombre:"POLLO",unidad_base:"g",tipo_control:"inventariable",activo:true}],
  // El catálogo dice $100/kg. La factura que llega dice $130/kg: ése es el
  // precio que debe quedar, y es la diferencia que la prueba mide.
  catalogo:[{id:"cat-pollo",sku:"PRO-001",articulo:"POLLO KG",tipo_producto:"PROTEINAS",unidad_id:"u-kg",
    costo_referencia:100,proveedor_id:"prov-pollo",aplica_iva:false,activo:true,
    insumo_id:"ins-pollo",contenido:1000,inventario_almacen_id:null,notas:null}],
  pedidos:[{id:"ped-1",numero_pedido:"PED-PRUEBA-001",sucursal_id:"suc-1",estatus:"en_proceso",created_at:new Date().toISOString()}],
  // costo_real en null: es exactamente el caso que se quiere bloquear.
  pedido_detalle:[{id:"det-1",pedido_id:"ped-1",catalogo_id:"cat-pollo",proveedor_id:"prov-pollo",
    cantidad:10,costo_referencia:100,costo_real:null,capturado_por:null,fecha_captura:null}],
  pedido_proveedor_estatus:[{id:"pe-1",pedido_id:"ped-1",proveedor_id:"prov-pollo",estatus:"enviado"}],
  inventario_almacen:[],lotes_almacen:[],movimientos_almacen:[],salidas_peps:[],
  inventario_almacen_mov:[],categorias_gastos:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],
  ventas:[],venta_detalle:[],mermas:[],movimientos_sucursal:[],reglas_consumo_ticket:[],
};
const DEFAULTS={
  insumos:{activo:true,unidad_base:"pz",tipo_control:"inventariable"},
  catalogo:{activo:true,contenido:1,costo_referencia:0},
  inventario_sucursal:{existencia:0,costo_promedio:0},
};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq."))       {if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")) {const l=v.slice(4,-1).split(",");if(!l.includes(String(row[k])))return false;}
    else if(v==="not.is.null")    {if(row[k]==null)return false;}
  }
  return true;
}
function handleRest(method,table,search,body){
  if(!(table in DB))return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  const params=[...new URLSearchParams(search).entries()];
  if(method==="GET")return{status:200,body:JSON.stringify(DB[table].filter(r=>matchFilters(r,params)))};
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    const ins=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);
      if(!row.created_at)row.created_at=new Date().toISOString();DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){const upd=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};upd.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(upd)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}
const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

(async()=>{
  console.log("\n== El costo unitario se captura al recibir (v7.23) ==");
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
    if(rest){let body=null;try{body=route.request().postData()?JSON.parse(route.request().postData()):null;}catch(e){}
      const res=handleRest(m,rest[1],rest[3]||"",body);return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();   // rol Sucursal
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // Ir a Recepción de mercancía
  await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
  await page.getByRole("button",{name:"Recepción",exact:true}).click();
  await page.getByText("PED-PRUEBA-001").first().waitFor({timeout:10000});
  await page.getByRole("button",{name:/Recibir/}).first().click();
  await page.getByText(/Recepción —/).waitFor({timeout:5000});

  // ---- 1) La columna de costo existe y viene vacía (el pedido no traía precio) ----
  const cajaCosto=page.locator('input[placeholder="0.00"]').first();
  check("1. la pantalla de recepción pide el costo unitario",await cajaCosto.count()>0);
  check("2. viene vacío porque el pedido no traía precio",(await cajaCosto.inputValue())==="",await cajaCosto.inputValue());
  check("3. muestra el precio de catálogo como referencia",
    await page.getByText(/catálogo/).first().isVisible());

  // ---- 2) Sin costo NO se recibe ----
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(600);
  check("4. sin costo NO se creó la recepción",DB.recepciones.length===0,DB.recepciones.length);
  check("5. sin costo NO entró nada al inventario",DB.inventario_sucursal.length===0,DB.inventario_sucursal);
  const avisoVis=await page.getByText(/Falta el costo unitario/).isVisible().catch(()=>false);
  check("6. avisa qué falta, en pantalla",avisoVis);
  check("7. el aviso nombra el artículo",
    avisoVis&&/POLLO KG/.test(await page.getByText(/Falta el costo unitario/).innerText()));

  // ---- 3) Un precio absurdo se marca (5x el de catálogo) ----
  await cajaCosto.fill("1300");   // el total de 10 kg, no el unitario
  await page.waitForTimeout(300);
  check("8. un precio 13× el de catálogo se marca en pantalla",
    await page.getByText(/¿es el unitario\?/).isVisible());

  // ---- 4) Con el costo correcto sí recibe, y con ESE precio ----
  await cajaCosto.fill("130");     // la factura real: $130/kg
  await page.waitForTimeout(300);
  check("9. muestra el importe de la línea ($1,300)",
    (await page.locator("td").filter({hasText:/^\$1,300\.00$/}).count())>0);
  check("10. muestra el total sin IVA de lo recibido",
    await page.getByText(/Total sin IVA de lo recibido/).isVisible());

  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(1500);

  check("11. la recepción sí se creó",DB.recepciones.length===1,DB.recepciones.length);
  const det=DB.pedido_detalle.find(d=>d.id==="det-1");
  check("12. el costo queda escrito en el pedido ($130)",parseFloat(det.costo_real)===130,det.costo_real);
  check("13. queda anotado quién lo capturó",det.capturado_por==="sucursal",det.capturado_por);

  const inv=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-pollo");
  check("14. entraron 10,000 g al inventario",inv&&parseFloat(inv.existencia)===10000,inv?.existencia);
  // 130/kg ÷ 1000 g = 0.13/g. Con el precio de catálogo habría quedado 0.10.
  check("15. el costo promedio usa la FACTURA (0.13/g), no el catálogo (0.10)",
    inv&&Math.abs(parseFloat(inv.costo_promedio)-0.13)<0.0001,inv?.costo_promedio);
  const mov=DB.movimientos_sucursal.find(m=>m.tipo==="entrada_recepcion");
  check("16. el kárdex nace con el precio de la factura",
    mov&&Math.abs(parseFloat(mov.costo_unitario)-0.13)<0.0001,mov?.costo_unitario);

  // ---- 5) Al almacén interno no se le pide precio (costea por PEPS) ----
  DB.pedidos.push({id:"ped-2",numero_pedido:"PED-PRUEBA-002",sucursal_id:"suc-1",estatus:"en_proceso",created_at:new Date().toISOString()});
  DB.pedido_detalle.push({id:"det-2",pedido_id:"ped-2",catalogo_id:"cat-pollo",proveedor_id:"prov-alm",
    cantidad:5,costo_referencia:100,costo_real:null,capturado_por:null,fecha_captura:null});
  DB.pedido_proveedor_estatus.push({id:"pe-2",pedido_id:"ped-2",proveedor_id:"prov-alm",estatus:"enviado"});
  await page.reload();
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();   // rol Sucursal
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});
  await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
  await page.getByRole("button",{name:"Recepción",exact:true}).click();
  await page.getByText("PED-PRUEBA-002").first().waitFor({timeout:10000});
  // PED-PRUEBA-001 ya se recibió arriba, así que el único pendiente es el 002.
  await page.getByRole("button",{name:/Recibir/}).first().click();
  await page.getByText(/Recepción —/).waitFor({timeout:5000});
  check("17. al almacén interno no se le pide precio",
    await page.getByText(/lo calcula el sistema \(PEPS\)/).isVisible());
  check("18. y no hay casilla de costo que llenar",
    (await page.locator('input[placeholder="0.00"]').count())===0);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
