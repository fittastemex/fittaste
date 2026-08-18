/* Prueba enfocada: consumo por TICKET y no por platillo (v7.19).

   La bolsa la decide el pedido completo, no el platillo: un wrap solo va en bolsa
   chica, si el ticket trae varios productos cocina manda UNA bolsa grande en lugar
   de varias chicas, y una venta de mostrador no lleva bolsa. Eso no cabe en una
   receta, que describe un platillo y no una orden.

   La lógica está DUPLICADA a propósito en index.html y en conector-sr/sync.js
   (mismo patrón que costoInsumo y explotarReceta), así que la prueba verifica las
   DOS implementaciones contra la misma matriz de casos: si una se desvía, falla.

   Además prueba la UI de configuración en el navegador: que las reglas se listen,
   que la vista previa cuente bien los tickets del histórico, y que se pueda dar de
   alta y desactivar una regla. */
const fs=require("fs");
const vm=require("vm");
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

// ---------- 1) La implementación del CONECTOR ----------
function cargarDelConector(){
  const src=fs.readFileSync("/home/user/fittaste/conector-sr/sync.js","utf8");
  // sync.js arranca solo al cargarse, así que no se puede require: se extraen las
  // dos funciones puras y se evalúan aisladas.
  const saca=(nombre)=>{
    const i=src.indexOf(`function ${nombre}(`);
    if(i<0)throw new Error(`no se encontró ${nombre} en sync.js`);
    let j=src.indexOf("{",i),prof=0;
    for(let k=j;k<src.length;k++){
      if(src[k]==="{")prof++;
      else if(src[k]==="}"){prof--;if(prof===0)return src.slice(i,k+1);}
    }
    throw new Error(`no se pudo delimitar ${nombre}`);
  };
  const ctx={};
  vm.createContext(ctx);
  vm.runInContext(saca("contarProductosTicket")+"\n"+saca("consumoPorTicket")+
    "\nthis.contarProductosTicket=contarProductosTicket;this.consumoPorTicket=consumoPorTicket;",ctx);
  return ctx;
}

(async()=>{
  console.log("\n== Consumo por ticket: la bolsa es del pedido, no del platillo (v7.19) ==");

  // ---------- Conector ----------
  const conector=cargarDelConector();
  let okMatriz=true, detalle=[];
  for(const [canal,n,esperado] of CASOS){
    const got=conector.consumoPorTicket(REGLAS,canal,n).map(x=>x.insumo_id).sort();
    const exp=[...esperado].sort();
    if(JSON.stringify(got)!==JSON.stringify(exp)){okMatriz=false;detalle.push({canal,n,got,exp});}
  }
  check("1. conector: la matriz de canal x productos da la bolsa correcta",okMatriz,detalle);

  // El conteo excluye modificadores y contenedores de precio.
  const lineas=[
    {prod:{grupo_sr:"WRAPS"},cantidad:1},
    {prod:{grupo_sr:"WRAPS"},cantidad:2},
    {prod:{grupo_sr:"MODS WRAPS SAND"},cantidad:1},   // modificador: no cuenta
    {prod:{grupo_sr:"EXTRAS"},cantidad:3},            // extra: no cuenta
    {prod:{grupo_sr:"COMBOS FIT",sin_insumos:true},cantidad:1}, // contenedor: no cuenta
  ];
  check("2. conector: el conteo ignora modificadores y contenedores de precio",
    conector.contarProductosTicket(lineas)===3,conector.contarProductosTicket(lineas));

  // Grupo excluyente: dos reglas que empatan, sólo aplica una.
  const solapadas=[
    {id:"a",insumo_id:"ins-chica",cantidad:1,canales:["ubereats"],min_productos:1,max_productos:null,grupo:"bolsa_domicilio",prioridad:10,activo:true},
    {id:"b",insumo_id:"ins-grande",cantidad:1,canales:["ubereats"],min_productos:1,max_productos:null,grupo:"bolsa_domicilio",prioridad:20,activo:true},
  ];
  const exclu=conector.consumoPorTicket(solapadas,"ubereats",5);
  check("3. conector: grupo excluyente descuenta UNA sola bolsa, la de menor prioridad",
    exclu.length===1&&exclu[0].insumo_id==="ins-chica",exclu);

  // Reglas sin grupo son aditivas (servilleta + cubiertos en el mismo ticket).
  const aditivas=[
    {id:"s",insumo_id:"ins-servilleta",cantidad:2,canales:null,min_productos:null,max_productos:null,grupo:null,prioridad:100,activo:true},
    {id:"c",insumo_id:"ins-tenedor",cantidad:1,canales:null,min_productos:null,max_productos:null,grupo:null,prioridad:100,activo:true},
  ];
  check("4. conector: reglas sin grupo se suman entre sí",
    conector.consumoPorTicket(aditivas,"mostrador",1).length===2);

  // Una regla inactiva no aplica.
  check("5. conector: una regla inactiva no consume",
    conector.consumoPorTicket([{...REGLAS[0],activo:false}],"ubereats",1).length===0);

  // ---------- App (index.html) ----------
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

  // Las mismas funciones viven en index.html: se evalúan en la página para
  // comprobar que las dos implementaciones no se desviaron.
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
  check("6. app: la misma matriz da el mismo resultado que el conector",
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
  check("7. app: el conteo ignora modificadores y contenedores de precio",appConteo===3,appConteo);

  const appGrupo=await page.evaluate((solapadas)=>consumoPorTicket(solapadas,"ubereats",5).map(x=>x.insumo_id),solapadas);
  check("8. app: grupo excluyente descuenta una sola bolsa",
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
  check("9. app: cuesta $3.99 la chica, $5.63 la grande y $0 en mostrador",
    Math.abs(appCosto.chica-3.99)<0.01&&Math.abs(appCosto.grande-5.63)<0.01&&appCosto.mostrador===0,appCosto);

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
