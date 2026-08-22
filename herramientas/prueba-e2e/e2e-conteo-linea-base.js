/* Prueba enfocada: el primer conteo es LÍNEA BASE, no merma (v7.24).

   Pregunta de dirección (2026-08-22), antes de apretar el botón: "¿qué detona
   hoy 'cerrar conteo'?"

   Lo que detonaba: para cada insumo con diferencia, un movimiento de kárdex
   (`entrada_ajuste` si sobra, `salida_ajuste` si falta) y la existencia igual al
   físico. El estado de resultados lee esos movimientos como merma del mes: los
   faltantes suman y los sobrantes restan.

   El problema con el PRIMER conteo. Antes de contar, las existencias están
   negativas (se vendió sin recepción registrada y las recetas se corrigieron
   sobre la marcha). Contar sube la existencia del negativo al número físico, y
   esa diferencia se registraba como SOBRANTE — que no es un sobrante, es el
   saldo que nunca se había registrado.

   Con las existencias reales de producción al 22-ago-2026, contar sólo los 18
   insumos del piloto habría metido ~$139,489 de sobrante ficticio, y el mes
   habría cerrado con la utilidad inflada en esa cantidad. Contando todo el
   inventario, ~$243,379.

   Verifica: (1) el aviso aparece cuando hay existencias negativas capturadas y
   dice cuánto sobrante ficticio se registraría, (2) marcando "línea base" la
   existencia SÍ queda en el físico y el movimiento SÍ se escribe, (3) pero el
   estado de resultados NO lo cuenta como merma, (4) un conteo normal sí cuenta
   como merma (que es el comportamiento bueno y no se rompió). */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const hoy=new Date().toISOString().split("T")[0];
