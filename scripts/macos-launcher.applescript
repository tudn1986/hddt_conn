on run
  set launcherPath to POSIX path of (path to me)
  set releaseDir to do shell script "/usr/bin/dirname " & quoted form of launcherPath
  do shell script "cd " & quoted form of releaseDir & " && /usr/bin/nohup ./hddt-server >/dev/null 2>&1 </dev/null &"
end run
