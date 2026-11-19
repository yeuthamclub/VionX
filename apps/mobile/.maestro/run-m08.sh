#!/bin/zsh
# M08 on two devices (Master Spec §43): parent phone, child tablet, parent phone again.
#   zsh apps/mobile/.maestro/run-m08.sh <parent adb serial> <child adb serial>
# Needs what run-device.sh needs, on both devices.
parent=$1 child=$2
here="$(cd "$(dirname "$0")" && pwd)"
cd "$here/.." || exit 1
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
out=../../.maestro-results
mkdir -p $out
adb -s $child reverse tcp:54331 tcp:54331 > /dev/null || exit 1

DEVICE=$parent zsh "$here/run-device.sh" m08-parent || exit 1
tail -1 $out/summary.txt | grep -q 'm08-parent exit=0' || exit 1

login=$(cd ../.. && pnpm cloud npx tsx scripts/maestro-households.ts --login-id 84900000003 'An Tổng Quan' 2>/dev/null |
  sed -n 's/^LOGIN_ID=//p')
[[ -n $login ]] || { echo 'no login id for An Tổng Quan'; exit 1; }
maestro --device $child test -e LOGIN_ID=$login .maestro/m08-child.yaml --debug-output $out/m08-child > $out/m08-child.log 2>&1
rc=$?
echo "m08-child exit=$rc" | tee -a $out/summary.txt
(( rc == 0 )) || exit 1

DEVICE=$parent zsh "$here/run-device.sh" m08-parent-after
