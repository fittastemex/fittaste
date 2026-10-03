/* Prueba enfocada: guarda de magnitud en la hoja de conteo (v7.30).

   El conteo CONT-20260911-01 metió $1,277,491 de inventario que no existía:

     ENELDO                 1,300 kg  (eran 1.3)   $416,000
     SALSA WINGS GUACAMOLE  3,800 lt  (eran 3.8)   $281,259
     AJO MOLIDO               900 kg  (eran 0.9)   $108,000
     HARINA DE TRIGO        4,300 kg  (eran 4.3)    $94,013

   Nadie pesó 1.3 toneladas de eneldo. Pesaron 1,300 GRAMOS y escribieron 1300
   en un campo que mide kilos. El error no se detectó hasta un mes después.

   Por qué pasó, y no fue descuido: la unidad SÍ estaba en pantalla, en letra
   chica gris, junto al NOMBRE — tres columnas a la izquierda del cuadrito donde
   se teclea. Nadie mira allá al capturar 183 renglones con una báscula en la
   mano.

   v7.30 ataca lo mismo en tres momentos:
     al teclear  — la unidad pegada al campo, y el renglón se pinta en ámbar
     al revisar  — dice qué esperaba el sistema, en la misma unidad
     al cerrar   — los nombra uno por uno y pide confirmación explícita

   Se prueba el umbral y el texto, no sólo que "aparezca algo": una alarma que
   no dice qué hacer se cierra sin leer. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Prov",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[
    // Los dos del 11-sep, con su unidad y existencia reales de entonces.
    {id:"ins-eneldo",nombre:"ENELDO",       unidad_base:"kg",tipo_control:"inventariable",activo:true,preparacion_id:null},
    {id:"ins-salsa", nombre:"SALSA WINGS",  unidad_base:"lt",tipo_control:"inventariable",activo:true,preparacion_id:null},
    // Uno sano, para comprobar que no se grita de más.
    {id:"ins-pollo", nombre:"POLLO",        unidad_base:"g", tipo_control:"inventariable",activo:true,preparacion_id:null},
  ],
  catalogo:[{id:"c-1",sku:"VER-001",articulo:"ENELDO KG",tipo_producto:"VERDURA",unidad_id:"u-kg",
             costo_referencia:320,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-eneldo",
             contenido:1,inventario_almacen_id:null,notas:null}],
  inventario_sucursal:[
    {id:"inv-eneldo",sucursal_id:"suc-1",insumo_id:"ins-eneldo",existencia:1.3,  costo_promedio:320},
    {id:"inv-salsa", sucursal_id:"suc-1",insumo_id:"ins-salsa", existencia:3.8,  costo_promedio:74},
    {id:"inv-pollo", sucursal_id:"suc-1",insumo_id:"ins-pollo", existencia:8000, costo_promedio:0.13},
  ],
  inventario_almacen:[],pedidos:[],pedido_detalle:[],recepciones:[],recepcion_detalle:[],
  movimientos_sucursal:[],movimientos_almacen:[],pedido_proveedor_estatus:[],
  productos_venta:[],recetas:[],ventas:[],venta_detalle:[],mermas:[],
  compras_directas:[],gastos_operativos:[],reglas_consumo_ticket:[],
  producciones:[],produccion_consumo:[],conector_latido:[],
};

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
  console.log("\n== Guarda de magnitud en el conteo: 1,300 kg de eneldo no existen (v7.30) ==");
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));

  // El confirm() de cierre: se captura el texto y se decide qué contestar.
  let textoConfirm=null, respuestaConfirm=false;
  page.on("dialog",async d=>{
    if(d.type()==="confirm")textoConfirm=d.message();
    respuestaConfirm?await d.accept():await d.dismiss();
  });

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
  await page.getByRole("button",{name:new RegExp("Almacén")}).first().click();
  await page.getByRole("button",{name:"Inventario sucursal · merma",exact:true}).click();
  await page.getByRole("button",{name:"Hoja de conteo"}).click();
  await page.getByText(/Conteo físico|Cerrar conteo/).first().waitFor({timeout:10000});

  // ---- 1) La unidad vive junto al campo ----
  // Es la corrección de fondo: la unidad estaba en pantalla y aun así se
  // capturó en gramos sobre un campo en kilos, porque estaba lejos del cursor.
  const celdaEneldo=page.locator("tbody tr").filter({hasText:"ENELDO"}).first();
  const txtCelda=await celdaEneldo.innerText();
  check("1. el renglón de ENELDO muestra su unidad (kg)",/kg/.test(txtCelda),txtCelda);
  const unidadJuntoAlCampo=await celdaEneldo.evaluate(tr=>{
    const inp=tr.querySelector('input[placeholder="—"]');
    if(!inp)return null;
    // El hermano inmediato dentro del mismo contenedor del input.
    return (inp.parentElement.textContent||"").trim();
  });
  check("2. la unidad está PEGADA al campo, no sólo junto al nombre",
        unidadJuntoAlCampo==="kg",unidadJuntoAlCampo);

  // ---- 2) El caso real: 1,300 donde se esperaban 1.3 ----
  const cajas=page.locator('input[placeholder="—"]');
  const nombres=await page.locator("tbody tr").allInnerTexts();
  const idxEneldo=nombres.findIndex(t=>t.includes("ENELDO"));
  await cajas.nth(idxEneldo).fill("1300");
  await page.waitForTimeout(400);

  const trEneldo=await celdaEneldo.innerText();
  check("3. al teclear 1300 el renglón avisa en el acto",/El sistema esperaba/.test(trEneldo),trEneldo);
  check("4. y dice el número esperado en la misma unidad (1.3 kg)",/1\.3\s*kg/.test(trEneldo),trEneldo);

  // ---- 3) Un conteo sano NO debe gritar ----
  const idxPollo=nombres.findIndex(t=>t.includes("POLLO"));
  await cajas.nth(idxPollo).fill("7500");          // teórico 8,000 g: diferencia normal
  await page.waitForTimeout(400);
  const trPollo=await page.locator("tbody tr").filter({hasText:"POLLO"}).first().innerText();
  check("5. un faltante normal no dispara la alarma",!/El sistema esperaba/.test(trPollo),trPollo);

  // ---- 4) Segundo caso real: la salsa ----
  const idxSalsa=nombres.findIndex(t=>t.includes("SALSA WINGS"));
  await cajas.nth(idxSalsa).fill("3800");          // eran 3.8 lt
  await page.waitForTimeout(400);
  const trSalsa=await page.locator("tbody tr").filter({hasText:"SALSA WINGS"}).first().innerText();
  check("6. la salsa (3,800 lt donde había 3.8) también avisa",/El sistema esperaba/.test(trSalsa),trSalsa);

  // ---- 5) Al cerrar: los nombra y se puede CANCELAR ----
  respuestaConfirm=false; textoConfirm=null;
  await page.getByRole("button",{name:/Cerrar conteo/}).click();
  await page.waitForTimeout(1200);
  check("7. cerrar pide confirmación explícita",textoConfirm!==null,textoConfirm);
  check("8. nombra los 2 sospechosos y no el conteo sano",
        /ENELDO/.test(textoConfirm||"")&&/SALSA WINGS/.test(textoConfirm||"")&&!/POLLO/.test(textoConfirm||""),textoConfirm);
  check("9. dice cuánto contaste y cuánto esperaba, con unidad",
        /1,300 kg/.test(textoConfirm||"")&&/1\.3 kg/.test(textoConfirm||""),textoConfirm);
  check("10. explica la causa probable (unidad equivocada)",
        /UNIDAD equivocada/i.test(textoConfirm||""),textoConfirm);
  check("11. al cancelar NO se escribe nada",DB.movimientos_sucursal.length===0,DB.movimientos_sucursal.length);
  const invTrasCancelar=DB.inventario_sucursal.find(i=>i.id==="inv-eneldo");
  check("12. y la existencia queda intacta en 1.3",parseFloat(invTrasCancelar.existencia)===1.3,invTrasCancelar.existencia);

  // ---- 6) Corregir y cerrar: ya no debe preguntar ----
  await cajas.nth(idxEneldo).fill("1.5");
  await cajas.nth(idxSalsa).fill("3.2");
  await page.waitForTimeout(400);
  respuestaConfirm=true; textoConfirm=null;
  await page.getByRole("button",{name:/Cerrar conteo/}).click();
  await page.waitForTimeout(1500);
  check("13. con cantidades corregidas ya no pregunta por magnitud",
        textoConfirm===null||!/UNIDAD equivocada/i.test(textoConfirm),textoConfirm);
  const invFinal=DB.inventario_sucursal.find(i=>i.id==="inv-eneldo");
  check("14. y el conteo sí se cierra (existencia queda en 1.5)",
        parseFloat(invFinal.existencia)===1.5,invFinal.existencia);
  check("15. se escribieron los movimientos de ajuste",DB.movimientos_sucursal.length>0,DB.movimientos_sucursal.length);

  await browser.close();
  const ok=results.filter(r=>r.ok).length;
  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${results.length} verificaciones pasaron`);
  console.log(ok===results.length?"TODAS LAS PRUEBAS PASARON ✓":"HAY FALLAS ✗");
  process.exit(ok===results.length?0:1);
})();
