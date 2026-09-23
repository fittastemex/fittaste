@echo off
rem ============================================================
rem  VIGILANTE DEL CONECTOR FITTASTE
rem ============================================================
rem  Por que existe este archivo:
rem
rem  El conector murio cuatro veces (29-jul, 7-ago, 17-ago y
rem  13-sep). Ninguna fue culpa del codigo. Vivia dentro de una
rem  ventana negra que alguien abria a mano: se apagaba la PC el
rem  domingo y nadie lo volvia a abrir el lunes. La ultima vez
rem  tardamos 10 dias en darnos cuenta.
rem
rem  El arranque anterior (iniciar-conector.bat) terminaba en
rem  "pause". Si node tronaba, la ventana se quedaba en "Presione
rem  una tecla para continuar": se veia viva y estaba muerta.
rem  Este archivo NO lleva pause. Si el conector se cae, vuelve a
rem  arrancar solo a los 30 segundos, para siempre.
rem
rem  El titulo de la ventana (ConectorFitTaste) no es decorativo:
rem  revisar.bat lo usa para saber si el vigilante sigue vivo.
rem  Si le cambias el titulo, rompes esa revision.
rem ============================================================

title ConectorFitTaste
cd /d C:\fittaste\conector-sr

set LOG=C:\fittaste\conector-sr\conector.log

:loop

rem El log crece para siempre si nadie lo corta. A los 5 MB se
rem guarda como .viejo y se empieza uno limpio: siempre quedan
rem dos, nunca cien.
for %%A in ("%LOG%") do if %%~zA GTR 5000000 move /y "%LOG%" "%LOG%.viejo" >nul 2>&1

echo. >> "%LOG%"
echo [%date% %time%] --- Arrancando el conector --- >> "%LOG%"

node sync.js --daemon >> "%LOG%" 2>&1

echo [%date% %time%] El conector SE DETUVO (codigo %errorlevel%). Reintento en 30 segundos. >> "%LOG%"
timeout /t 30 /nobreak >nul

goto loop
