// Release builds refuse plain HTTP (Android 9+). Development and device tests reach `pnpm fn:serve`
// on the host through `adb reverse` (127.0.0.1) or the emulator alias (10.0.2.2), so HTTP is allowed
// for those loopback hosts only. Every other host stays HTTPS-only.
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const XML = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">127.0.0.1</domain>
    <domain includeSubdomains="false">localhost</domain>
    <domain includeSubdomains="false">10.0.2.2</domain>
  </domain-config>
</network-security-config>
`;

module.exports = function withLoopbackCleartext(config) {
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const dir = join(c.modRequest.platformProjectRoot, 'app/src/main/res/xml');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'network_security_config.xml'), XML);
      return c;
    },
  ]);
  return withAndroidManifest(config, (c) => {
    c.modResults.manifest.application[0].$['android:networkSecurityConfig'] =
      '@xml/network_security_config';
    return c;
  });
};
