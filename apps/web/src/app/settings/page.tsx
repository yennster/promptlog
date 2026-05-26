import { sendToDaemon } from "@/lib/daemon-client";
import { readSettings } from "@/lib/settings";
import { TARGET_APP_LABEL, type TargetApp } from "@promptlog/shared";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const settings = readSettings();
  const status = await sendToDaemon({ kind: "status" });
  const daemonOk = status.ok === true;
  const ax = daemonOk ? status.status?.axPermissionGranted : false;

  return (
    <div className="mx-auto max-w-3xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Permissions and target apps.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">macOS permissions</CardTitle>
          <CardDescription>
            The ax-capture helper needs Accessibility access to read text from
            target apps.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <div className="flex items-center justify-between">
            <span>Daemon reachable</span>
            {daemonOk ? (
              <Badge variant="secondary">connected</Badge>
            ) : (
              <Badge variant="destructive">offline</Badge>
            )}
          </div>
          <div className="flex items-center justify-between">
            <span>Accessibility permission</span>
            {ax ? (
              <Badge variant="secondary">granted</Badge>
            ) : (
              <Badge variant="destructive">not granted</Badge>
            )}
          </div>
          {!ax && (
            <div className="space-y-2 text-xs text-muted-foreground">
              <p>
                Open <strong>System Settings → Privacy &amp; Security →
                Accessibility</strong>, click <strong>+</strong>, and add{" "}
                <code>apps/ax-capture/AxCapture.app</code> (drag it from Finder,
                or use ⇧⌘G in the file picker and paste the absolute path).
              </p>
              <p>
                If you already added the bare <code>ax-capture</code> binary,
                remove that row first — the app-bundle entry replaces it.
                Restart the daemon after granting (<code>pnpm dev</code>).
              </p>
              <p>
                If it still says "not granted" after that, your terminal app
                (iTerm/Terminal) may be holding the TCC responsibility —
                grant Accessibility to your terminal too and relaunch it.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Target apps</CardTitle>
          <CardDescription>
            The capture loop polls these when a session is active. Toggling is
            wired through settings.json — edit that file directly for now.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {(Object.keys(TARGET_APP_LABEL) as TargetApp[]).map((k) => (
              <li key={k} className="flex items-center justify-between">
                <span>{TARGET_APP_LABEL[k]}</span>
                {settings.enabledApps[k] ? (
                  <Badge variant="secondary">enabled</Badge>
                ) : (
                  <Badge variant="outline">disabled</Badge>
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
