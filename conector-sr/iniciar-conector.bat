@echo off
title Conector FitTaste - SoftRestaurant
echo ============================================
echo   Conector FitTaste ^<- SoftRestaurant
echo   No cierres esta ventana: puedes minimizarla.
echo   Si se cierra, no se pierde nada: al volver
echo   a abrir se pone al corriente solo.
echo ============================================
cd /d C:\fittaste\conector-sr
node sync.js --daemon
pause
