/* Prueba enfocada: la compra directa dice POR QUÉ falló (v7.35).

   EL REPORTE. 15-oct-2026, dirección: "cocina me dice que no le deja registrar
   la compra directa: que es de $55 pesos, que si le pone en $53 no le deja
   guardar". Captura de pantalla: tortilla de nopal, 13 × $53, transferencia.

   LO QUE SE PUDO AVERIGUAR DESDE FUERA: nada. Se reprodujo ese mismo renglón
   contra la base con la llave anon y entró sin problema — así que no era una
   restricción, ni un permiso, ni el precio. Pero tampoco se podía decir qué
   SÍ era, porque `sbPost` escribe el motivo real en la consola del navegador y
   devuelve null; en pantalla sólo salía "Error al registrar".

   Nadie en una cocina tiene la consola abierta. Desde fuera, un problema de red
   en el celular, un campo vacío y un rechazo de la base se ven idénticos: "no
   me deja guardar". Eso convierte cada reporte en una investigación a ciegas.

   Es exactamente el patrón del PATCH de `capturado_por`, que falló en silencio
   desde v7.23 hasta que una consulta a la base lo destapó por casualidad.

   QUÉ VERIFICA ESTA PRUEBA:
     1. Que cuando la base rechaza, el mensaje en pantalla lleve el motivo real.
     2. Que un fallo de red se distinga de un rechazo, y diga que no se guardó.
     3. Que al tener éxito, la compra entre al inventario como siempre.
     4. Que si la compra se guarda pero la entrada al inventario truena, lo diga
        — y advierta que NO se recapture, porque quedaría doble. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
// Lo que el servidor falso debe hacer con el próximo POST a compras_directas.
let modoCompra="ok"; // "ok" | "rechaza" | "red"

const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-tort",nombre:"Proveedor Tortilla",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[{id:"ins-nopal",nombre:"TORTILLA DE NOPAL GRANDE",unidad_base:"pz",tipo_control:"inventariable",activo:true,preparacion_id:null}],
  catalogo:[
    {id:"c-nopal",sku:"ABA-016",articulo:"TORTILLA DE NOPAL",tipo_producto:"ABARROTES",unidad_id:"u-kg",
     costo_referencia:53,proveedor_id:"prov-tort",aplica_iva:false,activo:true,
     insumo_id:"ins-nopal",contenido:7.7,inventario_almacen_id:null,notas:null},
  ],
  inventario_sucursal:[{id:"iv-nopal",sucursal_id:"suc-1",insumo_id:"ins-nopal",existencia:0,costo_promedio:0}],
  productos_venta:[],recetas:[],producciones:[],produccion_consumo:[],
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

(async()=>{
  console.log("\n== La compra directa dice por qué falló (v7.35) ==");
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  const avisos=[];
  page.on("dialog",async d=>{avisos.push(d.message());await d.accept();});
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
    if(rest){
      // El servidor falso se porta mal a propósito, sólo con esta tabla.
      if(rest[1]==="compras_directas"&&m==="POST"){
        if(modoCompra==="red")return route.abort("failed");
        if(modoCompra==="rechaza")return route.fulfill({status:400,contentType:"application/json",
          body:JSON.stringify({message:'new row for relation "compras_directas" violates check constraint "compras_directas_metodo_pago_check"',code:"23514"})});
      }
      let body=null;try{body=route.request().postData()?JSON.parse(route.request().postData()):null;}catch(e){}
      const res=handleRest(m,rest[1],rest[3]||"",body);return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  await page.goto("http://fittaste.local/index.html");
  await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
  await page.getByText("Crea pedidos").first().click();
  await page.locator("input[type=password]").fill("roma2026");
  await page.getByRole("button",{name:"Ingresar"}).click();
  await page.getByText("Fit Taste Roma").waitFor({timeout:20000});

  await page.getByRole("button",{name:new RegExp("Compras")}).first().click();
  await page.getByRole("button",{name:"Compras directas",exact:true}).click();
  await page.waitForTimeout(600);

  // Capturar la compra igual que cocina: artículo, 13, y el costo que trae el
  // catálogo ($53) — el mismo renglón de la captura del 15-oct.
  const capturar=async()=>{
    await page.getByPlaceholder("Escribe para buscar el artículo…").fill("TORTILLA DE NOPAL");
    await page.waitForTimeout(400);
    await page.getByText("TORTILLA DE NOPAL",{exact:false}).last().click().catch(()=>{});
    await page.waitForTimeout(300);
    const nums=page.locator('input[type="number"]');
    await nums.nth(0).fill("13");
    await page.waitForTimeout(200);
  };
  await capturar();
  check("1. al elegir el artículo se precarga el costo del catálogo ($53)",
        (await page.locator('input[type="number"]').nth(1).inputValue())==="53",
        await page.locator('input[type="number"]').nth(1).inputValue());

  // ---------- 1) La base rechaza ----------
  modoCompra="rechaza";
  avisos.length=0;
  await page.getByRole("button",{name:"Registrar compra"}).click();
  await page.waitForTimeout(1200);
  const avRechazo=avisos.join(" | ");
  check("2. el aviso YA NO es el genérico 'Error al registrar'",
        !/^Error al registrar$/.test(avRechazo.trim()),avRechazo);
  check("3. trae el motivo real que mandó el servidor",
        /check constraint/.test(avRechazo),avRechazo);
  check("4. e incluye el código para poder rastrearlo",
        /400/.test(avRechazo),avRechazo);
  check("5. y no guardó nada",DB.compras_directas.length===0,DB.compras_directas.length);

  // ---------- 2) Se cae la red ----------
  modoCompra="red";
  avisos.length=0;
  await page.getByRole("button",{name:"Registrar compra"}).click();
  await page.waitForTimeout(1200);
  const avRed=avisos.join(" | ");
  check("6. un fallo de red se distingue de un rechazo de la base",
        /conexi[óo]n/i.test(avRed),avRed);
  check("7. y dice explícitamente que nada se guardó",
        /[Nn]ada se guard/.test(avRed),avRed);
  check("8. en efecto, no se guardó",DB.compras_directas.length===0,DB.compras_directas.length);

  // ---------- 3) El camino bueno ----------
  modoCompra="ok";
  avisos.length=0;
  await page.getByRole("button",{name:"Registrar compra"}).click();
  await page.waitForTimeout(1500);
  check("9. cuando todo va bien, se registra",DB.compras_directas.length===1,DB.compras_directas.length);
  const cd=DB.compras_directas[0]||{};
  check("10. con su cantidad y costo correctos (13 × $53 = $689)",
        parseFloat(cd.cantidad)===13&&parseFloat(cd.costo_unitario)===53&&parseFloat(cd.costo_total)===689,
        {c:cd.cantidad,cu:cd.costo_unitario,t:cd.costo_total});
  // 13 kg × contenido 7.7 = 100.1 piezas, a 53/7.7 = $6.88 por pieza.
  const inv=DB.inventario_sucursal.find(i=>i.insumo_id==="ins-nopal");
  check("11. y entra al inventario convertido a unidad base (13 × 7.7 = 100.1 pz)",
        inv&&Math.abs(parseFloat(inv.existencia)-100.1)<0.05,inv&&inv.existencia);
  check("12. con el costo por pieza, no por kilo ($53 / 7.7 = $6.88)",
        inv&&Math.abs(parseFloat(inv.costo_promedio)-6.8831)<0.01,inv&&inv.costo_promedio);
  check("13. el kárdex registra la entrada",
        DB.movimientos_sucursal.some(m=>m.tipo==="entrada_compra_directa"),
        DB.movimientos_sucursal.map(m=>m.tipo));
  check("14. y lo confirma en pantalla",/Compra registrada/.test(avisos.join(" | ")),avisos.join(" | "));

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
