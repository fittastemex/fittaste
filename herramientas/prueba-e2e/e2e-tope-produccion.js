// Prueba del tope duro de producción (v7.40).
//
// El tope no se puede calibrar a ojo. En octubre hubo cinco producciones
// disparatadas y todas pasaron por un confirm que alguien aceptó. Pero un tope
// mal puesto es peor que no tener tope: si bloquea la producción normal de
// boneless, cocina deja de registrar producción y perdemos la poca disciplina
// que hay.
//
// Por eso esta prueba corre el tope contra las cifras REALES del histórico:
// las cinco que tienen que bloquearse y las legítimas más atípicas, que tienen
// que pasar. Si algún día alguien mueve el umbral, esta prueba dice si lo
// rompió.
const {chromium}=require("/opt/node-tools/node_modules/playwright-core");
const fs=require("fs");

let ok=0,fail=0;
function check(nombre,cond,detalle){
  if(cond){ok++;console.log("  ✓ "+nombre);}
  else{fail++;console.log("  ✗ "+nombre+(detalle!==undefined?"  → "+JSON.stringify(detalle):""));}
}

(async()=>{
  const browser=await chromium.launch({executablePath:process.env.E2E_CHROME||"/opt/pw-browsers/chromium",headless:true});
  const page=await browser.newPage();
  const html=fs.readFileSync("index.html","utf8");

  await page.route("**/*",route=>{
    const url=route.request().url();
    if(url.startsWith("http://fittaste.local/"))return route.fulfill({status:200,contentType:"text/html; charset=utf-8",body:html});
    if(url.includes("react-dom"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react-dom/umd/react-dom.production.min.js","utf8")});
    if(url.includes("/react@"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/react/umd/react.production.min.js","utf8")});
    if(url.includes("babel"))return route.fulfill({status:200,contentType:"application/javascript",body:fs.readFileSync("node_modules/@babel/standalone/babel.min.js","utf8")});
    if(url.includes("cdn.tailwindcss.com"))return route.fulfill({status:200,contentType:"application/javascript",body:"window.tailwind={config:{}};"});
    if(url.includes("fonts.googleapis"))return route.fulfill({status:200,contentType:"text/css",body:""});
    return route.fulfill({status:200,contentType:"application/json",body:"[]"});
  });

  await page.goto("http://fittaste.local/");
  await page.waitForFunction(()=>typeof window.topeProduccion==="function",{timeout:20000})
    .catch(()=>{});

  // Las funciones viven dentro del script de Babel, no en window. Se evalúan
  // reinyectando el bloque de la función, que es lo que de verdad se quiere
  // probar: la lógica, no el DOM.
  const fuente=html.match(/function topeProduccion\(prep[\s\S]*?\n}\n/)[0];
  const fmt=html.match(/const fmtCant=[^\n]*\n/)[0];
  const evalTope=async(prep,producido,historial,rend)=>
    page.evaluate(({fuente,fmt,prep,producido,historial,rend})=>{
      const f=new Function(fmt+fuente+"return topeProduccion(arguments[0],arguments[1],arguments[2],arguments[3]);");
      return f(prep,producido,historial,rend);
    },{fuente,fmt,prep,producido,historial,rend});

  const hist=(prepId,cantidades)=>cantidades.map(c=>({preparacion_id:prepId,cantidad_producida:c}));

  console.log("\n== Lo que TIENE que bloquearse: los cinco de octubre ==");

  // ARROZ AL VAPOR: mediana real 2.00 kg sobre 22 producciones previas
  const arroz={id:"arroz",nombre:"ARROZ AL VAPOR",unidad:"kg"};
  const hArroz=hist("arroz",[1.5,2,2,2,2,2,2,2,2.5,3,3,4.5]);
  let r=await evalTope(arroz,3900,hArroz,1.5);
  check("arroz 3,900 kg se bloquea",!!r,r);
  check("el mensaje dice cuántas veces la normal",/veces/.test(r||""),r);
  check("el mensaje sugiere la corrección",/No ser[áa]n/i.test(r||""),r);

  r=await evalTope(arroz,3600,hArroz,1.5);
  check("arroz 3,600 kg se bloquea",!!r,r);

  const vizc={id:"vizc",nombre:"PORCION VIZCAINA",unidad:"kg"};
  r=await evalTope(vizc,1800,hist("vizc",[1.5,1.63,1.63]),1.5);
  check("vizcaína 1,800 kg se bloquea",!!r,r);

  const dip={id:"dip",nombre:"DIP DE AGUACATE",unidad:"kg"};
  r=await evalTope(dip,1600,hist("dip",[1,1.2,1.4,1.45,1.5,1.5,1.8,2.3]),0.5);
  check("dip de aguacate 1,600 kg se bloquea",!!r,r);

  console.log("\n== Lo que NO debe bloquearse: la producción real de cocina ==");

  // BONELESS rinde 1 porción por tanda: 43 porciones son 43 tandas y es normal.
  // Éste es el caso que un tope por tandas habría roto.
  const bon={id:"bon",nombre:"BONELESS",unidad:"porcion"};
  check("boneless 43 porciones pasa (3 previas)",
    !(await evalTope(bon,43,hist("bon",[10,35,43]),1)));
  check("boneless 43 porciones pasa SIN historia (respaldo por tandas)",
    !(await evalTope(bon,43,[],1)));
  check("boneless 90 porciones sin historia todavía pasa",
    !(await evalTope(bon,90,[],1)));

  // MEZCLA GALLETAS: la legítima más atípica del histórico, 10.8× su mediana
  const gall={id:"gall",nombre:"MEZCLA GALLETAS ORIGINAL",unidad:"lt"};
  check("mezcla galletas 21 lt pasa (10.8× la mediana, es real)",
    !(await evalTope(gall,21,hist("gall",[1.5,1.9,2,2.5]),1.24)));

  check("arroz 4.5 kg pasa (el máximo legítimo)",!(await evalTope(arroz,4.5,hArroz,1.5)));
  check("arroz 2 kg pasa (la producción típica)",!(await evalTope(arroz,2,hArroz,1.5)));
  check("salsa verde 9 lt pasa",
    !(await evalTope({id:"sv",nombre:"SALSA VERDE",unidad:"lt"},9,hist("sv",[5,6,6.35,6.7,9]),6.7)));

  console.log("\n== El borde del umbral ==");
  const borde={id:"b",nombre:"PRUEBA",unidad:"kg"};
  const hBorde=hist("b",[2,2,2]);
  check("30× la mediana todavía pasa",!(await evalTope(borde,60,hBorde,1)));
  check("31× la mediana ya se bloquea",!!(await evalTope(borde,62,hBorde,1)));

  console.log("\n== Respaldo sin historia: tope por tandas en 100 ==");
  const nuevo={id:"n",nombre:"PREPARACIÓN NUEVA",unidad:"lt"};
  check("100 tandas pasan",!(await evalTope(nuevo,100,[],1)));
  check("101 tandas se bloquean",!!(await evalTope(nuevo,101,[],1)));
  check("con 2 producciones previas sigue usando tandas, no mediana",
    !(await evalTope(nuevo,50,hist("n",[1,1]),1)));

  console.log("\n== No rompe lo que ya funcionaba ==");
  check("cantidad 0 no bloquea",!(await evalTope(arroz,0,hArroz,1.5)));
  check("cantidad vacía no bloquea",!(await evalTope(arroz,"",hArroz,1.5)));
  check("sin preparación no truena",!(await evalTope(null,100,[],1)));
  check("rendimiento 0 sin historia no truena",!(await evalTope(nuevo,5000,[],0)));

  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${ok+fail} verificaciones pasaron`);
  if(fail===0)console.log("TODAS LAS PRUEBAS PASARON ✓");
  await browser.close();
  process.exit(fail===0?0:1);
})().catch(e=>{console.error("ERROR FATAL: "+e.message);process.exit(1);});
