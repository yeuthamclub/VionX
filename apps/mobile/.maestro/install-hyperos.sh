#!/bin/zsh
# Install the release APK on a Xiaomi HyperOS device. HyperOS shows an "Install via USB" dialog that
# denies after 10 s; this waits for it and taps Install.
#   zsh apps/mobile/.maestro/install-hyperos.sh <adb serial>
# Needs on the device: Developer options → Install via USB and USB debugging (Security settings).
serial=$1
apk="$(dirname "$0")/../android/app/build/outputs/apk/release/app-release.apk"
adb -s $serial install -r "$apk" > /tmp/vionx-install.$serial.log 2>&1 &
for i in {1..40}; do
  if adb -s $serial shell dumpsys window | grep -qE 'mCurrentFocus.*(AdbInstallActivity|securitycenter)'; then
    adb -s $serial shell uiautomator dump /sdcard/ui.xml > /dev/null 2>&1
    xy=$(adb -s $serial shell cat /sdcard/ui.xml | tr '>' '\n' | grep -E 'text="(Install|Cài đặt)"' | head -1 |
      sed -E 's/.*bounds="\[([0-9]+),([0-9]+)\]\[([0-9]+),([0-9]+)\]".*/\1 \2 \3 \4/')
    if [[ -n $xy ]]; then
      set -- ${=xy}
      adb -s $serial shell input tap $((($1 + $3) / 2)) $((($2 + $4) / 2))
      break
    fi
  fi
  sleep 0.5
done
wait
tail -1 /tmp/vionx-install.$serial.log