const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[{id:"tf-manual",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Pollo",tipo_flujo_id:"tf-manual",activo:true}],
  insumos:[
    {id:"ins-pollo",nombre:"POLLO",unidad_base:"g",tipo_control:"inventariable",activo:true},
    {id:"ins-res",nombre:"RES",unidad_base:"g",tipo_control:"inventariable",activo:true},
  ],
  catalogo:[
    {id:"cat-pollo",sku:"PRO-001",articulo:"POLLO KG",tipo_producto:"PROTEINAS",unidad_id:"u-kg",
     costo_referencia:130,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-pollo",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"cat-res",sku:"PRO-002",articulo:"RES KG",tipo_producto:"PROTEINAS",unidad_id:"u-kg",
     costo_referencia:250,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-res",contenido:1000,inventario_almacen_id:null,notas:null},
  ],
  // POLLO en -50 kg: el caso real. A $0.13/g, subirlo a 10 kg son 60 kg de
  // diferencia = $7,800 de "sobrante" que no es sobrante.
  // RES en +2 kg y contada en 1.5 kg: un faltante de verdad, $125.
  inventario_sucursal:[
    {id:"inv-pollo",sucursal_id:"suc-1",insumo_id:"ins-pollo",existencia:-50000,costo_promedio:0.13},
    {id:"inv-res",sucursal_id:"suc-1",insumo_id:"ins-res",existencia:2000,costo_promedio:0.25},
  ],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],
  inventario_almacen:[],lotes_almacen:[],movimientos_almacen:[],salidas_peps:[],
  inventario_almacen_mov:[],categorias_gastos:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],
  // Una venta del mes para que el estado de resultados tenga sobre qué calcular.
  ventas:[{id:"v-1",sucursal_id:"suc-1",fecha:hoy,folio:"T-1",origen:"manual",canal:"mostrador",
    subtotal:10000,iva:1600,total:11600,costo_teorico:3000,registrado_por:"admin",created_at:new Date().toISOString()}],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],reglas_consumo_ticket:[],
};
const DEFAULTS={insumos:{activo:true},catalogo:{activo:true,contenido:1,costo_referencia:0},inventario_sucursal:{existencia:0,costo_promedio:0}};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq."))      {if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")){const l=v.slice(4,-1).split(",");if(!l.includes(String(row[k])))return false;}
    else if(v.startsWith("gte.")){if(!(String(row[k])>=v.slice(4)))return false;}
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
  console.log("\n== El primer conteo es línea base, no merma (v7.24) ==");
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

  const entrar=async()=>{
    await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
    await page.getByText("Acceso total").first().click();
    await page.locator("input[type=password]").fill("fittaste2026");
    await page.getByRole("button",{name:"Ingresar"}).click();
    await page.getByText("Fit Taste Roma").waitFor({timeout:20000});
  };
  const irAConteo=async()=>{
    await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
    await page.getByRole("button",{name:"Inventario sucursal · merma",exact:true}).click();
    await page.getByRole("button",{name:"Hoja de conteo"}).click();
    await page.getByText(/Conteo físico|Cerrar conteo/).first().waitFor({timeout:10000});
  };

  await page.goto("http://fittaste.local/index.html");
  await entrar();
  await irAConteo();

  // Capturar 10 kg de pollo (teórico -50 kg) → diferencia +60 kg
  const cajas=page.locator('input[placeholder="—"]');
  const nCajas=await cajas.count();
  check("1. la hoja lista los insumos con inventario",nCajas===2,nCajas);
  // El orden es alfabético: POLLO va antes que RES
  await cajas.nth(0).fill("10000");
  await page.waitForTimeout(400);

  // ---- 1) El aviso del sobrante ficticio ----
  const avisoVis=await page.getByText(/de sobrante que reduciría la merma/).isVisible().catch(()=>false);
  check("2. avisa del sobrante ficticio al contar un negativo",avisoVis);
  if(avisoVis){
    const txt=await page.getByText(/de sobrante que reduciría la merma/).innerText();
    // 60,000 g × $0.13 = $7,800
    check("3. el aviso dice cuánto sería ($7,800)",/7,800/.test(txt),txt);
  }else check("3. el aviso dice cuánto sería ($7,800)",false);

  // ---- 2) Marcar línea base y cerrar ----
  await page.getByText("Éste es el conteo inicial (línea base)").click();
  await page.waitForTimeout(300);
  check("4. al marcarlo, el aviso desaparece",
    !(await page.getByText(/de sobrante que reduciría la merma/).isVisible().catch(()=>false)));
  await page.getByRole("button",{name:/Cerrar conteo/}).click();
  await page.waitForTimeout(1200);

  const invPollo=DB.inventario_sucursal.find(i=>i.id==="inv-pollo");
  check("5. la existencia SÍ queda en el físico (10,000 g)",parseFloat(invPollo.existencia)===10000,invPollo.existencia);
  const movs=DB.movimientos_sucursal.filter(m=>m.insumo_id==="ins-pollo");
  check("6. el movimiento SÍ se escribe (queda el rastro)",movs.length===1,movs.length);
  check("7. es entrada_ajuste de 60,000 g",
    movs[0]&&movs[0].tipo==="entrada_ajuste"&&parseFloat(movs[0].cantidad)===60000,movs[0]);
  check("8. la nota lo marca como línea base",/línea base/.test(movs[0]?.nota||""),movs[0]?.nota);
  check("9. la nota conserva el folio del conteo",/^CONT-\d{8}-\d+/.test(movs[0]?.nota||""),movs[0]?.nota);

  // ---- 3) El estado de resultados NO lo cuenta como merma ----
  await page.getByRole("button",{name:new RegExp("Finanzas")}).first().click();
  await page.getByRole("button",{name:"Estados financieros",exact:true}).click();
  await page.getByText(/Mermas/).first().waitFor({timeout:10000});
  const cuerpo1=await page.locator("body").innerText();
  check("10. el estado de resultados NO trae los $7,800 de sobrante",
    !/7,800/.test(cuerpo1),(cuerpo1.match(/.{0,40}7,800.{0,40}/)||[])[0]);

  // ---- 4) Un conteo NORMAL sí cuenta como merma ----
  // RES: teórico 2,000 g, físico 1,500 g → faltante de 500 g × $0.25 = $125
  await irAConteo();
  const cajas2=page.locator('input[placeholder="—"]');
  await cajas2.nth(1).fill("1500");
  await page.waitForTimeout(400);
  check("11. sin negativos capturados no aparece el aviso",
    !(await page.getByText(/de sobrante que reduciría la merma/).isVisible().catch(()=>false)));
  await page.getByRole("button",{name:/Cerrar conteo/}).click();
  await page.waitForTimeout(1200);
  const movRes=DB.movimientos_sucursal.find(m=>m.insumo_id==="ins-res");
  check("12. el faltante se registra como salida_ajuste",
    movRes&&movRes.tipo==="salida_ajuste"&&parseFloat(movRes.cantidad)===500,movRes);
  check("13. y NO lleva la marca de línea base",!/línea base/.test(movRes?.nota||""),movRes?.nota);

  await page.getByRole("button",{name:new RegExp("Finanzas")}).first().click();
  await page.getByRole("button",{name:"Estados financieros",exact:true}).click();
  await page.getByText(/Mermas/).first().waitFor({timeout:10000});
  const cuerpo2=await page.locator("body").innerText();
  check("14. el faltante normal SÍ llega a la merma del mes ($125)",
    /125\.00/.test(cuerpo2),(cuerpo2.match(/.{0,60}Merma.{0,80}/i)||[])[0]);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
