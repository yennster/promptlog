// Build a minimal .app bundle around the swift binary so macOS gives it its
// own TCC (Accessibility) identity instead of attributing the request to the
// parent terminal. This is the difference between "granted" and "not granted"
// when launched from iTerm/Terminal that hasn't been added to Accessibility.
import { mkdirSync, copyFileSync, writeFileSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const bin = resolve(here, ".build/release/ax-capture");
const app = resolve(here, "AxCapture.app");
const macOS = resolve(app, "Contents/MacOS");

rmSync(app, { recursive: true, force: true });
mkdirSync(macOS, { recursive: true });

copyFileSync(bin, resolve(macOS, "ax-capture"));

writeFileSync(
  resolve(app, "Contents/Info.plist"),
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleIdentifier</key>
  <string>me.jennyplunkett.audit.ax-capture</string>
  <key>CFBundleName</key>
  <string>AxCapture</string>
  <key>CFBundleExecutable</key>
  <string>ax-capture</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0</string>
  <key>LSUIElement</key>
  <true/>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
`,
);

// Ad-hoc sign the whole bundle so macOS treats it as a coherent app identity.
execSync(`codesign --sign - --force --deep --options runtime "${app}"`, {
  stdio: "inherit",
});

console.log(`Built ${app}`);
