; =============================================================================
; CRITICAL: Money Weather NSIS installer custom script
; =============================================================================
; This script controls the update/install behavior.  Getting this wrong causes
; the "Choose Installation Options" page to appear on EVERY update, forcing
; the user to re-confirm per-user vs per-machine.
;
; DESIRED BEHAVIOR (do NOT change without reading the memory first):
;   1. During updates: SKIP the install-mode selection page entirely.
;   2. Show the "Installing" progress page.
;   3. Show the "Completing Money Weather Setup" finish page with the
;      "Run Money Weather" checkbox CHECKED.
;
; TECHNICAL REQUIREMENTS:
;   - electron-builder: oneClick=false, perMachine=false, runAfterFinish=true
;   - main.js: autoUpdater.quitAndInstall(false, true)  (isSilent=false)
;   - THIS FILE must set $MultiUser.InstallMode in customInit so the MultiUser
;     plugin skips the install-mode page automatically.
;
;   DO NOT use a temporary register like $R1 — the MultiUser plugin ONLY
;   respects $MultiUser.InstallMode.  If that variable is empty, the page
;   will ALWAYS appear.
;
;   DO NOT manually call SetShellVarContext here — the MultiUser plugin
;   handles it based on $MultiUser.InstallMode.
; =============================================================================

!macro customInit
  ; ---------------------------------------------------------------------------
  ; Try to restore the install mode from a previous installation.
  ; We store a simple "machine" / "user" value in HKCU; here we translate it
  ; into the NSIS MultiUser variable $MultiUser.InstallMode so the plugin
  ; skips the install-mode selection page.
  ; ---------------------------------------------------------------------------
  ReadRegStr $R0 HKCU "Software\com.budgetapp.desktop" "InstallMode"
  StrCmp $R0 "machine" applyMachine
  StrCmp $R0 "user" applyUser

  ; No saved mode found — try to auto-detect from an existing installation.
  ReadRegStr $R0 HKLM "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" 0 applyMachine

  ReadRegStr $R0 HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\com.budgetapp.desktop" "InstallLocation"
  StrCmp $R0 "" done
  Goto applyUser

applyMachine:
  ; Setting $MultiUser.InstallMode to "AllUsers" tells the MultiUser plugin
  ; the mode is already decided → the install-mode page is SKIPPED.
  StrCpy $MultiUser.InstallMode "AllUsers"
  Goto done

applyUser:
  ; Setting $MultiUser.InstallMode to "CurrentUser" tells the MultiUser plugin
  ; the mode is already decided → the install-mode page is SKIPPED.
  StrCpy $MultiUser.InstallMode "CurrentUser"
  Goto done

done:
!macroend

!macro customInstall
  ; ---------------------------------------------------------------------------
  ; Persist the install mode chosen by the MultiUser plugin so the NEXT update
  ; can skip the selection page.  We read $MultiUser.InstallMode (not $R1)
  ; because the plugin sets that variable when the user actually picks a mode
  ; on a fresh install.
  ; ---------------------------------------------------------------------------
  StrCmp $MultiUser.InstallMode "AllUsers" 0 writeUser
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "machine"
    Goto installDone
writeUser:
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "user"
installDone:
!macroend
