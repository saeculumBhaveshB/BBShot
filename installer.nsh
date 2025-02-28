!macro customInstall
  ; Run the startup script after installation
  DetailPrint "Setting up BBShots..."
  
  ; Create a log directory for debugging
  CreateDirectory "$INSTDIR\logs"
  
  ; Add a single registry key to run the app at startup
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BBShots" '"$INSTDIR\BBShots.exe"'
  
  ; Create a single scheduled task
  ExecWait 'schtasks /create /tn "BBShots" /tr "$INSTDIR\BBShots.exe" /sc onlogon /f'
  
  ; Create a single startup entry
  CreateDirectory "$PROFILE\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup"
  FileOpen $0 "$PROFILE\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\BBShots.bat" w
  FileWrite $0 '@echo off$\r$\n'
  FileWrite $0 'start "" "$INSTDIR\BBShots.exe"$\r$\n'
  FileWrite $0 'exit$\r$\n'
  FileClose $0
  
  ; Start the app
  Exec '"$INSTDIR\BBShots.exe"'
  
  DetailPrint "BBShots has been configured to start with Windows."
  MessageBox MB_OK "BBShots has been installed and will run at startup. You can uninstall it normally through Control Panel."
!macroend

!macro customUnInstall
  ; Terminate any running instances before uninstalling
  DetailPrint "Terminating any running BBShots processes..."
  ExecWait 'taskkill /f /im BBShots.exe'
  ExecWait 'taskkill /f /im node.exe /fi "WINDOWTITLE eq BBShots*"'
  
  ; Remove from startup folder
  Delete "$PROFILE\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\BBShots.bat"
  
  ; Remove from registry
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "BBShots"
  
  ; Remove scheduled task
  ExecWait 'schtasks /delete /tn "BBShots" /f'
  
  ; Clean up temp files
  RMDir /r "$TEMP\bbshots*"
  
  DetailPrint "BBShots has been completely removed."
  MessageBox MB_OK "BBShots has been uninstalled successfully."
!macroend 