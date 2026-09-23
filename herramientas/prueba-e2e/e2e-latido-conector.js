/* Prueba enfocada: semáforo del conector (v7.28).

   Reporte de dirección (2026-09-23): "Hola veo que no ha actualizado las ventas
   el conector, pasó algo?"

   Había muerto el domingo 13-sep a las 15:44. Nos enteramos diez días después,
   ~500 tickets y ~$140,000 de venta más tarde. El proceso no falló: se apagó la
   PC un domingo y nadie lo volvió a abrir — la cuarta vez que pasa (29-jul,
   7-ago, 17-ago, 13-sep).

   Lo que convirtió diez minutos en diez días es que desde fuera un conector
   muerto se ve IGUAL que un día flojo: en ambos casos entran pocas ventas. El
   semáforo rompe ese empate mirando el latido, no las ventas.

   Se prueba aquí y no contra la base porque lo que puede fallar es el juicio de
   la pantalla, no el SQL: que un latido viejo se pinte de verde, o que la
   ausencia total de latido se lea como "todo bien". Un semáforo que se equivoca
   de color es peor que no tenerlo, porque se deja de mirar el dato real.

   Los cuatro estados que tienen que distinguirse:
     sin fila          -> gris/rojo: nunca ha reportado, falta instalarlo
     latido < 15 min   -> verde: trabajando
     latido con ok:false-> ámbar: vivo pero atorado (NO es la PC, es SR o la red)
     latido >= 15 min  -> rojo: muerto, hay que ir a la sucursal

   El ámbar contra el rojo es el que de verdad importa: mandan a lugares
   distintos. Confundirlos hace que alguien maneje a la sucursal para mirar una
   ventana que estaba perfectamente abierta. */
const fs=require("fs");
const {chromium}=require("playwright");

let genN=0;
const hace=(min)=>new Date(Date.now()-min*60000).toISOString();

const BASE={
  unidades_medida:[{id:"u-kg",clave:"kg",nombre:"Kilogramo",tipo:"peso",activa:true}],
  tipos_flujo_costo:[{id:"tf-m",nombre:"Compra manual",quien_captura_precio:"compras",proveedor_ve_pedido:false,costo_editable:true}],
  sucursales:[{id:"suc-1",nombre:"Roma",activa:true}],
  proveedores:[{id:"prov-1",nombre:"Prov",tipo_flujo_id:"tf-m",activo:true}],
  insumos:[{id:"i-jit",nombre:"JITOMATE",unidad_base:"g",tipo_control:"inventariable",activo:true,preparacion_id:null}],
  // La app exige al menos un artículo de catálogo: con cero muestra "Sin datos.
  // Verifica SQL y permisos" y nunca llega al dashboard.
  catalogo:[{id:"c-jit",sku:"VER-001",articulo:"JITOMATE KG",tipo_producto:"VERDURA",unidad_id:"u-kg",
             costo_referencia:20,proveedor_id:"prov-1",aplica_iva:false,activo:true,insumo_id:"i-jit",
             contenido:1000,inventario_almacen_id:null,notas:null}],
  inventario_sucursal:[],inventario_almacen:[],
  pedidos:[],pedido_detalle:[],recepciones:[],movimientos_sucursal:[],
  productos_venta:[],recetas:[],ventas:[],venta_detalle:[],mermas:[],
  compras_directas:[],gastos_operativos:[],reglas_consumo_ticket:[],
  producciones:[],produccion_consumo:[],
  movimientos_almacen:[],pedido_proveedor_estatus:[],recepcion_detalle:[],
  conector_latido:[],
};

let DB;
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
  // Esta prueba mira UNA pantalla. Una tabla que no esté en el simulador se
  // responde vacía en vez de 404, para que el dashboard no se caiga por algo
  // ajeno al semáforo; se avisa en consola para que no pase inadvertida.
  if(!(table in DB)){
    if(method==="GET"){console.log(`  [aviso] tabla no simulada, devuelvo vacío: ${table}`);return{status:200,body:"[]"};}
    return{status:404,body:JSON.stringify({message:`tabla ${table} no existe`})};
  }
  const params=[...new URLSearchParams(search).entries()];
  if(method==="GET")return{status:200,body:JSON.stringify(DB[table].filter(r=>matchFilters(r,params)))};
  if(method==="POST"){
    const arr=Array.isArray(body)?body:[body];
    const ins=arr.map(r=>{const row={...r};if(!row.id)row.id="gen-"+(++genN);DB[table].push(row);return row;});
    return{status:201,body:JSON.stringify(ins)};
  }
  if(method==="PATCH"){const upd=[];DB[table]=DB[table].map(r=>{if(matchFilters(r,params)){const nr={...r,...body};upd.push(nr);return nr;}return r;});return{status:200,body:JSON.stringify(upd)};}
  if(method==="DELETE"){DB[table]=DB[table].filter(r=>!matchFilters(r,params));return{status:204,body:""};}
  return{status:405,body:"{}"};
}

