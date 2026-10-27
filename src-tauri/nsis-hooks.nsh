!macro NSIS_HOOK_POSTINSTALL
  IfSilent startup_done

  ${If} $PassiveMode = 1
    Goto startup_done
  ${EndIf}

  ${If} $LANGUAGE = 1046
  ${OrIf} $LANGUAGE = 2070
    MessageBox MB_ICONQUESTION|MB_YESNO "Iniciar o Prin com o computador?" IDNO startup_disable
  ${Else}
    MessageBox MB_ICONQUESTION|MB_YESNO "Start Prin automatically when Windows starts?" IDNO startup_disable
  ${EndIf}

    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}" "$\"$INSTDIR\${MAINBINARYNAME}.exe$\" --autostart"
    WriteRegBin HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "${PRODUCTNAME}" "020000000000000000000000"
    Goto startup_done

  startup_disable:
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "${PRODUCTNAME}"

  startup_done:
!macroend
