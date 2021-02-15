@ECHO OFF 
SETLOCAL 
CALL :find_dp0 

 
IF EXIST "%dp0%node.exe" ( 
  SET "_prog=%dp0%node.exe" 
) ELSE ( 
  SET "_prog=node" 
  SET PATHEXT=%PATHEXT:;.JS;=;% 
) 
 
echo [Compiling...]: WARNING: This is an executable for debugging purposes and not intended for production use!
 
"%_prog%" -r "%dp0%..\node_modules\ts-node\register\index.js" "%dp0%..\main.ts" %* 
ENDLOCAL 
EXIT /b %errorlevel% 
:find_dp0 
SET dp0=%~dp0 
EXIT /b 
