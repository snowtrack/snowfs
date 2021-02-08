@ECHO OFF
SETLOCAL
CALL :find_dp0

IF NOT EXIST "%dp0%\..\node_modules" (
  echo "node_modules missing - you must first install all node packages by executing 'npm install' in the root directory of SnowFS"
  EXIT /b
)

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

echo Please note, the CLI has a long warm-up phase because of ts-node. This is currently investigated.

"%_prog%" -r "%dp0%..\node_modules\ts-node\register\index.js" "%dp0%..\main.ts" %*
ENDLOCAL
EXIT /b %errorlevel%
:find_dp0
SET dp0=%~dp0
EXIT /b
