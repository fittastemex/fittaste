/* Prueba enfocada: la receta se guarda EN DOS PASOS (v7.22).

   Bug que cubre: cada casilla de cantidad y de merma se guardaba en `onBlur`.
   Teclear y hacer clic afuera ya escribía en la base — sin botón, sin
   confirmar y sin forma de deshacer. Un dedazo quedaba grabado en silencio, y
   es la explicación más probable de las cantidades absurdas que salieron en el
   análisis de recetas del 2026-08-22:

     · ESENCIA MENTA        0.001 ml en CHOCOMENTA SHAKE
     · VINAGRETA DULCE      1 LITRO por ensalada ($71 de vinagreta en un
                            platillo de $145), en 3 recetas que venden
     · DIP DE AGUACATE      0.01 kg = 10 g de guacamole en WRAP DE POLLO

   Las dos familias de error son opuestas y tienen el mismo origen: nadie
   confirmó nada. Y ninguna la ve el ⚠, que sólo compara el costo promedio
   contra el catálogo: la cantidad de la receta no entra en esa comparación.

   Verifica: (1) sin apretar "Editar receta" la cantidad NO es editable,
   (2) lo teclado NO llega a la base hasta apretar "Guardar cambios",
   (3) "Cancelar" descarta y deja el valor original,
   (4) un cambio de magnitud (×10 o más) y una cantidad en cero PIDEN
       confirmación antes de guardar,
   (5) al guardar se escribe sólo lo que cambió. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const DB={
  unidades_medida:[
    {id:"u-pz",clave:"pz",nombre:"Pieza",tipo:"conteo",activa:true},
    {id:"u-lt",clave:"lt",nombre:"Litro",tipo:"volumen",activa:true},
  ],
  tipos_flujo_costo:[{id:"tf-prov",nombre:"Proveedor externo",quien_captura_precio:"proveedor",proveedor_ve_pedido:true,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Distribuidora Fit",tipo_flujo_id:"tf-prov",activo:true}],
  insumos:[
    {id:"ins-lechuga",nombre:"LECHUGA ITALIANA",unidad_base:"g",tipo_control:"inventariable",activo:true},
    {id:"ins-aceite",nombre:"ACEITE DE OLIVA",unidad_base:"ml",tipo_control:"inventariable",activo:true},
  ],
  catalogo:[
    {id:"cat-lechuga",sku:"VER-001",articulo:"LECHUGA KG",tipo_producto:"VERDURA",unidad_id:"u-pz",costo_referencia:100,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-lechuga",contenido:1000,inventario_almacen_id:null,notas:null},
    {id:"cat-aceite",sku:"ABA-001",articulo:"ACEITE 1 LT",tipo_producto:"ABARROTES",unidad_id:"u-lt",costo_referencia:400,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"ins-aceite",contenido:1000,inventario_almacen_id:null,notas:null},
  ],
  // La ensalada arranca con la cantidad CORRECTA: 30 g de lechuga. La prueba
  // intenta convertirla en 300 (×10) y en 0, que son los dos dedazos reales.
  productos_venta:[{id:"prod-ens",codigo_sr:"06001",nombre:"ENSALADA DE PRUEBA",grupo_sr:"ENSALADAS",precio_venta:145,activo:true,es_preparacion:false,sin_insumos:false}],
  recetas:[
    {id:"rec-1",producto_venta_id:"prod-ens",insumo_id:"ins-lechuga",preparacion_id:null,cantidad:30,merma_pct:0},
    {id:"rec-2",producto_venta_id:"prod-ens",insumo_id:"ins-aceite",preparacion_id:null,cantidad:10,merma_pct:0},
  ],
  inventario_almacen:[],lotes_almacen:[],
  pedidos:[],pedido_detalle:[],pedido_proveedor_estatus:[],
  categorias_gastos:[],inventario_almacen_mov:[],movimientos_almacen:[],salidas_peps:[],
  recepciones:[],recepcion_detalle:[],cuentas_por_pagar:[],pagos:[],compras_directas:[],
  gastos_operativos:[],inventario_sucursal:[],ventas:[],venta_detalle:[],mermas:[],
  movimientos_sucursal:[],reglas_consumo_ticket:[],
};
const DEFAULTS={
  insumos:{activo:true,unidad_base:"pz",tipo_control:"inventariable"},
  catalogo:{activo:true,contenido:1,costo_referencia:0},
  recetas:{merma_pct:0},
};
function matchFilters(row,params){
  for(const[k,v]of params){
    if(["select","order","limit","offset"].includes(k))continue;
    if(v.startsWith("eq."))       {if(String(row[k])!==v.slice(3))return false;}
    else if(v.startsWith("in.(")) {const l=v.slice(4,-1).split(",");if(!l.includes(String(row[k])))return false;}
    else if(v==="not.is.null")    {if(row[k]==null)return false;}
  }
  return true;
}
// Cuenta de PATCH por tabla: así se comprueba que teclear NO escribe.
const patches=[];
function handleRest(method,table,search,body){
  if(!(table in DB))return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  const params=[...new URLSearchParams(search).entries()];
  if(method==="GET")return{status:200,body:JSON.stringify(DB[table].filter(r=>matchFilters(r,params)))};
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    const ins=arr.map(r=>{const row={...(DEFAULTS[table]||{}),...r};if(!row.id)row.id="gen-"+(++genN);DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){
    patches.push({table,body,search});
    const upd=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};upd.push(nr);return nr;}return r;});
    return{status:200,body:JSON.stringify(upd)};
  }
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}
const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};
const cant=(id)=>parseFloat(DB.recetas.find(r=>r.id===id).cantidad);
const patchesRecetas=()=>patches.filter(p=>p.table==="recetas").length;

(async()=>{
  console.log("\n== Editar receta: nada se guarda hasta apretar Guardar (v7.22) ==");
  const html=fs.readFileSync("/home/user/fittaste/index.html","utf8");
  const browser=await chromium.launch({executablePath:"/opt/pw-browsers/chromium-1194/chrome-linux/chrome",headless:true});
  const page=await(await browser.newContext()).newPage();
  page.on("pageerror",e=>console.log("  [pageerror]",e.message));

  // Los confirm() son parte de lo que se prueba: se registran y se responden
  // según lo que pida cada caso.
  let dialogos=[];let respuesta=true;
  page.on("dialog",async d=>{dialogos.push(d.message());respuesta?await d.accept():await d.dismiss();});

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

  await page.getByRole("button",{name:new RegExp("Catálogos")}).first().click();
  const itProd=page.getByRole("button",{name:"Productos y recetas",exact:true});
  try{await itProd.waitFor({timeout:2000});await itProd.click();}catch(e){}
  await page.getByRole("button",{name:/Platillos \(/}).waitFor({timeout:10000});

  // Abrir la receta de la ensalada
  // En platillos el botón dice "N insumos"; en preparaciones, "N ingredientes".
  await page.getByRole("button",{name:/2 insumos/}).click();
  await page.getByText("Receta de ENSALADA DE PRUEBA").waitFor({timeout:5000});
  const bloque=page.locator("td").filter({hasText:"Receta de ENSALADA DE PRUEBA"});

  // ---- 1) En reposo la cantidad NO se puede teclear ----
  const inputsEnReposo=await bloque.locator("input[type=number]").count();
  check("1. sin 'Editar receta' no hay casillas para teclear",inputsEnReposo===0,inputsEnReposo);
  check("2. el botón 'Editar receta' está a la vista",
    await page.getByRole("button",{name:/Editar receta/}).isVisible());

  // ---- 2) Teclear NO escribe en la base ----
  await page.getByRole("button",{name:/Editar receta/}).click();
  const cajas=bloque.locator("input[type=number]");
  await cajas.nth(0).fill("31");            // cambio pequeño: no dispara aviso
  await cajas.nth(2).fill("11");            // el 2º renglón (0=cant,1=merma,2=cant)
  await page.waitForTimeout(400);
  check("3. teclear NO manda nada a la base",patchesRecetas()===0,patches.map(p=>p.table));
  check("4. la base conserva los valores originales (30 y 10)",
    cant("rec-1")===30&&cant("rec-2")===10,{l:cant("rec-1"),a:cant("rec-2")});
  check("5. la pantalla avisa que hay cambios sin guardar",
    await page.getByText(/cambios? sin guardar/).isVisible());

  // ---- 3) Cancelar descarta ----
  await page.getByRole("button",{name:"Cancelar"}).click();
  await page.waitForTimeout(300);
  check("6. Cancelar no escribió nada",patchesRecetas()===0,patchesRecetas());
  check("7. tras Cancelar la receta sigue en 30 y 10",
    cant("rec-1")===30&&cant("rec-2")===10,{l:cant("rec-1"),a:cant("rec-2")});
  check("8. tras Cancelar ya no hay casillas editables",
    await bloque.locator("input[type=number]").count()===0);

  // ---- 4) Un cambio de magnitud pide confirmación ----
  dialogos=[];respuesta=false;   // el usuario dice "no" en el confirm
  await page.getByRole("button",{name:/Editar receta/}).click();
  await bloque.locator("input[type=number]").nth(0).fill("300");   // ×10
  await page.getByRole("button",{name:/Guardar cambios/}).click();
  await page.waitForTimeout(500);
  check("9. un cambio ×10 pide confirmación antes de guardar",
    dialogos.length===1&&/×10|x10/i.test(dialogos[0]),dialogos);
  check("10. el aviso dice el antes → después y su costo",
    dialogos.length===1&&/30/.test(dialogos[0])&&/300/.test(dialogos[0])&&/\$/.test(dialogos[0]),dialogos[0]);
  check("11. al responder que no, la receta NO cambió",
    cant("rec-1")===30&&patchesRecetas()===0,{v:cant("rec-1"),p:patchesRecetas()});

  // ---- 5) Cantidad en cero también pide confirmación ----
  dialogos=[];respuesta=false;
  await bloque.locator("input[type=number]").nth(0).fill("0");
  await page.getByRole("button",{name:/Guardar cambios/}).click();
  await page.waitForTimeout(500);
  check("12. poner una cantidad en 0 pide confirmación",
    dialogos.length===1&&/deja de costear|no se ve/i.test(dialogos[0]),dialogos);
  check("13. al responder que no, sigue en 30",cant("rec-1")===30,cant("rec-1"));

  // ---- 6) Guardar de verdad escribe SÓLO lo que cambió ----
  dialogos=[];respuesta=true;
  await bloque.locator("input[type=number]").nth(0).fill("35");   // cambio razonable
  await page.getByRole("button",{name:/Guardar cambios/}).click();
  await page.waitForTimeout(700);
  check("14. un cambio razonable NO pide confirmación",dialogos.length===0,dialogos);
  check("15. Guardar escribió la línea que cambió",cant("rec-1")===35,cant("rec-1"));
  check("16. NO tocó la línea que no cambió",cant("rec-2")===10,cant("rec-2"));
  check("17. fue UN solo PATCH, no uno por tecla",patchesRecetas()===1,patchesRecetas());
  check("18. el acuse aparece dentro del editor",
    await page.getByText(/1 línea guardada/).isVisible());

  await browser.close();
  const fails=results.filter(r=>!r.ok);
  console.log("\n================ RESULTADO ================");
  console.log(`${results.length-fails.length}/${results.length} verificaciones pasaron`);
  if(fails.length){console.log("FALLARON:");fails.forEach(f=>console.log("  ✗",f.n));process.exit(1);}
  console.log("TODAS LAS PRUEBAS PASARON ✓");
})().catch(e=>{console.error("ERROR FATAL:",e.message);process.exit(2);});
