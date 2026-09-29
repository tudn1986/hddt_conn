on run
  set launcherPath to POSIX path of (path to me)
  set releaseDir to do shell script "/usr/bin/dirname " & quoted form of launcherPath
  do shell script "/bin/bash " & quoted form of (releaseDir & "/Start HDDT.command") & " >/dev/null 2>&1 &"
end run
