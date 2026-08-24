/* Prueba enfocada: buscador en los dos inventarios (v7.26).

   Petición de dirección: "en los inventarios tanto sucursal como almacén
   podemos poner una barra de búsqueda como la que tenemos en los insumos? para
   encontrar el producto sin necesidad de tanto scroll."

   El almacén tiene ~90 SKU y el inventario de sucursal ~150 renglones (más las
   25 preparaciones que se sumaron en v7.25). La hoja de conteo y la pestaña de
   insumos ya tenían buscador; estas dos, que son las que más se consultan, no.

   Verifica: (1) las dos barras existen y filtran, (2) la búsqueda ignora acentos
   y mayúsculas, (3) el vacío por búsqueda dice "no coincide" y NO el mensaje de
   "sin inventario", que sería falso, (4) el botón de limpiar restaura la lista,
   (5) en el almacén una VARIANTE se muestra junto con su base, para que el grupo
   no se lea partido. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Prov",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[
    {id:"i-jit",  nombre:"JITOMATE",       unidad_base:"g", tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"i-plat", nombre:"PLÁTANO",        unidad_base:"pz",tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"i-pollo",nombre:"POLLO",          unidad_base:"g", tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"i-ranch",nombre:"ADEREZO RANCH",  unidad_base:"lt",tipo_control:"preparacion", activo:true,preparacion_id:"prep-ranch"},
  ],
  catalogo:[
    {id:"c-jit",sku:"VER-001",articulo:"JITOMATE KG",tipo_producto:"VERDURA",unidad_id:"u-kg",costo_referencia:20,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"i-jit",contenido:1000,inventario_almacen_id:null,notas:null},
  ],
  inventario_sucursal:[
    {id:"is-jit",  sucursal_id:"suc-1",insumo_id:"i-jit",  existencia:3000,costo_promedio:0.02},
    {id:"is-plat", sucursal_id:"suc-1",insumo_id:"i-plat", existencia:40,  costo_promedio:5},
    {id:"is-pollo",sucursal_id:"suc-1",insumo_id:"i-pollo",existencia:8000,costo_promedio:0.13},
    {id:"is-ranch",sucursal_id:"suc-1",insumo_id:"i-ranch",existencia:2,   costo_promedio:30},
  ],
  // Almacén: una base con su variante, más dos productos sin relación.
  inventario_almacen:[
    {id:"a-pollo",sku:"PRO-001",descripcion:"POLLO PECHUGA",unidad_id:"u-kg",existencia:20,costo_unitario_actual:130,activo:true,variante_de:null},
    {id:"a-pollo2",sku:"PRO-002",descripcion:"MARCA BACHOCO",unidad_id:"u-kg",existencia:5,costo_unitario_actual:135,activo:true,variante_de:"a-pollo"},
    {id:"a-jit",  sku:"VER-001",descripcion:"JITOMATE SALADETTE",unidad_id:"u-kg",existencia:10,costo_unitario_actual:20,activo:true,variante_de:null},
    {id:"a-plat", sku:"FRU-001",descripcion:"PLÁTANO TABASCO",unidad_id:"u-kg",existencia:15,costo_unitario_actual:18,activo:true,variante_de:null},
  ],
  lotes_almacen:[
    {id:"l-1",inventario_id:"a-pollo",cantidad:20,existencia_restante:20,costo_unitario:130,fecha:"2026-08-01"},
    {id:"l-2",inventario_id:"a-jit",  cantidad:10,existencia_restante:10,costo_unitario:20, fecha:"2026-08-01"},
  ],
  productos_venta:[{id:"prep-ranch",nombre:"ADEREZO RANCH",es_preparacion:true,unidad:"lt",rendimiento:2,precio_venta:0,activo:true}],
  recetas:[],producciones:[],produccion_consumo:[],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],
  movimientos_almacen:[],salidas_peps:[],inventario_almacen_mov:[],categorias_gastos:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],ventas:[],venta_detalle:[],mermas:[],movimientos_sucursal:[],
  reglas_consumo_ticket:[],
};
const DEFAULTS={insumos:{activo:true},catalogo:{activo:true,contenido:1},inventario_sucursal:{existencia:0,costo_promedio:0}};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq."))      {if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")){const l=v.slice(4,-1).split(",");if(!l.includes(String(row[k])))return false;}
    else if(v==="not.is.null")   {if(row[k]==null)return false;}
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
  console.log("\n== Buscador en los dos inventarios (v7.26) ==");
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
  await page.getByText("Acceso total").first().click();
  await page.locator("input[type=password]").fill("fittaste2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // ================= INVENTARIO DE SUCURSAL =================
  await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
  await page.getByRole("button",{name:"Inventario sucursal · merma",exact:true}).click();
  await page.waitForTimeout(600);

  const caja=page.getByPlaceholder(/Buscar insumo o preparación por nombre/);
  check("1. el inventario de sucursal tiene barra de búsqueda",await caja.count()>0);
  const filas=()=>page.locator("table tbody tr");
  const antes=await filas().count();
  check("2. sin filtro se ven los 4 renglones",antes===4,antes);

  await caja.fill("pollo");
  await page.waitForTimeout(400);
  check("3. filtra a POLLO",(await filas().count())===1,await filas().count());
  const t1=await page.locator("body").innerText();
  check("4. y ya no muestra JITOMATE",!/JITOMATE/.test(t1));
  check("5. el contador dice cuántos de cuántos",/1 de 4 insumos/.test(t1),(t1.match(/.{0,30}de 4 insumos.{0,20}/)||[])[0]);

  // Acentos: "platano" debe encontrar "PLÁTANO"
  await caja.fill("platano");
  await page.waitForTimeout(400);
  const t2=await page.locator("body").innerText();
  check("6. la búsqueda ignora acentos (platano → PLÁTANO)",/PLÁTANO/.test(t2)&&(await filas().count())===1,await filas().count());

  // Encuentra también las preparaciones nuevas
  await caja.fill("ranch");
  await page.waitForTimeout(400);
  check("7. encuentra preparaciones",/ADEREZO RANCH/.test(await page.locator("body").innerText()));

  // Vacío por búsqueda: NO debe decir "sin inventario"
  await caja.fill("zzzz");
  await page.waitForTimeout(400);
  const t3=await page.locator("body").innerText();
  check("8. sin coincidencias dice 'no coincide'",/Ningún insumo del inventario coincide/.test(t3));
  check("9. y NO dice 'Sin insumos en inventario', que sería falso",
    !/Sin insumos en inventario de sucursal/.test(t3));

  // Limpiar restaura
  await page.locator('button[title="Limpiar"]').first().click();
  await page.waitForTimeout(400);
  check("10. el botón de limpiar restaura la lista completa",(await filas().count())===4,await filas().count());
  check("11. y quita el contador del filtro",!/de 4 insumos/.test(await page.locator("body").innerText()));

  // ================= INVENTARIO DE ALMACÉN =================
  await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
  await page.getByRole("button",{name:"Inventario almacén",exact:true}).click();
  await page.waitForTimeout(600);

  const cajaA=page.getByPlaceholder(/Buscar producto por nombre o SKU/);
  check("12. el inventario de almacén tiene barra de búsqueda",await cajaA.count()>0);
  const antesA=await filas().count();
  check("13. sin filtro se ven los 4 productos",antesA===4,antesA);

  await cajaA.fill("jitomate");
  await page.waitForTimeout(400);
  check("14. filtra a JITOMATE SALADETTE",(await filas().count())===1,await filas().count());

  // Por SKU
  await cajaA.fill("FRU-001");
  await page.waitForTimeout(400);
  check("15. también busca por SKU",/PLÁTANO TABASCO/.test(await page.locator("body").innerText()));

  // La variante viaja con su base: buscar "pollo" (que sólo está en la base)
  // debe traer también BACHOCO, que es su variante.
  await cajaA.fill("pollo");
  await page.waitForTimeout(400);
  const tA=await page.locator("body").innerText();
  check("16. buscar la base trae también su variante",
    /POLLO PECHUGA/.test(tA)&&/BACHOCO/.test(tA),(await filas().count()));
  // Y al revés: buscar la variante trae su base, para no leer el grupo partido.
  await cajaA.fill("bachoco");
  await page.waitForTimeout(400);
  const tB=await page.locator("body").innerText();
  check("17. buscar la variante trae también su base",
    /BACHOCO/.test(tB)&&/POLLO PECHUGA/.test(tB),(await filas().count()));

  await cajaA.fill("zzzz");
  await page.waitForTimeout(400);
  check("18. sin coincidencias avisa en el almacén",
    /Ningún producto del almacén coincide/.test(await page.locator("body").innerText()));

  await page.locator('button[title="Limpiar"]').first().click();
  await page.waitForTimeout(400);
  check("19. limpiar restaura el almacén",(await filas().count())===4,await filas().count());

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
