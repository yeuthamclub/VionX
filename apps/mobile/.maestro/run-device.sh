#!/bin/zsh
# Run the Maestro flows one by one on a USB phone, against `pnpm fn:serve` on this Mac.
#   zsh apps/mobile/.maestro/run-device.sh [flow ...]      (default: m00..m07, then the M08 trio)
# Needs: a release build installed (`expo run:android --variant release`), `pnpm fn:serve` running,
# JDK 17 or 21 (Gradle and Maestro fail on JDK 25). Results: .maestro-results/<flow>.log.
#
# Test OTP numbers: the development project has 0900000001-04 (Authentication → Phone → test
# numbers). 01 is the seed household. m01 uses 03, m02-m04 use 04, m06-m07 use 02, m08 uses 03.
# Every run adds children, and a long list makes the parent home slow, so the household of a
# number is deleted before the first flow that uses it (and again before m08, which shares 03).
cd "$(dirname "$0")/.." || exit 1
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
adb reverse tcp:54331 tcp:54331 >/dev/null || exit 1
out=../../.maestro-results
mkdir -p $out
typeset -A phone=(m01-identity 84900000003 m02-consent 84900000004 m06-practice 84900000002 m08-parent 84900000003)
flows=("$@")
(( ${#flows} )) || flows=(m00-health m01-identity m02-consent m03-tasks m04-rewards m06-practice m07-today m08-parent m08-child m08-parent-after)
for f in $flows; do
  if [[ -n ${phone[$f]} ]]; then
    (cd ../.. && pnpm cloud npx tsx scripts/maestro-households.ts --delete ${phone[$f]} 2>/dev/null | grep deleted)
  fi
  maestro test .maestro/$f.yaml --debug-output $out/$f > $out/$f.log 2>&1
  echo "$f exit=$?" | tee -a $out/summary.txt
done
