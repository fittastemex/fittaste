/* Prueba E2E enfocada: alta de INSUMO + PRESENTACIÓN desde el popup (v7.17).

   Bug que cubre: los avisos del popup se escribían en el banner de la página,
   que queda TAPADO por el overlay del popup. Si faltaba el proveedor, se
   apretaba "Guardar insumo + presentación", no pasaba nada visible, el popup
   se quedaba abierto y parecía que sí había guardado — cuando en realidad no
   se escribió ni el insumo ni la presentación. (Reportado en producción el
   2026-08-08: "creó ALBUMINA DE HUEVO y no le aparece".)

   Verifica: (1) sin proveedor NO guarda y SÍ se ve el error dentro del popup,
   (2) con todo completo guarda insumo + presentación y cierra el popup. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[
    {id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true},
    {id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true},
  ],
  tipos_flujo_costo:[{id:"tf-prov",nombre:"Proveedor externo",quien_captura_precio:"proveedor",proveedor_ve_pedido:true,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Distribuidora Fit",tipo_flujo_id:"tf-prov",activo:true}],
  insumos:[{id:"ins-pollo",nombre:"POLLO",unidad_base:"g",tipo_control:"inventariable",categoria_gasto:null,activo:true}],
  catalogo:[{id:"cat-pollo",sku:"PRO-001",articulo:"POLLO KG",tipo_producto:"PROTEINAS",unidad_id:"u-kg",costo_referencia:89,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-pollo",contenido:1000,inventario_almacen_id:null,notas:null}],
  inventario_almacen:[],lotes_almacen:[],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],
  tipos_flujo_costo_extra:[],categorias_gastos:[],inventario_almacen_mov:[],movimientos_almacen:[],salidas_peps:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],ventas:[],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],
};
const DEFAULTS={
  insumos:{activo:true,unidad_base:"pz",tipo_control:"inventariable"},
  catalogo:{activo:true,contenido:1,costo_referencia:0},
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
// Réplica de la UNIQUE de catalogo.sku en la base real: el popup depende de que
// un SKU duplicado devuelva 409 para poder incrementarlo y reintentar.
function handleRest(method,table,search,body){
  if(!(table in DB))return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  const params=[...new URLSearchParams(search).entries()];
  const limit=params.find(p=>p[0]==="limit");
  if(method==="GET"){let rows=DB[table].filter(r=>matchFilters(r,params));if(limit)rows=rows.slice(0,parseInt(limit[1]));return{status:200,body:JSON.stringify(rows)};}
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    if(table==="catalogo"&&arr.some(r=>DB.catalogo.some(c=>c.sku===r.sku)))
      return{status:409,body:JSON.stringify({code:"23505",message:'duplicate key value violates unique constraint "catalogo_sku_key"'})};
    const ins=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);if(!row.created_at)row.created_at=new Date().toISOString();DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){const upd=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};upd.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(upd)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}
const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

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

  console.log("\n== Alta de insumo + presentación: los errores se ven DENTRO del popup (v7.17) ==");
  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Acceso total").first().click();
  await page.locator("input[type=password]").fill("fittaste2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  await page.getByRole("button",{name:new RegExp("Catálogos")}).first().click();
  const itCat=page.getByRole("button",{name:"Catálogo e insumos",exact:true});
  try{await itCat.waitFor({timeout:1500});await itCat.click();}catch(e){}
  await page.waitForTimeout(400);
  await page.getByRole("button",{name:"+ Nuevo insumo / presentación"}).click();
  await page.getByText("Nuevo insumo + presentación de compra").waitFor({timeout:5000});

  const insumosAntes=DB.insumos.length, catAntes=DB.catalogo.length;

  // ---- CASO 1: falta el proveedor (lo que pasó en producción) ----
  await page.getByPlaceholder("EJ. MIEL DE AGAVE",{exact:true}).fill("ALBUMINA DE HUEVO");
  await page.getByPlaceholder("EJ. MIEL DE AGAVE 25 KG").fill("ALBUMINA DE HUEVO 1 KG");
  await page.getByRole("button",{name:/Guardar insumo \+ presentación/}).click();
  await page.waitForTimeout(600);

  check("1. sin proveedor NO se creó el insumo",DB.insumos.length===insumosAntes,DB.insumos.map(i=>i.nombre));
  check("2. sin proveedor NO se creó la presentación",DB.catalogo.length===catAntes,DB.catalogo.map(c=>c.articulo));
  check("3. el popup sigue abierto",await page.getByText("Nuevo insumo + presentación de compra").isVisible());
  // El aviso debe estar dentro del popup y VISIBLE (no detrás del overlay).
  const aviso=page.locator("text=/Falta elegir el proveedor/").first();
  let avisoVisible=false;
  try{await aviso.waitFor({state:"visible",timeout:3000});avisoVisible=true;}catch(e){}
  check("4. el aviso 'falta el proveedor' se VE (dentro del popup)",avisoVisible);
  if(avisoVisible){
    // Debe estar dentro del contenedor del popup, no en el banner de la página.
    const dentro=await aviso.evaluate(el=>!!el.closest(".fixed.inset-0.z-50"));
    check("5. el aviso está dentro del popup, no en el banner tapado",dentro);
  }else{check("5. el aviso está dentro del popup, no en el banner tapado",false);}

  // ---- CASO 2: completo → sí guarda ----
  await page.locator("select").filter({hasText:"Seleccionar..."}).first().selectOption({label:"Distribuidora Fit"});
  await page.getByPlaceholder("Ej. 25000").fill("1000");
  await page.getByRole("button",{name:/Guardar insumo \+ presentación/}).click();
  await page.waitForTimeout(900);

  const nuevoIns=DB.insumos.find(i=>i.nombre==="ALBUMINA DE HUEVO");
  check("6. se creó el insumo ALBUMINA DE HUEVO",!!nuevoIns,DB.insumos.map(i=>i.nombre));
  check("7. el insumo queda activo",nuevoIns&&nuevoIns.activo!==false,nuevoIns?.activo);
  const nuevaPres=DB.catalogo.find(c=>c.articulo==="ALBUMINA DE HUEVO 1 KG");
  check("8. se creó la presentación de compra",!!nuevaPres,DB.catalogo.map(c=>c.articulo));
  check("9. la presentación queda ligada al insumo",nuevaPres&&nuevoIns&&nuevaPres.insumo_id===nuevoIns.id,{p:nuevaPres?.insumo_id,i:nuevoIns?.id});
  check("10. el contenido se guardó (1000 por paquete)",nuevaPres&&parseFloat(nuevaPres.contenido)===1000,nuevaPres?.contenido);
  check("11. la presentación queda activa",nuevaPres&&nuevaPres.activo!==false,nuevaPres?.activo);
  check("12. el popup se cerró al guardar",!(await page.getByText("Nuevo insumo + presentación de compra").isVisible()));

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
