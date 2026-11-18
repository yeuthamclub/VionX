#!/bin/zsh
# Run the Maestro flows one by one on a USB phone, against `pnpm fn:serve` on this Mac.
#   zsh apps/mobile/.maestro/run-device.sh [flow ...]      (default: m00..m07, then the M08 trio)
# Needs: a release build installed (`expo run:android --variant release`), `pnpm fn:serve` running,
# JDK 17 or 21 (Gradle and Maestro fail on JDK 25). Results: .maestro-results/<flow>.log.
cd "$(dirname "$0")/.." || exit 1
export JAVA_HOME=${JAVA_HOME:-/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home}
adb reverse tcp:54331 tcp:54331 >/dev/null || exit 1
# Every run adds children to the households of the test numbers; a long list makes the parent home
# slow and pushes its buttons far down. Start from empty households.
for p in 84900000003 84900000004 84900000006 84900000008; do
  (cd ../.. && pnpm cloud npx tsx scripts/maestro-households.ts --delete $p 2>/dev/null | grep deleted)
done
out=../../.maestro-results
mkdir -p $out
flows=("$@")
(( ${#flows} )) || flows=(m00-health m01-identity m02-consent m03-tasks m04-rewards m06-practice m07-today m08-parent m08-child m08-parent-after)
for f in $flows; do
  maestro test .maestro/$f.yaml --debug-output $out/$f > $out/$f.log 2>&1
  echo "$f exit=$?" | tee -a $out/summary.txt
done
