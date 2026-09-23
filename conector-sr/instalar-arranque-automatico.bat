@echo off
rem ============================================================
rem  INSTALACION DEL ARRANQUE AUTOMATICO
rem ============================================================
rem  Se corre UNA SOLA VEZ, con clic derecho >
rem  "Ejecutar como administrador".
rem
rem  Deja dos tareas programadas en Windows:
rem
rem    1. "Conector FitTaste"          - al iniciar sesion
rem    2. "Conector FitTaste revision" - cada 15 minutos
rem
rem  Entre las dos y el reintento que ya trae vigilante.bat, las
rem  tres formas en que el conector se ha muerto quedan cubiertas:
rem
rem    se cayo node          -> vigilante.bat lo levanta a los 30s
rem    reiniciaron la PC     -> tarea 1, al iniciar sesion
rem    cerraron la ventana   -> tarea 2, en menos de 15 minutos
rem ============================================================

title Instalando el arranque automatico del Conector FitTaste

net session >nul 2>&1
if errorlevel 1 (
  echo.
  echo   ERROR: esto necesita permisos de administrador.
  echo.
  echo   Cierra esta ventana, busca el archivo en la carpeta,
  echo   dale CLIC DERECHO y elige "Ejecutar como administrador".
  echo.
  pause
  exit /b 1
)

if not exist "C:\fittaste\conector-sr\vigilante.bat" (
  echo.
  echo   ERROR: no encuentro C:\fittaste\conector-sr\vigilante.bat
  echo   Copia primero la carpeta completa del conector.
  echo.
  pause
  exit /b 1
)

echo.
echo   Registrando las tareas...
echo.

schtasks /Create /F /TN "Conector FitTaste" ^
  /TR "\"C:\fittaste\conector-sr\vigilante.bat\"" ^
  /SC ONLOGON /RL HIGHEST

schtasks /Create /F /TN "Conector FitTaste revision" ^
  /TR "\"C:\fittaste\conector-sr\revisar.bat\"" ^
  /SC MINUTE /MO 15 /RL HIGHEST

echo.
echo   ============================================
echo   Listo. Arrancando el conector ahora mismo.
echo   ============================================
echo.

start "" "C:\fittaste\conector-sr\vigilante.bat"

echo   Debe haberse abierto una ventana negra llamada
echo   ConectorFitTaste. Puedes minimizarla.
echo.
echo   Si la cierras por error, se vuelve a abrir sola
echo   en menos de 15 minutos.
echo.
pause
