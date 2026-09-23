@echo off
rem ============================================================
rem  REVISION PERIODICA DEL VIGILANTE
rem ============================================================
rem  vigilante.bat resuelve que el conector se caiga: lo vuelve a
rem  levantar solo. Lo que NO resuelve es que alguien cierre la
rem  ventana del vigilante, que es justo lo que pasa en una barra
rem  ocupada cuando se estan cerrando ventanas.
rem
rem  Esto corre cada 15 minutos desde el Programador de tareas y
rem  pregunta una sola cosa: ¿sigue abierta la ventana que se
rem  llama ConectorFitTaste? Si no, la abre.
rem
rem  Se busca por TITULO y no por node.exe a proposito: entre un
rem  reintento y otro el vigilante pasa 30 segundos sin node
rem  corriendo, y buscar node.exe levantaria un segundo vigilante
rem  en esa ventana. Dos vigilantes no duplican ventas (el
rem  conector descarta folios repetidos) pero se pelean por
rem  estado-sync.json, y eso si ensucia.
rem ============================================================

tasklist /v /fi "imagename eq cmd.exe" 2>nul | find /i "ConectorFitTaste" >nul

if errorlevel 1 (
  echo [%date% %time%] El vigilante no estaba corriendo. Lo arranco. >> C:\fittaste\conector-sr\conector.log
  start "" "C:\fittaste\conector-sr\vigilante.bat"
)
