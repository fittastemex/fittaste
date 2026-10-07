/* Prueba enfocada: la app deja de machacar lo que otro cambió (v7.34).

   EL INCIDENTE QUE LA ORIGINA, con hora exacta.

     11-sep        el conteo inicial capturó 7,000 lt de SALSA VERDE (eran ~7).
     03-oct 17:03  se corrigió a 7 lt desde la base de datos.
     03-oct 17:05  cocina registró una producción de 9 lt desde la app.
                   Su copia en memoria llevaba horas diciendo 7,000, así que
                   escribió 7,009 y BORRÓ la corrección.
                   Como el costo previo era 0, la regla del promedio ponderado
                   le puso a esos 7,009 litros fantasma el costo de la tanda
                   ($20.99) → aparecieron $147,138 de valor inexistente.
     04-oct        el conteo los quitó y los reportó como merma.

   De las 11 preparaciones corregidas ese día, fallaron EXACTAMENTE las dos que
   tuvieron una producción en los minutos siguientes. Las otras nueve cerraron
   con diferencias de gramos. Eso es lo que señala la causa.

   LA CAUSA. `entradaSucursalDB` y las salidas de producción y merma calculaban
   `existencia nueva = existencia EN MEMORIA ± cantidad` y guardaban el TOTAL.
   Todo lo que hubiera cambiado en la base desde que se abrió la app se perdía.
   No hace falta SQL para dispararlo: cocina recibiendo mientras dirección
   produce basta.

   QUÉ VERIFICA. Que al escribir existencia se relea la fila de la base primero.
   La prueba cambia la base A ESPALDAS de la app —igual que la corrección del
   3-oct— y comprueba que la siguiente escritura parta del valor nuevo y no del
   que la app traía cargado.

   LO QUE NO VERIFICA, y conviene no fingir: esto no vuelve la escritura
   atómica. Dos escrituras en el mismo milisegundo siguen pudiendo pisarse. El
   arreglo completo es que la suma ocurra en la base. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-lt",clave:"lt",nombre:"Litro",tipo:"volumen",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Prov",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[
    {id:"ins-tom",nombre:"TOMATE VERDE",unidad_base:"g",tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"ins-chi",nombre:"CHILE",unidad_base:"g",tipo_control:"inventariable",activo:true,preparacion_id:null},
    // El espejo de la salsa: es lo que lleva existencia y costo promedio.
    {id:"ins-salsa",nombre:"SALSA VERDE",unidad_base:"lt",tipo_control:"preparacion",activo:true,preparacion_id:"prep-salsa"},
  ],
  catalogo:[
    {id:"c-tom",sku:"VER-001",articulo:"TOMATE VERDE KG",tipo_producto:"VERDURAS",unidad_id:"u-lt",costo_referencia:30,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-tom",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-chi",sku:"VER-002",articulo:"CHILE KG",tipo_producto:"VERDURAS",unidad_id:"u-lt",costo_referencia:60,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-chi",contenido:1000,inventario_almacen_id:null,notas:null},
  ],
  inventario_sucursal:[
    {id:"iv-tom",sucursal_id:"suc-1",insumo_id:"ins-tom",existencia:50000,costo_promedio:0.03},
    {id:"iv-chi",sucursal_id:"suc-1",insumo_id:"ins-chi",existencia:20000,costo_promedio:0.06},
    // EL FANTASMA: 7,000 lt de salsa verde a costo CERO, igual que el 11-sep.
    {id:"iv-salsa",sucursal_id:"suc-1",insumo_id:"ins-salsa",existencia:7000,costo_promedio:0},
  ],
  productos_venta:[
    {id:"prep-salsa",nombre:"SALSA VERDE",es_preparacion:true,unidad:"lt",rendimiento:6.7,precio_venta:0,activo:true},
  ],
  recetas:[
    {id:"r-1",producto_venta_id:"prep-salsa",insumo_id:"ins-tom",preparacion_id:null,cantidad:4000,merma_pct:0},
    {id:"r-2",producto_venta_id:"prep-salsa",insumo_id:"ins-chi",preparacion_id:null,cantidad:500,merma_pct:0},
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
  console.log("\n== La app deja de machacar lo que otro cambió (v7.34) ==");
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

  // La app ya cargó las 7,000 lt fantasma en memoria. Esto reproduce el estado
  // de la app de cocina el 3-oct: abierta desde antes de la corrección.
  check("1. la app arrancó con el fantasma cargado (7,000 lt)",
        parseFloat(inv("ins-salsa").existencia)===7000,inv("ins-salsa").existencia);

  // ============ LA CORRECCIÓN, A ESPALDAS DE LA APP ============
  // Esto es exactamente lo que pasó a las 17:03: alguien corrige la base
  // mientras la app sigue abierta con el valor viejo.
  inv("ins-salsa").existencia=7;
  check("2. la base queda corregida en 7 lt",parseFloat(inv("ins-salsa").existencia)===7);

  // ============ LA PRODUCCIÓN, DOS MINUTOS DESPUÉS ============
  const irA=async(tab)=>{
    await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
    await page.getByRole("button",{name:"Inventario sucursal · merma",exact:true}).click();
    await page.getByRole("button",{name:new RegExp(tab)}).first().click();
    await page.waitForTimeout(500);
  };
  await irA("Producción");
  await page.locator("select").filter({hasText:"Selecciona…"}).first().selectOption({index:1});
  await page.waitForTimeout(400);
  await page.getByPlaceholder(/^ej\. /).fill("9");
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:"Registrar producción"}).click();
  await page.waitForTimeout(1500);

  const salsa=inv("ins-salsa");
  const exist=parseFloat(salsa.existencia);

  // EL CORAZÓN DE LA PRUEBA. Antes de v7.34 esto daba 7,009: la app sumaba
  // sobre las 7,000 que traía en memoria y borraba la corrección.
  check("3. la producción suma sobre lo que hay en la BASE (7+9=16), no sobre lo que la app recordaba",
        Math.abs(exist-16)<0.001,exist);
  check("4. y NO resucita el fantasma de 7,009 lt",exist<100,exist);

  // El daño económico del incidente venía de aquí: con costo previo 0, el
  // promedio ponderado toma el costo entrante y se lo aplica a TODA la
  // existencia. Sobre 7,009 lt eso eran $147,138 de valor inventado.
  const valor=exist*parseFloat(salsa.costo_promedio);
  check("5. el valor de la salsa queda en cientos, no en cientos de miles",
        valor<10000,Math.round(valor));

  // La salida de ingredientes también leía de memoria. Aquí no había
  // desincronización, pero la ruta tiene que seguir cuadrando.
  check("6. los ingredientes salieron del inventario (tomate)",
        Math.abs(parseFloat(inv("ins-tom").existencia)-(50000-4000/6.7*9))<2,inv("ins-tom").existencia);

  // ============ LA SEGUNDA MITAD: UNA SALIDA ============
  // Mismo patrón, en sentido contrario. Alguien corrige la base hacia abajo y
  // la app registra una merma con su copia vieja.
  inv("ins-tom").existencia=1000;
  await irA("Registrar merma");
  await page.waitForTimeout(400);
  await page.locator("select").filter({hasText:"Seleccionar..."}).first().selectOption("ins-tom");
  await page.waitForTimeout(300);
  await page.locator('input[type="number"]').first().fill("100");
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:"Registrar merma"}).nth(1).click();
  await page.waitForTimeout(1500);
  const tom=parseFloat(inv("ins-tom").existencia);
  check("7. la merma resta sobre el valor FRESCO de la base (1000−100=900)",
        Math.abs(tom-900)<1,tom);
  check("8. y no sobre los 50,000 que la app traía cargados",tom<5000,tom);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
