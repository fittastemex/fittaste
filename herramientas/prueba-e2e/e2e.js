/* Prueba E2E del flujo completo FitTaste v7.2 con Supabase simulado */
const fs=require("fs");
const {chromium}=require("playwright");

// ---------- Base de datos simulada (emula PostgREST) ----------
let genN=0;
const DB={
  unidades_medida:[
    {id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true},
    {id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true},
    {id:"u-lt",clave:"lt",nombre:"Litro",tipo:"volumen",activa:true},
  ],
  tipos_flujo_costo:[{id:"tf-manual",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Proveedor Prueba",tipo_flujo_id:"tf-manual",activo:true}],
  insumos:[
    {id:"ins-crema",nombre:"CREMA",unidad_base:"ml",tipo_control:"inventariable",categoria_gasto:null,activo:true},
    {id:"ins-pollo",nombre:"PECHUGA DE POLLO",unidad_base:"kg",tipo_control:"inventariable",categoria_gasto:null,activo:true},
    {id:"ins-jitomate",nombre:"JITOMATE",unidad_base:"kg",tipo_control:"inventariable",categoria_gasto:null,activo:true},
    {id:"ins-jabon",nombre:"JABON TRASTES",unidad_base:"pz",tipo_control:"gasto",categoria_gasto:"Limpieza",activo:true},
  ],
  catalogo:[
    {id:"cat-crema",sku:"ABA-001",articulo:"CREMA LALA 900ML",tipo_producto:"ABARROTES",unidad_id:"u-pz",costo_referencia:58,proveedor_id:"prov-1",aplica_iva:true,activo:true,insumo_id:"ins-crema",contenido:900,inventario_almacen_id:null,notas:null},
    {id:"cat-pollo",sku:"PRO-001",articulo:"PECHUGA DE POLLO",tipo_producto:"PROTEINAS",unidad_id:"u-kg",costo_referencia:145,proveedor_id:"prov-1",aplica_iva:true,activo:true,insumo_id:"ins-pollo",contenido:1,inventario_almacen_id:null,notas:null},
    {id:"cat-jitomate",sku:"VER-001",articulo:"JITOMATE",tipo_producto:"VERDURA",unidad_id:"u-kg",costo_referencia:30,proveedor_id:"prov-1",aplica_iva:true,activo:true,insumo_id:"ins-jitomate",contenido:1,inventario_almacen_id:null,notas:null},
    {id:"cat-jabon",sku:"LIM-001",articulo:"JABON TRASTES",tipo_producto:"LIMPIEZA",unidad_id:"u-pz",costo_referencia:45,proveedor_id:"prov-1",aplica_iva:true,activo:true,insumo_id:"ins-jabon",contenido:1,inventario_almacen_id:null,notas:null},
    {id:"cat-ver-del",sku:"VER-002",articulo:"CILANTRO (BORRADO)",tipo_producto:"VERDURA",unidad_id:"u-kg",costo_referencia:20,proveedor_id:"prov-1",aplica_iva:true,activo:false,insumo_id:null,contenido:1,inventario_almacen_id:null,notas:null},
  ],
  categorias_gastos:[{id:"cg-1",nombre:"Limpieza",activa:true}],
  inventario_almacen:[],lotes_almacen:[],movimientos_almacen:[],pedidos:[],pedido_detalle:[],
  pedido_proveedor_estatus:[],pedido_reasignaciones:[],recepciones:[],recepcion_detalle:[],
  cuentas_por_pagar:[],pagos:[],compras_directas:[],gastos_operativos:[],
  productos_venta:[],recetas:[],inventario_sucursal:[],
  // v7.14: venta vieja del conector (origen 'api') para verificar el aviso de
  // "conector callado". Va en 2020 a propósito: queda fuera de todos los
  // periodos del dashboard, así que no altera los KPIs del día ni del mes.
  ventas:[{id:"v-api-vieja",sucursal_id:"suc-1",fecha:"2020-01-01",folio:"TKT-VIEJO",origen:"api",canal:"mostrador",subtotal:0,iva:0,total:0,total_efectivo:0,total_tarjeta:0,total_plataforma:0,total_otros:0,costo_teorico:0,created_at:"2020-01-01T12:00:00.000Z"}],
  venta_detalle:[],mermas:[],movimientos_sucursal:[],
};
const DEFAULTS={
  productos_venta:{precio_venta:0,aplica_iva:true,activo:true,es_preparacion:false,rendimiento:1,unidad:null,categoria:null,codigo_sr:null},
  insumos:{unidad_base:"pz",tipo_control:"inventariable",activo:true,categoria_gasto:null},
  recetas:{merma_pct:0,cantidad:0,insumo_id:null,preparacion_id:null},
  inventario_sucursal:{existencia:0,costo_promedio:0,minimo_stock:0},
  pedidos:{estatus:"creado",total_teorico:0,total_real:0},
  pedido_detalle:{costo_real:null},
  pedido_proveedor_estatus:{estatus:"pendiente",token_activo:true},
  cuentas_por_pagar:{monto_pagado:0,estatus:"pendiente"},
};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq.")){if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")){const list=v.slice(4,-1).split(",");if(!list.includes(String(row[k])))return false;}
    else if(v.startsWith("like.")){let pat=v.slice(5).replace(/[.+?^${}()|[\]\\]/g,"\\$&").replace(/[*%]/g,".*");const re=new RegExp("^"+pat+"$","i");if(!re.test(String(row[k]==null?"":row[k])))return false;}
    else if(v==="not.is.null"){if(row[k]==null)return false;}
  }
  return true;
}
function handleRest(method,table,search,body){
  if(!(table in DB))return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  const params=[...new URLSearchParams(search).entries()];
  const limit=params.find(p=>p[0]==="limit");
  if(method==="GET"){
    let rows=DB[table].filter(r=>matchFilters(r,params));
    if(limit)rows=rows.slice(0,parseInt(limit[1]));
    return{status:200,body:JSON.stringify(rows)};
  }
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    // Emula UNIQUE(sku) del catálogo (incluye filas inactivas)
    if(table==="catalogo"){for(const r of arr){if(r.sku&&DB.catalogo.some(x=>x.sku===r.sku))return{status:409,body:JSON.stringify({code:"23505",message:'duplicate key value violates unique constraint "catalogo_sku_key"',details:`Key (sku)=(${r.sku}) already exists.`})};}}
    const inserted=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);if(!row.created_at)row.created_at=new Date().toISOString();DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(inserted)};
  }
  if(method==="PATCH"){
    const updated=[];
    DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};updated.push(nr);return nr;}return r;});
    return{status:200,body:JSON.stringify(updated)};
  }
  if(method==="DELETE"){
    DB[table]=DB[table].filter(r=>!matchFilters(r,params));
    return{status:204,body:""};
  }
  return{status:405,body:"{}"};
}

