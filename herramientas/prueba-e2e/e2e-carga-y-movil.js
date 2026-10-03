/* Prueba enfocada: carga acotada, menú de celular y buscador de compras
   directas (v7.31).

   Cocina: "la app tarda mucho en cargar, no es responsiva para móvil, se
   amontonan los iconos". Y dirección: que compras directas busque escribiendo
   en vez de una lista desplegable.

   LA CARGA. 27 tablas bajadas UNA TRAS OTRA y sin filtro de fecha, con sbGet
   paginando de 1000 en 1000. A octubre:

     movimientos_sucursal  104,028 filas → 105 peticiones encadenadas
     venta_detalle          22,470 filas →  23
     ventas                  4,613 filas →   5

   `salida_venta` es el 99% del kárdex (102,890 de 104,028) y nadie necesitaba
   esas filas una por una: el estado de resultados sólo quería el COGS del mes.
   Ahora lo da la vista `v_cogs_mensual` en cuatro filas.

   Lo que se verifica aquí es el CONTRATO DE RED, que es donde el ahorro vive y
   donde una regresión sería invisible: que no se pida la tabla de movimientos
   sin filtro, que ventas y detalle lleven ventana de fecha, y que todo salga en
   paralelo y no en fila. Una prueba de "¿se ve rápido?" no detectaría que
   alguien quite un filtro. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const hoy=new Date().toISOString().split("T")[0];
const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true},
                   {id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Walmart",tipo_flujo_id:"tf-m",activo:true},
               {id:"prov-2",nombre:"Botello",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[{id:"i-jit",nombre:"JITOMATE",unidad_base:"g",tipo_control:"inventariable",activo:true,preparacion_id:null}],
  // Tres artículos cuyos nombres prueban el buscador: acentos, prefijo y
  // coincidencia a media palabra.
  catalogo:[
    {id:"c-jit",sku:"VER-001",articulo:"JITOMATE SALADET",tipo_producto:"VERDURA",unidad_id:"u-kg",costo_referencia:20,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"i-jit",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-plat",sku:"FRU-001",articulo:"PLÁTANO MACHO",tipo_producto:"FRUTA",unidad_id:"u-kg",costo_referencia:18,proveedor_id:"prov-2",aplica_iva:false,activo:true,insumo_id:null,contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-serv",sku:"LIM-001",articulo:"SERVILLETA BLANCA",tipo_producto:"LIMPIEZA",unidad_id:"u-pz",costo_referencia:3,proveedor_id:"prov-1",aplica_iva:true,activo:true,insumo_id:null,contenido:1,inventario_almacen_id:null,notas:null},
  ],
  inventario_sucursal:[],inventario_almacen:[],pedidos:[],pedido_detalle:[],
  recepciones:[],recepcion_detalle:[],pedido_proveedor_estatus:[],lotes_almacen:[],
  cuentas_por_pagar:[],pagos:[],compras_directas:[],gastos_operativos:[],categorias_gastos:[],
  productos_venta:[],recetas:[],ventas:[],venta_detalle:[],mermas:[],
  movimientos_sucursal:[],movimientos_almacen:[],insumos_extra:[],
  reglas_consumo_ticket:[],producciones:[],conector_latido:[],
  v_cogs_mensual:[{mes:hoy.slice(0,7),sucursal_id:"suc-1",cogs:1234.5,movimientos:99}],
};

// Bitácora de red: qué tabla, con qué filtros y en qué momento.
const peticiones=[];

function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq."))      {if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("neq.")){if(String(row[k])===v.slice(4))return false;}
    else if(v.startsWith("gte.")){if(!(String(row[k])>=v.slice(4)))return false;}
    else if(v.startsWith("in.(")){const l=v.slice(4,-1).split(",");if(!l.includes(String(row[k])))return false;}
    else if(v==="not.is.null")   {if(row[k]==null)return false;}
  }
  return true;
}
function handleRest(method,table,search,body){
  if(method==="GET")peticiones.push({table,search:search||"",t:Date.now()});
  if(!(table in DB)){if(method==="GET")return{status:200,body:"[]"};return{status:404,body:"{}"};}
  const params=[...new URLSearchParams(search).entries()];
  if(method==="GET")return{status:200,body:JSON.stringify(DB[table].filter(r=>matchFilters(r,params)))};
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    const ins=arr.map(r=>{const row={...r};if(!row.id)row.id="gen-"+(++genN);DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){const u=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};u.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(u)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}

const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

(async()=>{
  console.log("\n== Carga acotada, menú de celular y buscador de compras directas (v7.31) ==");
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  // Tamaño de un celular común: es donde cocina reportó el problema.
  const ctx=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
  const page=await ctx.newPage();
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
      const res=handleRest(m,rest[1],decodeURIComponent(rest[3]||""),body);
      return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});

  // ================= EL CONTRATO DE RED =================
  const movs=peticiones.filter(p=>p.table==="movimientos_sucursal");
  check("1. el kárdex se pide con filtro, nunca entero",
        movs.length>0&&movs.every(p=>/tipo=/.test(p.search)),movs.map(p=>p.search));
  check("2. se piden los movimientos que NO son venta",
        movs.some(p=>/tipo=neq\.salida_venta/.test(p.search)),movs.map(p=>p.search));
  check("3. y una cola acotada de ventas recientes (limit)",
        movs.some(p=>/tipo=eq\.salida_venta/.test(p.search)&&/limit=\d+/.test(p.search)),movs.map(p=>p.search));

  const ventas=peticiones.filter(p=>p.table==="ventas");
  check("4. ventas lleva ventana de fecha",
        ventas.length>0&&ventas.every(p=>/fecha=gte\./.test(p.search)),ventas.map(p=>p.search));
  const det=peticiones.filter(p=>p.table==="venta_detalle");
  check("5. el detalle de ventas también",
        det.length>0&&det.every(p=>/created_at=gte\./.test(p.search)),det.map(p=>p.search));

  check("6. el COGS del mes se pide agregado a la vista",
        peticiones.some(p=>p.table==="v_cogs_mensual"));

  // La ventana tiene que cubrir "mes pasado", el periodo más viejo que ofrece
  // el dashboard de ventas. Menos que eso dejaría huecos invisibles.
  const desde=(ventas[0]?.search.match(/fecha=gte\.([\d-]+)/)||[])[1];
  const dias=desde?Math.round((Date.now()-new Date(desde).getTime())/864e5):0;
  check("7. la ventana cubre al menos 'mes pasado' (>=62 días)",dias>=62,{desde,dias});

  // Paralelo, no en fila: si fueran secuenciales, las marcas de tiempo se
  // repartirían a lo largo de la carga en vez de agruparse al inicio.
  const t0=Math.min(...peticiones.map(p=>p.t));
  const enRafaga=peticiones.filter(p=>p.t-t0<1500).length;
  check("8. las tablas salen en paralelo, no una tras otra",
        enRafaga>=peticiones.length*0.8,{enRafaga,total:peticiones.length});

  // ================= EL MENÚ EN CELULAR =================
  await page.getByText("Acceso total").first().click();
  await page.locator("input[type=password]").fill("fittaste2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // NOTA sobre el alcance: este simulador deja Tailwind en blanco
  // (window.tailwind={config:{}}), así que NINGUNA clase CSS aplica. Medir
  // alturas de toque o desbordes aquí no diría nada — saldría igual con el
  // encabezado viejo. Lo que sí se puede verificar, y es donde una regresión
  // pasaría inadvertida, son dos cosas: el ÁRBOL (qué existe en el DOM y
  // cuándo) y el CONTRATO DE CLASES (qué se esconde en qué punto de quiebre).
  // El aspecto se revisa en el navegador, no aquí.
  const btnMenu=page.getByRole("button",{name:"Menú"});
  check("9. en celular hay UN botón de menú, no cinco grupos sueltos",
        await btnMenu.count()===1,await btnMenu.count());
  check("10. ese botón sólo existe hasta el punto de quiebre (md:hidden)",
        /md:hidden/.test(await btnMenu.getAttribute("class")||""),
        await btnMenu.getAttribute("class"));

  // La barra de escritorio sigue ahí, oculta hasta md: sin eso, el escritorio
  // se quedaría sin menú.
  const barra=page.locator("header, div").filter({has:page.getByRole("button",{name:/Salir/})});
  const claseBarra=await page.evaluate(()=>{
    const b=[...document.querySelectorAll("div")].find(d=>/hidden md:flex/.test(d.className||""));
    return b?b.className:null;});
  check("11. la barra de escritorio existe y se oculta en celular (hidden md:flex)",
        claseBarra!==null,claseBarra);

  // El panel es estado de React, no CSS: antes de tocar el botón NO está en el
  // árbol. Esto sí es comprobable sin hojas de estilo.
  const panelAntes=await page.getByRole("button",{name:"Compras directas",exact:true}).count();
  check("12. el panel no existe en el DOM hasta abrirlo",panelAntes===0,panelAntes);

  await btnMenu.click();
  await page.waitForTimeout(300);
  check("13. al abrirlo aparecen las PANTALLAS, no sólo los grupos",
        await page.getByRole("button",{name:"Compras directas",exact:true}).count()>0);
  check("14. y el panel también vive sólo en celular (md:hidden)",
        await page.evaluate(()=>{
          const p=[...document.querySelectorAll("div")].filter(d=>/md:hidden/.test(d.className||""));
          return p.some(d=>/Compras directas/.test(d.textContent||""));}));

  // ================= EL BUSCADOR DE COMPRAS DIRECTAS =================
  await page.getByRole("button",{name:"Compras directas",exact:true}).click();
  await page.waitForTimeout(600);

  const caja=page.getByPlaceholder(/Escribe para buscar el artículo/);
  check("15. el artículo se busca escribiendo, ya no es lista desplegable",
        await caja.count()>0);

  // Ignora acentos, como el buscador del inventario.
  await caja.fill("platano");
  await page.waitForTimeout(350);
  check("16. encuentra PLÁTANO escribiendo sin acento",
        await page.getByRole("button",{name:/PLÁTANO MACHO/}).first().isVisible().catch(()=>false));

  await caja.fill("jito");
  await page.waitForTimeout(350);
  check("17. filtra a lo tecleado y descarta el resto",
        (await page.getByRole("button",{name:/JITOMATE SALADET/}).first().isVisible().catch(()=>false))
        &&!(await page.getByRole("button",{name:/SERVILLETA/}).first().isVisible().catch(()=>false)));

  await page.getByRole("button",{name:/JITOMATE SALADET/}).first().click();
  await page.waitForTimeout(350);
  const txtForm=await page.locator("body").innerText();
  check("18. al elegirlo confirma cuál quedó seleccionado",
        /Seleccionado:\s*JITOMATE SALADET/.test(txtForm),txtForm.slice(0,300));
  // Elegir el artículo trae su costo de referencia: es lo que ahorra teclear.
  const costo=await page.locator('input[type=number]').nth(1).inputValue().catch(()=>null);
  check("19. y trae el costo de referencia del artículo ($20)",costo==="20",costo);

  await browser.close();
  const ok=results.filter(r=>r.ok).length;
  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${results.length} verificaciones pasaron`);
  console.log(ok===results.length?"TODAS LAS PRUEBAS PASARON ✓":"HAY FALLAS ✗");
  process.exit(ok===results.length?0:1);
})();
