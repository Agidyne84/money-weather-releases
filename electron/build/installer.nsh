; Custom NSIS script for Money Weather installer
; Remembers per-machine vs per-user install choice and applies it silently during updates

!macro customInit
  ; In silent mode, detect existing installation and preserve its install mode
  IfSilent 0 notSilent
    ; Check for existing per-machine installation
    ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
    StrCmp $R0 "" 0 isMachine

    ; Check for existing per-user installation
    ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
    StrCmp $R0 "" notSilent

    ; Per-user install found
    StrCpy $isPerMachine "0"
    SetShellVarContext current
    Goto doneSilent

  isMachine:
    ; Per-machine install found
    StrCpy $isPerMachine "1"
    SetShellVarContext all

  doneSilent:
  notSilent:
!macroend
