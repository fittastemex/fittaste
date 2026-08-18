/* Prueba enfocada: consumo por TICKET y no por platillo (v7.19).

   La bolsa la decide el pedido completo, no el platillo: un wrap solo va en bolsa
   chica, si el ticket trae varios productos cocina manda UNA bolsa grande en lugar
   de varias chicas, y una venta de mostrador no lleva bolsa. Eso no cabe en una
   receta, que describe un platillo y no una orden.

   La regla se APLICA en la base, con un trigger sobre venta_detalle: así cubre por
   igual al conector y a la importación manual, sin depender de desplegar nada en la
   PC del punto de venta. Ese trigger se verifica contra la base real (el simulador
   de esta batería no ejecuta triggers) — ver §11 de docs/RECETARIO-Y-CONECTOR-SR.md.

   Lo que SÍ se prueba aquí es la copia de la lógica que vive en index.html, la que
   alimenta la vista previa de la pantalla de configuración ("a cuántos tickets del
   histórico aplicaría esta regla"). Si esa copia se desvía de la regla real, la
   pantalla mentiría sobre el efecto de una regla antes de activarla. */
const fs=require("fs");
const {chromium}=require("playwright");

const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

// ---------- Reglas de prueba: las dos de bolsa reales ----------
const REGLAS=[
  {id:"r-chica",nombre:"Bolsa chica de domicilio",insumo_id:"ins-chica",cantidad:1,
   canales:["ubereats","rappi","didi"],min_productos:1,max_productos:2,grupo:"bolsa_domicilio",prioridad:10,activo:true},
  {id:"r-grande",nombre:"Bolsa grande de domicilio",insumo_id:"ins-grande",cantidad:1,
   canales:["ubereats","rappi","didi"],min_productos:3,max_productos:null,grupo:"bolsa_domicilio",prioridad:10,activo:true},
];

// Matriz de casos: [canal, nProductos, insumos esperados]
const CASOS=[
  ["mostrador",1,[]],                    // mostrador nunca lleva bolsa
  ["mostrador",5,[]],
  ["ubereats",0,[]],                     // sin productos vendibles no hay bolsa
  ["ubereats",1,["ins-chica"]],
  ["ubereats",2,["ins-chica"]],
  ["ubereats",3,["ins-grande"]],         // 3 o más: cambia a grande
  ["ubereats",9,["ins-grande"]],
  ["rappi",2,["ins-chica"]],             // otras plataformas también
  ["didi",4,["ins-grande"]],
  ["telefono",2,[]],                     // canal no listado: no aplica
];

// Dos reglas del mismo grupo cuyos rangos se traslapan: sólo debe aplicar una.
const solapadas=[
  {id:"a",insumo_id:"ins-chica",cantidad:1,canales:["ubereats"],min_productos:1,max_productos:null,grupo:"bolsa_domicilio",prioridad:10,activo:true},
  {id:"b",insumo_id:"ins-grande",cantidad:1,canales:["ubereats"],min_productos:1,max_productos:null,grupo:"bolsa_domicilio",prioridad:20,activo:true},
];

(async()=>{
  console.log("\n== Consumo por ticket: la bolsa es del pedido, no del platillo (v7.19) ==");

  // ---------- La copia de la lógica que vive en la app ----------
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const ctx=await browser.newContext();
  const page=await ctx.newPage();
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));
  await ctx.route("**/*",async route=>{
    const url=route.request().url();
    if(url.startsWith("http://fittaste.local/"))return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html});
    if(url.includes("react-dom"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react-dom/umd/react-dom.production.min.js","utf8")});
    if(url.includes("/react@"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react/umd/react.production.min.js","utf8")});
    if(url.includes("babel"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/@babel/standalone/babel.min.js","utf8")});
    if(url.includes("cdn.tailwindcss.com"))return route.fulfill({status:200,contentType:"application/javascript",body:"window.tailwind={config:{}};"});
    if(url.includes("fonts.googleapis"))return route.fulfill({status:200,contentType:"text/css",body:""});
    if(url.includes("supabase.co/rest/v1/"))return route.fulfill({status:200,contentType:"application/json",body:"[]"});
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });
  await page.goto("http://fittaste.local/index.html");
  // No hace falta que la app arranque con datos: las funciones son de nivel
  // superior, así que basta esperar a que Babel evalúe el script.
  await page.waitForFunction(()=>typeof window.consumoPorTicket==="function"
    ||typeof consumoPorTicket==="function",{timeout:20000});

  // La matriz se evalúa contra la función real de index.html, no contra una copia
  // de la prueba: si alguien la cambia, esto falla.
  const appMatriz=await page.evaluate(({reglas,casos})=>{
    if(typeof consumoPorTicket!=="function")return{error:"consumoPorTicket no existe en index.html"};
    const fallos=[];
    for(const [canal,n,esperado] of casos){
      const got=consumoPorTicket(reglas,canal,n).map(x=>x.insumo_id).sort();
      const exp=[...esperado].sort();
      if(JSON.stringify(got)!==JSON.stringify(exp))fallos.push({canal,n,got,exp});
    }
    return{fallos};
  },{reglas:REGLAS,casos:CASOS});
  check("1. la matriz de canal x productos da la bolsa correcta",
    !appMatriz.error&&appMatriz.fallos.length===0,appMatriz);

  const appConteo=await page.evaluate(()=>{
    if(typeof contarProductosTicket!=="function")return null;
    const prods=[
      {id:"p1",grupo_sr:"WRAPS"},{id:"p2",grupo_sr:"WRAPS"},
      {id:"m1",grupo_sr:"MODS WRAPS SAND"},{id:"e1",grupo_sr:"EXTRAS"},
      {id:"c1",grupo_sr:"COMBOS FIT",sin_insumos:true},
    ];
    const det=[
      {producto_venta_id:"p1",cantidad:1},{producto_venta_id:"p2",cantidad:2},
      {producto_venta_id:"m1",cantidad:1},{producto_venta_id:"e1",cantidad:3},
      {producto_venta_id:"c1",cantidad:1},
    ];
    return contarProductosTicket(det,prods);
  });
  check("2. el conteo ignora modificadores y contenedores de precio",appConteo===3,appConteo);

  const appGrupo=await page.evaluate((solapadas)=>consumoPorTicket(solapadas,"ubereats",5).map(x=>x.insumo_id),solapadas);
  check("3. grupo excluyente descuenta una sola bolsa",
    appGrupo.length===1&&appGrupo[0]==="ins-chica",appGrupo);

  // El costo del consumo por ticket se calcula con el costo del insumo.
  const appCosto=await page.evaluate((reglas)=>{
    const inv=[{insumo_id:"ins-chica",costo_promedio:3.99},{insumo_id:"ins-grande",costo_promedio:5.63}];
    return{
      chica:costoConsumoTicket(reglas,"ubereats",2,inv,[]),
      grande:costoConsumoTicket(reglas,"ubereats",3,inv,[]),
      mostrador:costoConsumoTicket(reglas,"mostrador",3,inv,[]),
    };
  },REGLAS);
  check("4. cuesta $3.99 la chica, $5.63 la grande y $0 en mostrador",
    Math.abs(appCosto.chica-3.99)<0.01&&Math.abs(appCosto.grande-5.63)<0.01&&appCosto.mostrador===0,appCosto);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
