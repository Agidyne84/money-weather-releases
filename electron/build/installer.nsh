; =============================================================================
; CRITICAL: Money Weather NSIS installer custom script
; =============================================================================
; This script controls the update/install behavior. Getting this wrong causes
; the "Choose Installation Options" page to appear on EVERY update, forcing
; the user to re-confirm per-user vs per-machine.
;
; DESIRED BEHAVIOR (do NOT change without reading the memory first):
;   1. During updates: SKIP the install-mode selection page entirely.
;   2. Show the "Installing" progress page.
;   3. Show the "Completing Money Weather Setup" finish page with the
;      "Run Money Weather" checkbox CHECKED.
;
; HOW IT WORKS:
;   electron-builder's initMultiUser macro (assistedInstaller.nsh) already
;   detects previous installations from the uninstall registry and sets:
;     $hasPerMachineInstallation = "1" or "0"
;     $hasPerUserInstallation    = "1" or "0"
;     $installMode               = "all" or "CurrentUser"
;
;   The install-mode page pre-function (multiUserUi.nsh) calls customInstallMode
;   (if defined). Setting $isForceMachineInstall or $isForceCurrentInstall to
;   "1" makes the page call setInstallModePerAllUsers/setInstallModePerUser
;   and then ABORT — skipping the page entirely.
;
;   DO NOT manually call SetShellVarContext here — the setInstallMode macros
;   handle it correctly.
; =============================================================================

!macro customInit
  ; initMultiUser already detects previous installations from the uninstall
  ; registry and sets $installMode, $hasPerMachineInstallation and
  ; $hasPerUserInstallation. No extra init work is needed here.
!macroend

!macro customInstallMode
  ; ---------------------------------------------------------------------------
  ; If a previous installation was detected by initMultiUser, force the
  ; install-mode page to skip itself and reuse the already-selected mode.
  ; This prevents the user from having to re-confirm per-user vs per-machine
  ; during every update.
  ; ---------------------------------------------------------------------------
  ${if} $hasPerMachineInstallation == "1"
    StrCpy $isForceMachineInstall "1"
  ${elseif} $hasPerUserInstallation == "1"
    StrCpy $isForceCurrentInstall "1"
  ${endif}
!macroend

!macro customInstall
  ; ---------------------------------------------------------------------------
  ; Persist the install mode choice for the NEXT update.
  ; $installMode is set by setInstallModePerUser ("CurrentUser") or
  ; setInstallModePerAllUsers ("all").
  ; ---------------------------------------------------------------------------
  ${if} $installMode == "all"
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "machine"
  ${else}
    WriteRegStr HKCU "Software\com.budgetapp.desktop" "InstallMode" "user"
  ${endif}
!macroend
