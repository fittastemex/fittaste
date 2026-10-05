/* Prueba enfocada: la recepción relee los precios y deja de ser un muro (v7.32).

   Reporte de dirección (2026-10-05): "cocina me dice que no les permite hacer la
   recepción". La pantalla decía "Falta el costo unitario de 35 artículos" — y
   los 35 precios SÍ existían: Botello los había capturado desde su liga esa
   misma mañana a las 09:15.

   LA CADENA

     1. La app baja las 27 tablas UNA vez al abrir y no vuelve a mirar.
     2. El proveedor captura sus precios desde su liga a cualquier hora.
     3. La sucursal tenía la app abierta de antes: su copia traía costo_real = 0.
     4. Las casillas salieron vacías aunque la base ya tenía los precios.
     5. El bloqueo de v7.23 se negó a guardar. No se pudo recibir.

   DOS ARREGLOS, Y EL SEGUNDO ES UNA RECTIFICACIÓN

   Releer el detalle al abrir la recepción corrige el defecto. Pero el muro
   también tenía que caer, y eso es admitir que me equivoqué al ponerlo.

   v7.23 bloqueaba para evitar que entrara mercancía con un costo estimado que
   nada corregiría después. El razonamiento no era malo; la consecuencia sí:
   entre el 31-ago y el 25-sep quedaron siete pedidos sin recibir ($62,551) y el
   inventario acumuló 64 negativos. Un costo aproximado es malo. No registrar la
   entrada es peor, y además no se nota hasta semanas después.

   Ahora avisa igual, pero ofrece una salida explícita —otro botón, que dice que
   entra con precio de catálogo— y las líneas así recibidas dejan `costo_real`
   vacío, así que siguen siendo identificables para capturar el precio real. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[
    {id:"tf-m",nombre:"Compra manual",quien_captura_precio:"proveedor",proveedor_ve_pedido:true,costo_editable:true},
    {id:"tf-alm",nombre:"Almacen interno",quien_captura_precio:"sistema",proveedor_ve_pedido:false,costo_editable:false}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Botello",tipo_flujo_id:"tf-m",tipo_flujo:"Compra manual",activo:true}],
  insumos:[
    {id:"i-jit",nombre:"JITOMATE CHERRY",unidad_base:"g",tipo_control:"inventariable",activo:true},
    {id:"i-ceb",nombre:"CEBOLLA",         unidad_base:"g",tipo_control:"inventariable",activo:true}],
  catalogo:[
    {id:"c-jit",sku:"VER-001",articulo:"JITOMATE CHERRY",tipo_producto:"VERDURA",unidad_id:"u-kg",
     costo_referencia:60,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"i-jit",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"c-ceb",sku:"VER-002",articulo:"CEBOLLA",tipo_producto:"VERDURA",unidad_id:"u-kg",
     costo_referencia:20,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"i-ceb",contenido:1000,inventario_almacen_id:null,notas:null}],
  pedidos:[{id:"ped-1",numero_pedido:"PED-PRUEBA-001",sucursal_id:"suc-1",estatus:"en_proceso",created_at:new Date().toISOString()}],
  // El estado que tenía el navegador de cocina: sin precios. La base los recibirá
  // a media prueba, igual que Botello a las 09:15.
  pedido_detalle:[
    {id:"det-jit",pedido_id:"ped-1",catalogo_id:"c-jit",proveedor_id:"prov-1",cantidad:1,costo_referencia:60,costo_real:null,capturado_por:null,fecha_captura:null},
    {id:"det-ceb",pedido_id:"ped-1",catalogo_id:"c-ceb",proveedor_id:"prov-1",cantidad:6,costo_referencia:20,costo_real:null,capturado_por:null,fecha_captura:null}],
  pedido_proveedor_estatus:[{id:"pe-1",pedido_id:"ped-1",proveedor_id:"prov-1",estatus:"enviado"}],
  inventario_almacen:[],lotes_almacen:[],movimientos_almacen:[],categorias_gastos:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],productos_venta:[],recetas:[],inventario_sucursal:[],
  ventas:[],venta_detalle:[],mermas:[],movimientos_sucursal:[],reglas_consumo_ticket:[],
  producciones:[],produccion_consumo:[],conector_latido:[],v_cogs_mensual:[],
};
const DEFAULTS={
  insumos:{activo:true,unidad_base:"pz",tipo_control:"inventariable"},
  catalogo:{activo:true,contenido:1,costo_referencia:0},
  inventario_sucursal:{existencia:0,costo_promedio:0},
};

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
  if(!(table in DB)){if(method==="GET")return{status:200,body:"[]"};return{status:404,body:"{}"};}
  const params=[...new URLSearchParams(search).entries()];
  if(method==="GET")return{status:200,body:JSON.stringify(DB[table].filter(r=>matchFilters(r,params)))};
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    const ins=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);
      if(!row.created_at)row.created_at=new Date().toISOString();DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){const u=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};u.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(u)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}

const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

(async()=>{
  console.log("\n== La recepción relee los precios y deja de ser un muro (v7.32) ==");
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
      const res=handleRest(m,rest[1],decodeURIComponent(rest[3]||""),body);
      return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  const entrarARecepcion=async()=>{
    await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
    await page.getByRole("button",{name:"Recepción",exact:true}).click();
    await page.getByText("PED-PRUEBA-001").first().waitFor({timeout:10000});
    await page.getByRole("button",{name:/Recibir/}).first().click();
    await page.getByText(/Recepción —/).waitFor({timeout:5000});
    await page.waitForTimeout(500);
  };

  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();   // rol Sucursal
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // ================= 1) EL MURO YA NO ES MURO =================
  // Nadie ha capturado precios: es el caso que v7.23 bloqueaba en seco.
  await entrarARecepcion();
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(600);
  check("1. sin precios avisa cuáles faltan",
        /Falta el costo unitario de 2/.test(await page.locator("body").innerText()));
  check("2. y NO guarda nada todavía",DB.recepciones.length===0,DB.recepciones.length);

  const salida=page.getByRole("button",{name:"Recibir con precio de catálogo"});
  check("3. ofrece la salida explícita",await salida.count()===1);
  check("4. la salida explica qué implica, no sólo que existe",
        /entra hoy al inventario con un costo aproximado/.test(await page.locator("body").innerText()));

  await salida.click();
  await page.waitForTimeout(1200);
  check("5. al usarla, la recepción SÍ se crea",DB.recepciones.length===1,DB.recepciones.length);
  const movs=DB.movimientos_sucursal.filter(m=>m.tipo==="entrada_recepcion");
  check("6. y la mercancía entra al inventario",movs.length===2,movs.length);
  // 1 kg de jitomate a $60 el kg = $0.06 el gramo (el precio de catálogo).
  const mj=movs.find(m=>m.insumo_id==="i-jit");
  check("7. entra con el precio de CATÁLOGO, no en cero",
        mj&&Math.abs(parseFloat(mj.costo_unitario)-0.06)<0.0001,mj&&mj.costo_unitario);
  check("8. y la cantidad va en unidad base (1 kg = 1000 g)",
        mj&&parseFloat(mj.cantidad)===1000,mj&&mj.cantidad);
  // La línea queda identificable: sin costo_real nadie puede creer que el precio
  // es el de la factura.
  const det=DB.pedido_detalle.find(d=>d.id==="det-jit");
  check("9. costo_real queda VACÍO: la línea sigue pendiente de precio real",
        !(parseFloat(det.costo_real)>0),det.costo_real);

  // ================= 2) RELEER LOS PRECIOS AL ABRIR =================
  // El caso del 05-oct: el proveedor captura DESPUÉS de que la sucursal abrió la
  // app. La copia del navegador es vieja; la base ya tiene los precios.
  DB.recepciones=[];DB.recepcion_detalle=[];DB.movimientos_sucursal=[];
  DB.inventario_sucursal=[];
  DB.pedido_detalle.forEach(d=>{d.costo_real=null;d.capturado_por=null;});
  DB.pedido_proveedor_estatus[0].estatus="enviado";
  await page.reload();
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // Botello captura sus precios AHORA, con la app ya cargada.
  DB.pedido_detalle.find(d=>d.id==="det-jit").costo_real=35;
  DB.pedido_detalle.find(d=>d.id==="det-jit").capturado_por="proveedor";
  DB.pedido_detalle.find(d=>d.id==="det-ceb").costo_real=40;
  DB.pedido_detalle.find(d=>d.id==="det-ceb").capturado_por="proveedor";

  await entrarARecepcion();
  const txt=await page.locator("body").innerText();
  check("10. avisa que trajo precios capturados después de abrir la app",
        /Se actualizaron 2 precios/.test(txt),txt.slice(0,400));

  // Las casillas tienen que traer el precio del proveedor, no el de catálogo.
  const valores=await page.evaluate(()=>
    [...document.querySelectorAll('input[placeholder="0.00"]')].map(i=>i.value));
  check("11. las casillas se llenan con el precio del PROVEEDOR ($35 y $40)",
        valores.includes("35")&&valores.includes("40"),valores);
  check("12. y no con el de catálogo ($60 y $20)",
        !valores.includes("60")&&!valores.includes("20"),valores);

  // Con precios, el camino normal pasa sin ofrecer la salida.
  check("13. ya no ofrece la salida: no hace falta",
        await page.getByRole("button",{name:"Recibir con precio de catálogo"}).count()===0);
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(1200);
  check("14. la recepción se crea al primer intento",DB.recepciones.length===1,DB.recepciones.length);

  const mj2=DB.movimientos_sucursal.find(m=>m.insumo_id==="i-jit"&&m.tipo==="entrada_recepcion");
  check("15. y el inventario toma el precio de factura ($35/kg = $0.035/g)",
        mj2&&Math.abs(parseFloat(mj2.costo_unitario)-0.035)<0.0001,mj2&&mj2.costo_unitario);
  const det2=DB.pedido_detalle.find(d=>d.id==="det-jit");
  check("16. y esta vez costo_real SÍ queda guardado",parseFloat(det2.costo_real)===35,det2.costo_real);

  // ================= 3) EL PRECIO LLEGA DESPUÉS DE RECIBIR =================
  // El cabo que v7.32 dejó suelto y que dirección señaló: "¿qué pasa si el
  // proveedor entrega y aún no ha cargado precios?". Se recibe con el de
  // catálogo, y cuando llega la factura el inventario tiene que corregirse.
  DB.recepciones=[];DB.recepcion_detalle=[];DB.movimientos_sucursal=[];
  DB.inventario_sucursal=[];
  DB.pedido_detalle.forEach(d=>{d.costo_real=null;d.capturado_por=null;});
  DB.pedido_proveedor_estatus[0].estatus="enviado";
  DB.pedido_proveedor_estatus[0].token_activo=true;
  DB.pedido_proveedor_estatus[0].token_acceso="tok-1";
  await page.reload();
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  // Se recibe sin precios, usando la salida.
  await entrarARecepcion();
  await page.getByRole("button",{name:/Recepción completa/}).click();
  await page.waitForTimeout(600);
  await page.getByRole("button",{name:"Recibir con precio de catálogo"}).click();
  await page.waitForTimeout(1200);
  const movEst=DB.movimientos_sucursal.find(m=>m.insumo_id==="i-jit"&&m.tipo==="entrada_recepcion");
  check("17. entró con el estimado de catálogo ($0.06/g)",
        movEst&&Math.abs(parseFloat(movEst.costo_unitario)-0.06)<1e-6,movEst&&movEst.costo_unitario);
  check("18. el movimiento queda atado a su recepción (recepcion_id)",
        movEst&&!!movEst.recepcion_id,movEst&&movEst.recepcion_id);
  const invEst=DB.inventario_sucursal.find(i=>i.insumo_id==="i-jit");
  check("19. y el costo promedio también ($0.06/g)",
        invEst&&Math.abs(parseFloat(invEst.costo_promedio)-0.06)<1e-6,invEst&&invEst.costo_promedio);

  // Ahora llega Botello con su liga y captura $35/kg (el real).
  await page.goto("http://fittaste.local/index.html?token=tok-1");
  await page.getByText(/Captura de precios|Precios|PED-PRUEBA-001/).first().waitFor({timeout:20000});
  await page.waitForTimeout(600);
  // En esta vista cada renglón tiene dos campos numéricos: "Entregado" (ya
  // viene con la cantidad) y "Precio unit." (vacío). Se llenan los vacíos.
  const cajasPrecio=page.locator('input[type=number]');
  const nCajas=await cajasPrecio.count();
  check("20. la liga del proveedor sigue abierta después de recibir",nCajas>0,nCajas);
  for(let i=0;i<nCajas;i++){
    if((await cajasPrecio.nth(i).inputValue())==="")await cajasPrecio.nth(i).fill("35");
  }
  await page.waitForTimeout(400);
  // El botón arranca deshabilitado diciendo cuántos precios faltan; al llenarlos
  // cambia a confirmar. Se toma el último botón de la vista, que es el de acción.
  const btns=page.locator("button");
  await btns.last().click();
  await page.waitForTimeout(1800);

  const movCorr=DB.movimientos_sucursal.find(m=>m.insumo_id==="i-jit"&&m.tipo==="entrada_recepcion");
  check("21. el movimiento de recepción quedó al precio de factura ($0.035/g)",
        movCorr&&Math.abs(parseFloat(movCorr.costo_unitario)-0.035)<1e-6,movCorr&&movCorr.costo_unitario);
  check("22. y la nota deja constancia de la corrección",
        movCorr&&/precio corregido con la factura/.test(movCorr.nota||""),movCorr&&movCorr.nota);
  const invCorr=DB.inventario_sucursal.find(i=>i.insumo_id==="i-jit");
  check("23. el costo promedio del inventario también se corrigió",
        invCorr&&Math.abs(parseFloat(invCorr.costo_promedio)-0.035)<1e-3,invCorr&&invCorr.costo_promedio);
  const detFin=DB.pedido_detalle.find(d=>d.id==="det-jit");
  check("24. y el pedido guarda el precio real ($35)",
        parseFloat(detFin.costo_real)===35,detFin.costo_real);

  await browser.close();
  const ok=results.filter(r=>r.ok).length;
  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${results.length} verificaciones pasaron`);
  console.log(ok===results.length?"TODAS LAS PRUEBAS PASARON ✓":"HAY FALLAS ✗");
  process.exit(ok===results.length?0:1);
})();
