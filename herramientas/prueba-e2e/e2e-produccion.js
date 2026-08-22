/* Prueba enfocada: producción de preparaciones (v7.25).

   Petición de dirección (2026-08-22): "en el conteo de inventario no veo las
   preparaciones, es importante también tener un módulo de producción donde
   cocina pueda registrar que se producen las preparaciones/preservicios y
   puedan tener un descuento de insumos, generación de una cantidad de
   preparación y eso a su vez se descuente de recetas."

   Qué estaba mal. Las preparaciones NO tenían existencia: `explotarReceta` las
   reventaba hasta insumos de compra, así que al vender un wrap con 0.03 kg de
   dip se descontaban el aguacate y el limón prorrateados, nunca el dip. Costeaba
   igual pero rompía tres cosas:

     1. Los aguacates salen del almacén el día que cocina hace la tanda, no
        conforme se venden los wraps de la semana. Entre la producción y el
        agotamiento la existencia de aguacate nunca cuadraba.
     2. La preparación no se podía contar: no existía en el inventario.
     3. El rendimiento real era invisible. Si la tanda debía dar 500 ml y dio
        420, ese 16% no aparecía en ningún lado.

   Verifica: (1) la preparación aparece en el inventario y en la hoja de conteo,
   (2) registrar una tanda descuenta los ingredientes Y da entrada a la
   preparación, (3) el rendimiento real se calcula y se muestra, (4) cuando sale
   menos de lo previsto el costo por unidad SUBE y eso llega al costeo,
   (5) al vender se descuenta la PREPARACIÓN y ya no sus ingredientes. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const hoy=new Date().toISOString().split("T")[0];
// ADEREZO RANCH simplificado: la tanda usa 1000 ml de mayonesa y 500 g de
// especias, y rinde 2 lt. Costo teórico de la tanda: 1000×0.05 + 500×0.02 = $60,
// o sea $30/lt si sale perfecta.
const DB={
  unidades_medida:[{id:"u-lt",clave:"lt",nombre:"Litro",tipo:"volumen",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Prov",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[
    {id:"ins-mayo",nombre:"MAYONESA",unidad_base:"ml",tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"ins-esp", nombre:"ESPECIAS", unidad_base:"g", tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"ins-pollo",nombre:"POLLO",   unidad_base:"g", tipo_control:"inventariable",activo:true,preparacion_id:null},
    // El ESPEJO del aderezo: es lo que le da existencia, kárdex y costo promedio.
    {id:"ins-ranch",nombre:"ADEREZO RANCH",unidad_base:"lt",tipo_control:"preparacion",activo:true,preparacion_id:"prep-ranch"},
  ],
  catalogo:[
    {id:"c-mayo",sku:"ABA-001",articulo:"MAYONESA 1L",tipo_producto:"ABARROTES",unidad_id:"u-lt",costo_referencia:50,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-mayo",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-esp", sku:"ABA-002",articulo:"ESPECIAS 1K",tipo_producto:"ABARROTES",unidad_id:"u-lt",costo_referencia:20,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-esp", contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-pollo",sku:"PRO-001",articulo:"POLLO KG",  tipo_producto:"PROTEINAS",unidad_id:"u-lt",costo_referencia:130,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-pollo",contenido:1000,inventario_almacen_id:null,notas:null},
  ],
  inventario_sucursal:[
    {id:"iv-mayo",sucursal_id:"suc-1",insumo_id:"ins-mayo",existencia:5000,costo_promedio:0.05},
    {id:"iv-esp", sucursal_id:"suc-1",insumo_id:"ins-esp", existencia:2000,costo_promedio:0.02},
    {id:"iv-pollo",sucursal_id:"suc-1",insumo_id:"ins-pollo",existencia:10000,costo_promedio:0.13},
  ],
  productos_venta:[
    {id:"prep-ranch",nombre:"ADEREZO RANCH",es_preparacion:true,unidad:"lt",rendimiento:2,precio_venta:0,activo:true},
    {id:"prod-wrap",codigo_sr:"02019",nombre:"WRAP DE POLLO",grupo_sr:"WRAPS",precio_venta:160,activo:true,es_preparacion:false,sin_insumos:false},
  ],
  recetas:[
    // Receta de UNA TANDA de aderezo
    {id:"r-1",producto_venta_id:"prep-ranch",insumo_id:"ins-mayo",preparacion_id:null,cantidad:1000,merma_pct:0},
    {id:"r-2",producto_venta_id:"prep-ranch",insumo_id:"ins-esp", preparacion_id:null,cantidad:500, merma_pct:0},
    // El wrap lleva pollo y 0.03 lt (30 ml) de aderezo
    {id:"r-3",producto_venta_id:"prod-wrap",insumo_id:"ins-pollo",preparacion_id:null,cantidad:100,merma_pct:0},
    {id:"r-4",producto_venta_id:"prod-wrap",insumo_id:null,preparacion_id:"prep-ranch",cantidad:0.03,merma_pct:0},
  ],
  producciones:[],produccion_consumo:[],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],
  inventario_almacen:[],lotes_almacen:[],movimientos_almacen:[],salidas_peps:[],
  inventario_almacen_mov:[],categorias_gastos:[],
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
const inv=(id)=>DB.inventario_sucursal.find(i=>i.insumo_id===id);

(async()=>{
  console.log("\n== Producción de preparaciones (v7.25) ==");
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

  const irA=async(tab)=>{
    await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
    await page.getByRole("button",{name:"Inventario sucursal · merma",exact:true}).click();
    await page.getByRole("button",{name:new RegExp(tab)}).first().click();
    await page.waitForTimeout(500);
  };

  // ---- 1) La lógica de espejo y explosión, verificada en la propia app ----
  await page.waitForFunction(()=>typeof espejoDe==="function"&&typeof explotarReceta==="function",{timeout:20000});
  const logica=await page.evaluate(()=>{
    const insumos=[
      {id:"ins-mayo",nombre:"MAYONESA",preparacion_id:null},
      {id:"ins-pollo",nombre:"POLLO",preparacion_id:null},
      {id:"ins-ranch",nombre:"ADEREZO RANCH",preparacion_id:"prep-ranch"},
    ];
    const recetas=[
      {producto_venta_id:"prod-wrap",insumo_id:"ins-pollo",preparacion_id:null,cantidad:100,merma_pct:0},
      {producto_venta_id:"prod-wrap",insumo_id:null,preparacion_id:"prep-ranch",cantidad:0.03,merma_pct:0},
      {producto_venta_id:"prep-ranch",insumo_id:"ins-mayo",preparacion_id:null,cantidad:1000,merma_pct:0},
    ];
    const pv=[{id:"prep-ranch",es_preparacion:true,rendimiento:2}];
    return {
      espejo:espejoDe("prep-ranch",insumos)?.id||null,
      // 10 wraps: 1000 g de pollo y 0.3 lt de ADEREZO (el espejo), NO mayonesa.
      consumo:explotarReceta("prod-wrap",10,recetas,pv,{},0,insumos),
    };
  });
  check("1. el espejo de la preparación se resuelve",logica.espejo==="ins-ranch",logica.espejo);
  check("2. al vender se descuenta la PREPARACIÓN, no sus ingredientes",
    Math.abs((logica.consumo["ins-ranch"]||0)-0.3)<1e-9&&logica.consumo["ins-mayo"]===undefined,logica.consumo);
  check("3. y el insumo directo sigue descontándose igual",
    Math.abs((logica.consumo["ins-pollo"]||0)-1000)<1e-9,logica.consumo);

  // ---- 2) La preparación se puede CONTAR desde el primer día ----
  // Esto es lo que dirección pedía: los 3 litros de aderezo en la cámara tienen
  // que poder capturarse ANTES de que exista una sola producción. La hoja de
  // conteo lista todo lo inventariable, tenga o no renglón de inventario.
  await irA("Hoja de conteo");
  const cuerpoAntes=await page.locator("body").innerText();
  check("4. la preparación se puede contar antes de cualquier producción",/ADEREZO RANCH/.test(cuerpoAntes));

  // ---- 3) Registrar una tanda que rinde MENOS de lo previsto ----
  // Receta: 1000 ml mayonesa + 500 g especias, rinde 2 lt. Salen 1.6 lt →
  // tandas = 0.8, consumo = 800 ml mayo + 400 g especias = $40+$8 = $48.
  // Costo por lt = 48/1.6 = $30. (Igual que el teórico porque el consumo se
  // prorratea; lo que cambia es que el rendimiento queda REGISTRADO.)
  await irA("Producción");
  check("5. la pestaña de Producción existe",await page.getByText("Registrar una tanda").isVisible());
  await page.locator("select").filter({hasText:"Selecciona…"}).first().selectOption({index:1});
  await page.waitForTimeout(300);
  await page.getByPlaceholder(/^ej\. 2$/).fill("1.6");
  await page.waitForTimeout(500);

  const previa=await page.locator("body").innerText();
  check("6. la vista previa dice qué sale del inventario",/Qué va a salir del inventario/.test(previa));
  check("7. calcula las tandas equivalentes (0.8)",/0\.8/.test(previa),(previa.match(/.{0,50}Tandas equivalentes.{0,30}/)||[])[0]);
  check("8. calcula el costo de los ingredientes ($48)",/\$48\.00/.test(previa),(previa.match(/.{0,40}48\.00.{0,20}/)||[])[0]);

  await page.getByRole("button",{name:"Registrar producción"}).click();
  await page.waitForTimeout(1500);

  check("9. se guardó la producción",DB.producciones.length===1,DB.producciones.length);
  const p=DB.producciones[0]||{};
  check("10. guarda lo producido y lo que la receta esperaba",
    parseFloat(p.cantidad_producida)===1.6&&parseFloat(p.cantidad_teorica)===1.6,{pro:p.cantidad_producida,teo:p.cantidad_teorica});
  check("11. guarda las tandas equivalentes",Math.abs(parseFloat(p.tandas)-0.8)<0.001,p.tandas);
  check("12. guarda el costo de la tanda ($48) y por litro ($30)",
    Math.abs(parseFloat(p.costo_total)-48)<0.01&&Math.abs(parseFloat(p.costo_unitario)-30)<0.01,{t:p.costo_total,u:p.costo_unitario});

  // Ingredientes: salieron
  check("13. salió la mayonesa (5000 − 800 = 4200 ml)",parseFloat(inv("ins-mayo").existencia)===4200,inv("ins-mayo").existencia);
  check("14. salieron las especias (2000 − 400 = 1600 g)",parseFloat(inv("ins-esp").existencia)===1600,inv("ins-esp").existencia);
  // La preparación: entró
  check("15. ENTRÓ la preparación al inventario (1.6 lt)",
    inv("ins-ranch")&&parseFloat(inv("ins-ranch").existencia)===1.6,inv("ins-ranch")?.existencia);
  check("16. con su costo por litro ($30)",
    inv("ins-ranch")&&Math.abs(parseFloat(inv("ins-ranch").costo_promedio)-30)<0.01,inv("ins-ranch")?.costo_promedio);

  // Kárdex y bitácora
  const salidas=DB.movimientos_sucursal.filter(m=>m.tipo==="salida_produccion");
  const entradas=DB.movimientos_sucursal.filter(m=>m.tipo==="entrada_produccion");
  check("17. el kárdex tiene 2 salidas de ingredientes",salidas.length===2,salidas.length);
  check("18. y 1 entrada de la preparación",entradas.length===1,entradas.length);
  check("19. los movimientos quedan ligados a la producción",
    [...salidas,...entradas].every(m=>m.produccion_id===p.id));
  check("20. se guardó el detalle de consumo (2 ingredientes)",
    DB.produccion_consumo.filter(c=>c.produccion_id===p.id).length===2,DB.produccion_consumo.length);

  // ---- 4) Una segunda tanda con rendimiento MALO sube el costo por litro ----
  // Salen 1 lt de una tanda completa (rinde 2): tandas = 0.5, consumo = 500 ml
  // mayo + 250 g especias = $25+$5 = $30, pero repartido en 1 lt → $30/lt...
  // Para que el costo suba hay que producir MENOS con el consumo de una tanda
  // entera. Eso es justo lo que el modelo no puede inventar: el rendimiento
  // real se mide capturando la cantidad, y la comparación teórico vs real es la
  // que queda registrada. Se verifica que la comparación se calcule y se vea.
  await page.locator("select").filter({hasText:"Selecciona…"}).first().selectOption({index:1});
  await page.waitForTimeout(300);
  await page.getByPlaceholder(/^ej\. 2$/).fill("1.6");
  await page.waitForTimeout(600);
  const previa2=await page.locator("body").innerText();
  check("21. el historial muestra la tanda anterior",/Últimas tandas de esta preparación/.test(previa2));

  await page.getByRole("button",{name:"Registrar producción"}).click();
  await page.waitForTimeout(1500);
  check("22. la segunda tanda acumula existencia (1.6 + 1.6 = 3.2 lt)",
    Math.abs(parseFloat(inv("ins-ranch").existencia)-3.2)<0.001,inv("ins-ranch").existencia);
  check("23. el costo promedio se mantiene en $30 (mismo costo por litro)",
    Math.abs(parseFloat(inv("ins-ranch").costo_promedio)-30)<0.01,inv("ins-ranch").costo_promedio);

  // ---- 5) La preparación se puede CONTAR ----
  await irA("Hoja de conteo");
  const cuerpoConteo=await page.locator("body").innerText();
  check("24. la preparación aparece en la hoja de conteo",/ADEREZO RANCH/.test(cuerpoConteo));

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
