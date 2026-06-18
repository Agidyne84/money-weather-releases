; Custom NSIS script for Money Weather installer
; Remembers per-machine vs per-user install choice across updates

!macro customInit
  ; Check for saved install mode from previous installation
  ReadRegStr $R0 HKCU "Software\com.budgetapp.desktop" "InstallMode"
  StrCmp $R0 "machine" applyMachine
  StrCmp $R0 "user" applyUser

  ; No saved mode - detect from existing installation
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" 0 applyMachine

  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" done
  Goto applyUser

applyMachine:
  StrCpy $R1 "machine"
  SetShellVarContext all
  Goto done

applyUser:
  StrCpy $R1 "user"
  SetShellVarContext current
  Goto done

done:
!macroend

!macro customInstall
  ; Save the install mode choice for next update
  StrCmp $R1 "machine" 0 writeUser
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "machine"
    Goto installDone
writeUser:
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "user"
installDone:
!macroend