const results=[];
const check=(n,c,e)=>{results.push({n,ok:!!c});console.log((c?"  ✓ ":"  ✗ ")+n+(c?"":`  [${JSON.stringify(e)}]`));};

(async()=>{
  console.log("\n== Semáforo del conector: enterarse en minutos, no en días (v7.28) ==");
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
      const res=handleRest(m,rest[1],rest[3]||"",body);return route.fulfill({status:res.status,contentType:"application/json",body:res.body});}
    return route.fulfill({status:200,contentType:"text/plain",body:""});
  });

  // Entra al dashboard con el latido que le pongamos, y devuelve el texto y el
  // color del recuadro. El color se lee de las clases de Tailwind porque es lo
  // que de verdad ve alguien que cruza la oficina sin detenerse a leer.
  const verSemaforo=async(latido,ventas)=>{
    DB=JSON.parse(JSON.stringify(BASE));
    if(latido)DB.conector_latido=[latido];
    if(ventas)DB.ventas=ventas;
    await page.goto("http://fittaste.local/index.html");
    await page.getByText("Selecciona tu rol").waitFor({timeout:20000});
    await page.getByText("Acceso total").first().click();
    await page.locator("input[type=password]").fill("fittaste2026");
    await page.getByRole("button",{name:"Ingresar"}).click();
    // Al entrar como admin la app aterriza en el Dashboard de ventas: no hay
    // que navegar. Eso importa — es la pantalla que dirección ve al abrir.
    await page.getByText("Dashboard de ventas").first().waitFor({timeout:20000});
    await page.waitForTimeout(500);
    return await page.evaluate(()=>{
      const d=[...document.querySelectorAll("div")].find(x=>/Conector|conector/.test(x.textContent||"")&&/border rounded-xl/.test(x.className||""));
      if(!d)return null;
      const cls=d.className;
      return{texto:d.textContent.replace(/\s+/g," ").trim(),
             color:/red/.test(cls)?"rojo":/amber/.test(cls)?"ambar":/emerald/.test(cls)?"verde":"?"};
    });
  };

  // ---------- 1) Sin latido: el respaldo por última venta ----------
  // El caso de HOY. La PC trae el sync viejo y no late, así que el semáforo
  // tiene que seguir sirviendo mirando la venta. Si esto no funcionara, la
  // pantalla no valdría nada hasta que alguien viaje a la sucursal.
  const ventaHace=(min,origen)=>[{id:"v1",folio:"TKT-1",origen,fecha:"2026-09-13",total:300,
                                  created_at:hace(min),sucursal_id:"suc-1",canal:"mostrador"}];

  // 1a. Sin latido y SIN ventas: no hay nada que decir, y una alarma inventada
  //     en una base recién montada enseña a ignorar el recuadro.
  let s=await verSemaforo(null,[]);
  check("1. sin latido y sin ventas, no inventa una alarma",s===null,s);

  // 1b. Sin latido y con venta reciente: todo normal, tampoco alarma.
  s=await verSemaforo(null,ventaHace(30,"api"));
  check("2. sin latido pero con venta de hace 30 min, no alarma",s===null,s);

  // 1c. El caso real del 13-sep, sin latido: 10 días sin ventas del conector.
  s=await verSemaforo(null,ventaHace(10*24*60,"api"));
  check("3. sin latido y 10 días sin ventas, alarma ROJA",s&&s.color==="rojo",s);
  check("4. lo cuenta en días",s&&/hace 10 días/.test(s.texto),s&&s.texto);
  check("5. dice que no se pierden los tickets",s&&/no se pierden/i.test(s.texto),s&&s.texto);
  check("6. avisa que se está guiando por la venta y no por el latido",
        s&&/todavía no reporta latido/i.test(s.texto),s&&s.texto);

  // 1d. LA REGRESIÓN QUE MOTIVÓ EL CAMBIO: la alarma vieja filtraba
  //     `origen==="api"`. El sync v7.27 escribe 'api_v2', así que se habría
  //     apagado sola el día del despliegue. Con 'api_v2' tiene que alarmar igual.
  s=await verSemaforo(null,ventaHace(10*24*60,"api_v2"));
  check("7. con ventas 'api_v2' la alarma sigue funcionando (no se apaga al desplegar v7.27)",
        s&&s.color==="rojo",s);

  // ---------- 2) Latido fresco y trabajando ----------
  s=await verSemaforo({sucursal_id:"suc-1",visto_en:hace(1),version:"v7.28",host:"POS-ROMA",
                       ultimo_cierre:hace(3),ultimo_resultado:{ok:true,subidos:4,fallidos:0,revisados:4}});
  check("8. latido de hace 1 min se pinta VERDE",s&&s.color==="verde",s);
  check("9. dice que está activo",s&&/Conector activo/i.test(s.texto),s&&s.texto);
  check("10. muestra hace cuánto se vio",s&&/hace 1 min/.test(s.texto),s&&s.texto);
  check("11. muestra los tickets del último ciclo",s&&/4 tickets/.test(s.texto),s&&s.texto);
  check("12. muestra la versión que corre en la PC",s&&/v7\.28/.test(s.texto),s&&s.texto);

  // ---------- 3) Vivo pero atorado ----------
  // SoftRestaurant caído o la red fuera. El conector SÍ está abierto: mandar a
  // alguien a la sucursal a mirarlo sería un viaje perdido.
  s=await verSemaforo({sucursal_id:"suc-1",visto_en:hace(2),version:"v7.28",host:"POS-ROMA",
                       ultimo_resultado:{ok:false,fallos_seguidos:5,error:"Failed to connect to 26.0.0.1:1433"}});
  check("13. latido fresco pero fallando se pinta ÁMBAR, no verde",s&&s.color==="ambar",s);
  check("14. dice que está vivo pero no puede trabajar",s&&/vivo pero no puede trabajar/i.test(s.texto),s&&s.texto);
  check("15. manda a SoftRestaurant o la red, NO a la PC",s&&/revisa SoftRestaurant/i.test(s.texto),s&&s.texto);
  check("16. muestra cuántos intentos seguidos lleva fallando",s&&/5 intentos/.test(s.texto),s&&s.texto);
  check("17. incluye el error para poder diagnosticarlo de lejos",s&&/1433/.test(s.texto),s&&s.texto);

  // ---------- 4) Muerto ----------
  // 20 minutos = diez ciclos perdidos. Ya no es red lenta.
  s=await verSemaforo({sucursal_id:"suc-1",visto_en:hace(20),version:"v7.28",host:"POS-ROMA",
                       ultimo_resultado:{ok:true,subidos:0,fallidos:0,revisados:0}});
  check("18. a los 20 min sin latir se pinta ROJO",s&&s.color==="rojo",s);
  check("19. avisa explícitamente que las ventas NO están subiendo",s&&/ventas NO están subiendo/i.test(s.texto),s&&s.texto);
  check("20. manda a la PC de la sucursal",s&&/ir a la PC/i.test(s.texto),s&&s.texto);

  // ---------- 5) El caso real: diez días ----------
  s=await verSemaforo({sucursal_id:"suc-1",visto_en:hace(10*24*60),version:"v7.27",host:"POS-ROMA",
                       ultimo_resultado:{ok:true,subidos:1,fallidos:0,revisados:1}});
  check("21. diez días sin latir se pinta ROJO",s&&s.color==="rojo",s);
  check("22. y lo cuenta en días, no en 14400 minutos",s&&/hace 10 días/.test(s.texto),s&&s.texto);

  // ---------- 6) El borde ----------
  // Justo por debajo del umbral: una red lenta no debe disparar la alarma.
  s=await verSemaforo({sucursal_id:"suc-1",visto_en:hace(14),version:"v7.28",host:"POS-ROMA",
                       ultimo_resultado:{ok:true,subidos:0,fallidos:0,revisados:0}});
  check("23. a los 14 min sigue VERDE (no alarmar por una red lenta)",s&&s.color==="verde",s);
  // Un ciclo sin tickets no es un problema: a media tarde puede no haber venta.
  check("24. un ciclo sin tickets no inventa un problema",s&&!/no están subiendo/i.test(s.texto),s&&s.texto);

  await browser.close();
  const ok=results.filter(r=>r.ok).length;
  console.log("\n================ RESULTADO ================");
  console.log(`${ok}/${results.length} verificaciones pasaron`);
  console.log(ok===results.length?"TODAS LAS PRUEBAS PASARON ✓":"HAY FALLAS ✗");
  process.exit(ok===results.length?0:1);
})();
