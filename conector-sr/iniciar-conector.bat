@echo off
rem ============================================================
rem  ESTE ARCHIVO YA NO ES EL QUE ARRANCA EL CONECTOR
rem ============================================================
rem  Se conserva porque alguien lo va a abrir por costumbre: la
rem  ventana llevaba meses llamándose así. Borrarlo dejaría a esa
rem  persona sin nada; dejarlo como estaba es peor, porque
rem  arrancaba un conector que nadie volvía a levantar si moría.
rem
rem  Ahora sólo reenvía a vigilante.bat, que reintenta solo.
rem ============================================================

title Conector FitTaste
echo.
echo   Este arranque fue reemplazado por vigilante.bat, que
echo   vuelve a levantar el conector si se cae.
echo.
echo   Abriendolo por ti...
echo.

start "" "C:\fittaste\conector-sr\vigilante.bat"

echo   Listo. Puedes cerrar ESTA ventana; la que dice
echo   ConectorFitTaste es la que tiene que quedarse abierta.
echo.
echo   Si el conector no arranca solo al prender la PC, corre
echo   una vez instalar-arranque-automatico.bat como
echo   administrador.
echo.
timeout /t 15
