; Custom NSIS script for Money Weather installer
; Remembers per-machine vs per-user install choice across updates

!macro customInit
  ; Always check for saved install mode from previous installation
  ReadRegStr $R0 HKCU "Software\com.budgetapp.desktop" "InstallMode"
  StrCmp $R0 "machine" isMachine
  StrCmp $R0 "user" isUser

  ; No saved mode - detect from existing installation
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" 0 isMachine

  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" done
  Goto isUser

isMachine:
  StrCpy $R1 "1"
  SetShellVarContext all
  Goto done

isUser:
  StrCpy $R1 "0"
  SetShellVarContext current

done:
!macroend

!macro customInstall
  ; Save the install mode choice for next time
  StrCmp $R1 "1" 0 writeUser
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "machine"
    Goto installDone
writeUser:
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "user"
installDone:
!macroend
