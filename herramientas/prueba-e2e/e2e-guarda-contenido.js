/* Prueba enfocada: guarda del contenido de una presentación (v7.30).

   Tres veces el mismo error en dos meses:
     ago  ISO PROTEIN CHOCOLATE valuado en $1,300,398
     sep  el conteo del 11-sep capturado en g sobre campos que miden kg
     oct  siete presentaciones con contenido = 1 inflando $260,000

   Siempre la misma confusión: el PAQUETE y la UNIDAD BASE se miden distinto, y
   `contenido` es el puente entre los dos. Orégano a $85 el gramo es un paquete
   de $85 al que le dijeron que trae un gramo.

   De dónde nacen: `saveNew` crea el insumo con unidad_base = unidad de compra y
   contenido = 1, lo cual es correcto (1 kg por kg). El daño ocurre al re-apuntar
   esa presentación a un insumo medido en GRAMOS: el contenido se queda en 1.

   Lo que se prueba aquí es el juicio de `avisoContenido`, no el formulario: que
   atrape los casos reales que ya costaron dinero y que NO grite en los casos
   legítimos. Una guarda que da falsas alarmas se aprende a ignorar, y entonces
   deja de servir justo el día que tiene razón. */
const fs=require("fs");
const {chromium}=require("playwright");

const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

// [unidad_base, unidad_compra, contenido, precio, debeAvisar, por qué]
const CASOS=[
  // --- Los siete reales de octubre: todos tienen que avisar ---
  ["g","pz",1,85,true,"OREGANO: paquete de $85 'de un gramo'"],
  ["g","pz",1,190,true,"JAMAICA: $190 el gramo"],
  ["g","kg",1,95,true,"CHILE MORITA: se compra en kg y mide en g"],
  ["g","kg",1,30,true,"GUAYABA: se compra en kg y mide en g"],
  ["ml","pz",1,59,true,"ESENCIA AZAHAR: $59 el mililitro"],
  ["g","pz",1,75,true,"PASTA DE CACAHUATE: $75 el gramo"],
  ["ml","pz",1,55,true,"MANTEQUILLA AEROSOL: $55 el mililitro"],

  // --- El de agosto, que ya costó $1,300,398 ---
  ["g","pz",1,609,true,"ISO PROTEIN CHOCOLATE: $609 el gramo"],

  // --- Los mismos, ya corregidos: NO deben avisar ---
  ["g","kg",1000,85,false,"OREGANO corregido: 1 kg = 1000 g"],
  ["g","kg",1000,190,false,"JAMAICA corregida"],
  ["ml","pz",120,59,false,"ESENCIA AZAHAR 120 ml"],
  ["g","pz",510,75,false,"PASTA DE CACAHUATE 510 g"],
  ["ml","pz",170,55,false,"MANTEQUILLA AEROSOL 170 ml"],

  // --- Presentaciones legítimas del catálogo real: NO deben avisar ---
  ["g","kg",1000,130,false,"POLLO: 1 kg a $130"],
  ["g","pz",3000,140,false,"PAPA CAMOTE: costal de 3 kg"],
  ["ml","gal",3800,180,false,"CLARAS DE HUEVO: galón de 3.8 lt"],
  ["g","pz",80,9,false,"PEREJIL: manojo de 80 g a $9"],
  ["g","pz",1272.7,140,false,"PAPA GAJO: bolsa de 1.27 kg"],

  // --- Unidades que NO son g/ml: la guarda no aplica ---
  ["pz","pz",1,8.28,false,"DOMO NEGRO: una pieza es una pieza"],
  ["pz","paq",200,539,false,"EMPAQUE ALMEJA: paquete de 200 piezas"],
  ["rebanada","pz",14,93,false,"PAN: 14 rebanadas por pieza"],
  ["kg","kg",1,320,false,"un insumo medido en kg comprado en kg"],

  // --- Bordes ---
  ["g","pz",1,0,false,"sin precio y contenido 1: no hay con qué juzgar"],
  ["g","pz",0,85,false,"contenido 0 lo cubre su propia validación"],
  ["g","pz",1,4,false,"$4 el gramo: caro pero por debajo del umbral"],
  ["g","pz",1,6,true,"$6 el gramo: ya pasa el umbral"],
  ["g","lt",50,100,true,"se compra en lt y mide en ml/g con contenido chico"],
];

(async()=>{
  console.log("\n== Guarda del contenido: que un paquete no traiga un gramo (v7.30) ==");
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));
  await page.route("**/*",async route=>{
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
  await page.waitForFunction(()=>typeof avisoContenido==="function",{timeout:20000});

  // Se evalúa contra la función REAL de index.html, no contra una copia aquí:
  // si alguien cambia el umbral, esta prueba lo dice.
  const obtenidos=await page.evaluate((casos)=>
    casos.map(([ub,uc,cont,pre])=>avisoContenido(ub,uc,cont,pre)),
    CASOS.map(c=>[c[0],c[1],c[2],c[3]]));

  let i=1;
  for(const[idx,[ub,uc,cont,pre,debe,porque]]of CASOS.entries()){
    const aviso=obtenidos[idx];
    const avisó=aviso!==null&&aviso!==undefined;
    check(`${i}. ${debe?"avisa":"calla"} — ${porque}`,avisó===debe,{aviso,esperado:debe});
    i++;
  }

  // El texto tiene que decir qué hacer, no sólo que algo está mal.
  const txtKg=obtenidos[CASOS.findIndex(c=>c[5].startsWith("CHILE MORITA"))];
  check(`${i++}. el aviso de kg→g propone el número correcto`,/1000 g/.test(txtKg||""),txtKg);
  const txtPrecio=obtenidos[CASOS.findIndex(c=>c[5].startsWith("OREGANO: paquete"))];
  check(`${i++}. el aviso de precio dice cuánto costaría el kilo`,/por kg/.test(txtPrecio||""),txtPrecio);
  check(`${i++}. y nombra el costo por unidad, no sólo el total`,/\$85\.00/.test(txtPrecio||""),txtPrecio);

  await browser.close();
  const ok=results.filter(r=>r.ok).length;
  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${results.length} verificaciones pasaron`);
  console.log(ok===results.length?"TODAS LAS PRUEBAS PASARON ✓":"HAY FALLAS ✗");
  process.exit(ok===results.length?0:1);
})();