// ---------- Utilidades de prueba ----------
const results=[];
function check(name,cond,extra){results.push({name,ok:!!cond,extra});console.log((cond?"  ✓ ":"  ✗ ")+name+(cond?"":(extra!==undefined?`  [obtenido: ${JSON.stringify(extra)}]`:"")));}
const approx=(a,b,tol=0.02)=>Math.abs(a-b)<=tol;

(async()=>{
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  const dialogs=[];
  page.on("dialog",async d=>{dialogs.push(d.message());await d.accept();});
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));

  await page.route("**/*",async route=>{
    const url=route.request().url();
    const m=route.request().method();
    if(url.startsWith("http://fittaste.local/")) return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html});
    if(url.includes("react-dom")) return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react-dom/umd/react-dom.production.min.js","utf8")});
    if(url.includes("/react@")) return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react/umd/react.production.min.js","utf8")});
    if(url.includes("babel")) return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/@babel/standalone/babel.min.js","utf8")});
    if(url.includes("cdn.tailwindcss.com")) return route.fulfill({status:200,contentType:"application/javascript",body:"window.tailwind={config:{}};"});
    if(url.includes("fonts.googleapis")) return route.fulfill({status:200,contentType:"text/css",body:""});
    const rest=url.match(/supabase\.co\/rest\/v1\/([a-z_]+)(\?(.*))?$/);
    if(rest){
      let body=null;
      try{body=route.request().postData()?JSON.parse(route.request().postData()):null;}catch(e){}
      const res=handleRest(m,rest[1],rest[3]||"",body);
      return route.fulfill({status:res.status,contentType:"application/json",body:res.body});
    }
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  console.log("\n== P: Carga y login admin ==");
  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Admin / Dueño").click();
  await page.locator("input[type=password]").fill("fittaste2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});
  check("P: la app carga y entra como admin",true);
  // v7.4: navegación por menú agrupado (grupo desplegable → opción)
  const menu=async(grupo,item)=>{
    await page.getByRole("button",{name:new RegExp(grupo)}).first().click();
    const it=page.getByRole("button",{name:item,exact:true});
    try{await it.waitFor({timeout:1500});await it.click();}catch(e){/* grupo de 1 opción: es botón directo y el clic ya navegó */}
    await page.waitForTimeout(250);
  };
  await page.getByRole("heading",{name:"Dashboard de ventas"}).waitFor();
  check("P: admin aterriza en el Dashboard de ventas (menú v7.4)",true);

  console.log("\n== Parte 2: Pedido con conversión ==");
  await menu("Compras","Pedidos");
  await page.getByRole("button",{name:"+ Nuevo pedido"}).first().click();
  await page.getByPlaceholder("Buscar insumo...").waitFor();
  const fila=(t)=>page.locator("tbody tr",{hasText:t});
  await fila("CREMA").locator("input[type=number]").fill("5000");
  const filaCremaTxt=await fila("CREMA").innerText();
  check("2.1 conversión: 5000 ml → '6 pz'",filaCremaTxt.includes("6 pz"),filaCremaTxt);
  check("2.1 conversión muestra '= 5,400 ml'",filaCremaTxt.includes("5,400 ml"),filaCremaTxt);
  check("2.1 conversión muestra excedente '+400 ml'",filaCremaTxt.includes("+400 ml"),filaCremaTxt);
  await fila("PECHUGA DE POLLO").locator("input[type=number]").fill("10");
  await fila("JITOMATE").locator("input[type=number]").fill("6");
  await fila("JABON").locator("input[type=number]").fill("2");
  const filaJabonTxt=await fila("JABON").innerText();
  check("2.2 jabón marcado como 'gasto'",filaJabonTxt.includes("gasto"),filaJabonTxt);
  check("2.2 granel (pollo) sin redondeo: '10 kg'",(await fila("PECHUGA DE POLLO").innerText()).includes("10 kg"));
  await page.getByRole("button",{name:/Enviar pedido/}).click();
  await page.waitForTimeout(500);
  check("2.2 pedido creado (alerta con folio PED-)",dialogs.some(d=>d.includes("PED-")),dialogs);
  check("2.2 pedido_detalle: crema guardada como 6 unidades de presentación",DB.pedido_detalle.some(d=>d.catalogo_id==="cat-crema"&&d.cantidad===6),DB.pedido_detalle.map(d=>[d.catalogo_id,d.cantidad]));

  console.log("\n== Parte 2b: Compras captura precios y compra ==");
  await page.locator("button",{hasText:/^Pedido PED-/}).first().click();
  await page.getByText("Volver a bandeja").waitFor();
  const precio=async(t,v)=>{await page.locator("tr",{hasText:t}).locator("input[type=number]").nth(1).fill(String(v));};
  await precio("CREMA LALA",58);await precio("PECHUGA",140);await precio("JITOMATE",30);await precio("JABON",45);
  await page.getByRole("button",{name:"Cerrar compra"}).click();
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:/Pedido comprado/}).click();
  await page.waitForTimeout(400);
  check("2.3 pedido marcado comprado",DB.pedidos[0]?.estatus==="comprado",DB.pedidos[0]?.estatus);

  console.log("\n== Parte 3: Recepción → inventario sucursal ==");
  await page.getByRole("button",{name:"Salir"}).click();
  await page.getByText("Selecciona tu rol").waitFor();
  await page.getByText("Crea pedidos").click();
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await menu("Compras","Recepción");
  await page.getByRole("button",{name:"Recibir mercancía"}).click();
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(800);
  const invCrema=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-crema");
  check("3.2 crema entra convertida: 5,400 ml",invCrema&&invCrema.existencia===5400,invCrema);
  check("3.2 costo por ml correcto ($58/900=0.0644)",invCrema&&approx(invCrema.costo_promedio,0.0644,0.0001),invCrema?.costo_promedio);
  check("3.2 jabón NO entra a inventario (es gasto)",!DB.inventario_sucursal.some(i=>i.insumo_id==="ins-jabon"));
  const gastoJabon=DB.gastos_operativos.find(g=>g.categoria==="Limpieza");
  check("3.2 jabón registrado como gasto Limpieza $90",gastoJabon&&approx(gastoJabon.monto,90),gastoJabon);
  check("3.2 kárdex: 3 entradas por recepción",DB.movimientos_sucursal.filter(m=>m.tipo==="entrada_recepcion").length===3,DB.movimientos_sucursal.length);
  check("3.3 pedido auto-cerrado y CxP generada",DB.pedidos[0]?.estatus==="cerrado"&&DB.cuentas_por_pagar.length===1,{est:DB.pedidos[0]?.estatus,cxp:DB.cuentas_por_pagar.length});
  const cxpMonto=parseFloat(DB.cuentas_por_pagar[0]?.monto_total||0);
  check("3.3 CxP con IVA: $2,340.88",approx(cxpMonto,2340.88,0.05),cxpMonto);

  console.log("\n== Parte 4: Preparación y receta ==");
  // v7.6: 'Productos y recetas' vive ahora en el grupo Catálogos y abre directo en esa pestaña
  await menu("Catálogos","Productos y recetas");
  await page.getByRole("button",{name:/Platillos \(/}).waitFor();
  check("4.0 'Productos y recetas' accesible desde Catálogos (menú v7.6)",true);
  await page.getByRole("button",{name:/Preparaciones \(/}).click();
  await page.getByRole("button",{name:"+ Nueva preparación"}).click();
  await page.getByPlaceholder("SALSA DE LA CASA").fill("SALSA DE PRUEBA");
  await page.getByPlaceholder("ej. 2.5").fill("2");
  await page.getByRole("button",{name:"Crear y armar receta"}).click();
  await page.getByText("Receta de SALSA DE PRUEBA").waitFor();
  const addRow=page.locator("div.flex.gap-2.items-end").filter({hasText:"Agregar ingrediente"});
  // v7.6: el ingrediente se elige con combobox (escribir → clic en la opción filtrada)
  const addLinea=async(texto,cant)=>{
    const buscador=addRow.locator("input").first();
    await buscador.click();await buscador.fill(texto);
    await addRow.getByRole("button",{name:new RegExp("^"+texto)}).first().click();
    await addRow.locator("input[type=number]").nth(0).fill(String(cant));
    await addRow.getByRole("button",{name:"Agregar",exact:true}).click();await page.waitForTimeout(300);
  };
  await addLinea("JITOMATE",1.5);
  await addLinea("CREMA",500);
  const prep=DB.productos_venta.find(p=>p.nombre==="SALSA DE PRUEBA");
  check("4.1 preparación creada con rendimiento 2",prep&&parseFloat(prep.rendimiento)===2&&prep.es_preparacion===true,prep);
  check("4.1 receta de la tanda: 2 ingredientes",DB.recetas.filter(r=>r.producto_venta_id===prep?.id).length===2);
  const tandaTxt=await page.getByText("Costo de la tanda").innerText();
  check("4.1 costo por kg de salsa = $38.61 (precision completa)",tandaTxt.includes("38.61"),tandaTxt);

  await page.getByRole("button",{name:/Platillos \(/}).click();
  await page.getByRole("button",{name:"+ Nuevo producto"}).click();
  await page.getByPlaceholder("BOWL01").fill("BOWL01");
  await page.getByPlaceholder("Como aparece en SoftRestaurant").fill("BOWL DE PRUEBA");
  const formProd=page.locator("div").filter({hasText:/^Nuevo producto de venta/}).last();
  await formProd.locator("input[type=number]").fill("129");
  await page.getByRole("button",{name:"Guardar"}).click();
  await page.waitForTimeout(300);
  await page.getByRole("button",{name:"+ Crear receta"}).click();
  await page.getByText("Receta de BOWL DE PRUEBA").waitFor();
  await addLinea("PECHUGA",0.18);
  await addLinea("CREMA",30);
  await addLinea("SALSA DE PRUEBA",0.05);
  const bowl=DB.productos_venta.find(p=>p.nombre==="BOWL DE PRUEBA");
  check("4.2 platillo con receta de 3 líneas (2 insumos + 1 prep)",DB.recetas.filter(r=>r.producto_venta_id===bowl?.id).length===3);
  const recetaTxt=await page.getByText("Costo total receta").innerText();
  check("4.2 costo receta bowl = $29.06",recetaTxt.includes("29.06"),recetaTxt);
  const margenTxt=await page.locator("tr",{hasText:"BOWL DE PRUEBA"}).first().innerText();
  check("4.2 margen bruto mostrado (~74%)",/7[34]%/.test(margenTxt),margenTxt);

  console.log("\n== Parte 5: Importar venta SR ==");
  await page.getByRole("button",{name:"Importar de SR"}).click();
  await page.locator("textarea").fill("Clave\tDescripción\tCantidad\tImporte\nBOWL01\tBOWL DE PRUEBA\t10\t1290.00\nJUGO99\tJUGO DE PRUEBA\t4\t220.00");
  const pagoInput=(lbl)=>page.locator("div").filter({hasText:new RegExp("^"+lbl)}).last().locator("input");
  await pagoInput("Efectivo").fill("710");
  await pagoInput("Tarjeta \\(terminal\\)").fill("800");
  await page.waitForTimeout(300);
  const previewTxt=await page.locator("div.mb-3",{hasText:"productos nuevos"}).first().innerText().catch(()=>"(sin preview)");
  check("5.1 preview: 2 productos, $1,510, 1 nuevo",previewTxt.includes("2 productos")&&previewTxt.includes("1,510")&&previewTxt.includes("1 productos nuevos"),previewTxt);
  await page.getByRole("button",{name:/Importar 2 productos/}).click();
  await page.waitForTimeout(1200);
  check("5.2 alerta de venta importada",dialogs.some(d=>d.includes("importada")),dialogs.slice(-2));
  // La importación manual guarda origen 'importado_sr'; el fixture trae además
  // una venta vieja del conector ('api'), así que hay que elegir la correcta.
  const venta=DB.ventas.find(v=>v.origen==="importado_sr");
  check("5.2 venta guardada: total $1,510",venta&&approx(parseFloat(venta.total),1510),venta?.total);
  check("5.2 subtotal sin IVA $1,301.72",venta&&approx(parseFloat(venta.subtotal),1301.72),venta?.subtotal);
  check("5.2 formas de pago 710/800",venta&&venta.total_efectivo===710&&venta.total_tarjeta===800,[venta?.total_efectivo,venta?.total_tarjeta]);
  check("5.2 costo teórico $290.62 (incluye sub-receta)",venta&&approx(parseFloat(venta.costo_teorico),290.62,0.05),venta?.costo_teorico);
  check("5.2 detalle: 2 líneas y JUGO99 auto-creado",DB.venta_detalle.length===2&&DB.productos_venta.some(p=>p.codigo_sr==="JUGO99"));
  const exCrema=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-crema")?.existencia;
  const exPollo=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-pollo")?.existencia;
  const exJit=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-jitomate")?.existencia;
  check("5.3 crema descontada en cascada: 5400−425 = 4,975 ml",approx(exCrema,4975,0.01),exCrema);
  check("5.3 pollo descontado: 10−1.8 = 8.2 kg",approx(exPollo,8.2,0.001),exPollo);
  check("5.3 jitomate descontado vía sub-receta: 6−0.375 = 5.625 kg",approx(exJit,5.625,0.001),exJit);
  check("5.3 kárdex: 3 salidas por venta",DB.movimientos_sucursal.filter(m=>m.tipo==="salida_venta").length===3);

  console.log("\n== Parte 5b: marca 'no consume insumos' (v7.5) ==");
  check("5b.1 alarma roja: JUGO vendido sin receta",await page.getByText(/con ventas SIN receta/).isVisible());
  await page.getByRole("button",{name:/Productos y recetas/}).click();
  await page.locator("tr",{hasText:"JUGO DE PRUEBA"}).getByRole("button",{name:"no consume",exact:true}).click();
  await page.waitForTimeout(500);
  check("5b.2 marcar 'no consume' apaga la alarma",!(await page.getByText(/con ventas SIN receta/).isVisible()));
  check("5b.3 sin_insumos guardado en BD",DB.productos_venta.find(p=>p.codigo_sr==="JUGO99")?.sin_insumos===true);

  console.log("\n== Parte 6: Merma ==");
  await menu("Almacén","Inventario sucursal · merma");
  await page.getByRole("button",{name:"Registrar merma"}).first().click();
  const mermaCard=page.locator("div",{hasText:/^Registrar merma/}).last();
  await mermaCard.locator("select").first().selectOption("ins-crema");
  await mermaCard.locator("input[type=number]").fill("200");
  await mermaCard.getByRole("button",{name:"Registrar merma"}).click();
  await page.waitForTimeout(600);
  const merma=DB.mermas[0];
  check("6.1 merma registrada: 200 ml = $12.89",merma&&approx(parseFloat(merma.costo_total),12.89,0.005),merma?.costo_total);
  check("6.1 existencia crema tras merma: 4,775 ml",approx(DB.inventario_sucursal.find(i=>i.insumo_id==="ins-crema")?.existencia,4775,0.01));

  console.log("\n== Parte 6c: Hoja de conteo físico (v7.7) ==");
  await page.getByRole("button",{name:"Hoja de conteo"}).click();
  await page.waitForTimeout(200);
  // Pollo teórico 8.2 kg → físico 8.0 kg = faltante 0.2 kg × $145 = $29.00
  await fila("PECHUGA DE POLLO").locator("input[type=number]").fill("8");
  await page.waitForTimeout(200);
  const conteoBody=await page.locator("body").innerText();
  check("6c.1 diferencia en vivo del pollo: −0.2 kg",/−0\.2 kg|-0\.2 kg/.test(conteoBody),null);
  check("6c.2 $ faltante en vivo $28.00 visible (0.2kg × $140)",conteoBody.includes("28.00"),null);
  await page.getByRole("button",{name:/Cerrar conteo/}).click();
  await page.waitForTimeout(600);
  const ajuste=DB.movimientos_sucursal.find(m=>m.tipo==="salida_ajuste"&&(m.nota||"").startsWith("CONT-"));
  check("6c.3 movimiento salida_ajuste con folio CONT- creado",!!ajuste,ajuste?.nota);
  check("6c.4 ajuste registra 0.2 kg de faltante",ajuste&&approx(parseFloat(ajuste.cantidad),0.2,0.001),ajuste?.cantidad);
  check("6c.5 existencia pollo actualizada al físico: 8 kg",approx(DB.inventario_sucursal.find(i=>i.insumo_id==="ins-pollo")?.existencia,8,0.001));
  const cierreBody=await page.locator("body").innerText();
  check("6c.6 resumen de cierre muestra 'Conteo cerrado'",cierreBody.includes("Conteo cerrado"),null);
  check("6c.7 historial de conteos anteriores visible",cierreBody.includes("Conteos anteriores"),null);

  console.log("\n== Parte 6b: Dashboard de ventas (v7.4) ==");
  await menu("Ventas","Dashboard de ventas");
  await page.getByRole("heading",{name:"Dashboard de ventas"}).waitFor();
  const dashTxt=await page.locator("body").innerText();
  check("6b.1 KPI venta total del día: $1,510",dashTxt.includes("1,510.00"),null);
  check("6b.2 KPI IVA cobrado: $208.28",dashTxt.includes("208.28"),null);
  const numDash=(re)=>{const m=dashTxt.match(re);return m?parseFloat(m[1].replace(/,/g,"")):null;};
  const costoMPDash=numDash(/Costo materia prima[^$]*\$([\d,.]+)/);
  const utilDash=numDash(/Utilidad bruta[^$]*\$([\d,.]+)/);
  check("6b.3 KPI costo MP teórico ≈ $290.62",approx(costoMPDash,290.62,0.05),costoMPDash);
  check("6b.4 utilidad bruta ≈ $1,219.38 (venta − costo MP)",approx(utilDash,1219.38,0.05),utilDash);
  check("6b.5 mix y formas de pago visibles",dashTxt.includes("Mix de venta")&&dashTxt.includes("Formas de pago"),null);
  check("6b.6 top productos: BOWL DE PRUEBA listado",dashTxt.includes("Top 10 productos")&&dashTxt.includes("BOWL DE PRUEBA"),null);
  // v7.14: la última venta del conector es de 2020 → el aviso debe salir y decir "días"
  check("6b.7 avisa que el conector no sube ventas",dashTxt.includes("El conector de SoftRestaurant no ha subido ventas"),null);
  check("6b.8 el aviso cuantifica la antigüedad en días",/no ha subido ventas en \d+ días/.test(dashTxt),dashTxt.match(/no ha subido ventas en [^\n]*/)?.[0]);
  check("6b.9 el aviso dice que los tickets no se pierden",dashTxt.includes("no se pierden"),null);
  if(process.env.E2E_SHOT)await page.screenshot({path:process.env.E2E_SHOT,fullPage:true});

  console.log("\n== Parte 7: Estados financieros ==");
  await page.getByRole("button",{name:"Salir"}).click();
  await page.getByText("Selecciona tu rol").waitFor();
  await page.getByText("Cuentas por pagar").click();
  await page.locator("input[type=password]").fill("finanzas2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await menu("Finanzas","Estados financieros");
  await page.getByText("Estado de resultados").waitFor();
  const body=await page.locator("body").innerText();
  check("7.1 ventas netas $1,301.72 en estado de resultados",body.includes("1,301.72"),null);
  check("7.1 flujo: efectivo $710 y tarjeta $800",body.includes("710.00")&&body.includes("800.00"));
  check("7.1 merma registrada visible ($12.89)",body.includes("12.89"));
  check("7.1 food cost ~22.3%",/22\.[0-9]%/.test(body));
  check("7.1 CxP pendiente en posición ($2,340.88)",body.includes("2,340.88"));
  // v7.7: resumen mensual de 3 líneas + integración de conteo en mermas
  check("7.2 resumen del mes: 3 bloques (Costos / Gastos / Mermas)",body.includes("Costos (materia prima)")&&body.includes("Gastos del mes")&&body.includes("Mermas del mes"),null);
  check("7.2 faltante de conteo físico integrado a merma",/[Ff]altantes de conteo f[íi]sico/.test(body),null);
  check("7.2 merma total del mes = registrada + conteo ($40.89)",body.includes("40.89"),null);

  console.log("\n== Parte 8: Popup unificado insumo + presentación (v7.8) ==");
  await page.getByRole("button",{name:"Salir"}).click();
  await page.getByText("Selecciona tu rol").waitFor();
  await page.getByText("Admin / Dueño").click();
  await page.locator("input[type=password]").fill("fittaste2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor();
  await menu("Catálogos","Catálogo e insumos");
  const insumosAntes=DB.insumos.length;
  // --- Modo INSUMO NUEVO (desde el mismo botón) ---
  await page.getByRole("button",{name:"+ Nuevo insumo / presentación"}).click();
  await page.getByText("Nuevo insumo + presentación de compra").waitFor();
  const modal=page.locator("div.max-w-2xl");
  await modal.getByPlaceholder("EJ. MIEL DE AGAVE",{exact:true}).fill("PEPINO");
  await modal.locator("select").nth(2).selectOption("VERDURA"); // Tipo presentación
  await modal.getByPlaceholder("EJ. MIEL DE AGAVE 25 KG").fill("PEPINO CAJA 5 KG");
  await modal.getByPlaceholder("Ej. 25000").fill("5000");
  await modal.locator("input[type=number]").nth(1).fill("100"); // costo del paquete
  await modal.locator("select").nth(4).selectOption("prov-1"); // Proveedor
  await modal.getByRole("button",{name:/Guardar insumo/}).click();
  await page.waitForTimeout(700);
  const nuevo=DB.catalogo.find(c=>c.articulo==="PEPINO CAJA 5 KG");
  const pepinoIns=DB.insumos.find(i=>i.nombre==="PEPINO");
  // VER-001 activo + VER-002 inactivo (borrado) ⇒ el alta debe saltar al VER-003
  check("8.1 presentación creada con SKU único VER-003 (salta el borrado VER-002)",nuevo&&nuevo.sku==="VER-003",nuevo?.sku);
  check("8.2 insumo nuevo PEPINO creado (+1) en unidad g",pepinoIns&&pepinoIns.unidad_base==="g"&&DB.insumos.length===insumosAntes+1,{antes:insumosAntes,ahora:DB.insumos.length});
  check("8.3 presentación ligada al insumo con contenido 5000",nuevo&&nuevo.insumo_id===pepinoIns?.id&&parseFloat(nuevo.contenido)===5000,{ins:nuevo?.insumo_id,cont:nuevo?.contenido});
  // --- Modo INSUMO EXISTENTE: 2a presentación del mismo insumo, sin duplicar ---
  await page.getByRole("button",{name:"+ Nuevo insumo / presentación"}).click();
  await page.getByText("Nuevo insumo + presentación de compra").waitFor();
  const modal2=page.locator("div.max-w-2xl");
  await modal2.getByRole("button",{name:"Insumo que ya existe"}).click();
  await modal2.getByPlaceholder("Escribe para buscar el insumo…").fill("PEPINO");
  await page.waitForTimeout(250);
  await page.locator("div.absolute.z-30 button").filter({hasText:"PEPINO"}).first().click();
  await modal2.locator("select").nth(0).selectOption("VERDURA"); // Tipo (sin campos de insumo nuevo)
  await modal2.getByPlaceholder("EJ. MIEL DE AGAVE 25 KG").fill("PEPINO BOLSA 1 KG");
  await modal2.getByPlaceholder("Ej. 25000").fill("1000");
  await modal2.locator("input[type=number]").nth(1).fill("30");
  await modal2.locator("select").nth(2).selectOption("prov-1"); // Proveedor
  await modal2.getByRole("button",{name:/Guardar insumo/}).click();
  await page.waitForTimeout(700);
  const pres2=DB.catalogo.find(c=>c.articulo==="PEPINO BOLSA 1 KG");
  check("8.4 2a presentación NO crea insumo duplicado (+0)",DB.insumos.length===insumosAntes+1,{ahora:DB.insumos.length});
  check("8.5 ambas presentaciones apuntan al mismo insumo PEPINO",pres2&&pres2.insumo_id===pepinoIns?.id&&DB.catalogo.filter(c=>c.insumo_id===pepinoIns?.id).length===2,{n:DB.catalogo.filter(c=>c.insumo_id===pepinoIns?.id).length});
  // Buscador en la pestaña Insumos (v7.7)
  await page.getByRole("button",{name:/^Insumos \(/}).click();
  await page.waitForTimeout(200);
  await page.getByPlaceholder("Buscar insumo por nombre o unidad...").fill("PEPINO");
  await page.waitForTimeout(200);
  const insBody=await page.locator("tbody").last().innerText();
  check("8.6 buscador de insumos filtra a PEPINO",insBody.includes("PEPINO")&&!insBody.includes("PECHUGA DE POLLO"),null);

  console.log("\n== Parte 9: Clasificación y filtro de productos (v7.8) ==");
  await menu("Catálogos","Productos y recetas");
  await page.getByRole("heading",{name:"Ventas — SoftRestaurant"}).waitFor();
  const body9=await page.locator("body").innerText();
  check("9.1 columna Clasificación visible",body9.includes("Clasificación"),null);
  const tb=page.locator("tbody").first();
  await page.getByRole("button",{name:/Con receta \(/}).click();
  await page.waitForTimeout(200);
  let t9=await tb.innerText();
  check("9.2 filtro 'Con receta' muestra BOWL y oculta JUGO",t9.includes("BOWL DE PRUEBA")&&!t9.includes("JUGO DE PRUEBA"),null);
  await page.getByRole("button",{name:/No consume \(/}).click();
  await page.waitForTimeout(200);
  t9=await tb.innerText();
  check("9.3 filtro 'No consume' muestra JUGO y oculta BOWL",t9.includes("JUGO DE PRUEBA")&&!t9.includes("BOWL DE PRUEBA"),null);
  await page.getByRole("button",{name:/Todos \(/}).click();
  await page.getByPlaceholder("Buscar producto por nombre, código o grupo...").fill("BOWL");
  await page.waitForTimeout(200);
  t9=await tb.innerText();
  check("9.4 buscador de productos filtra a BOWL",t9.includes("BOWL DE PRUEBA")&&!t9.includes("JUGO DE PRUEBA"),null);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.name));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
