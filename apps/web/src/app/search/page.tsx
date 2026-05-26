import Link from "next/link";
import { searchPrompts } from "@promptlog/db/queries";
import { TARGET_APP_LABEL, type TargetApp } from "@promptlog/shared";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatDuration, truncate } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; app?: string }>;
}) {
  const sp = await searchParams;
  const q = sp.q?.trim() ?? "";
  const app = (sp.app as TargetApp | undefined) || undefined;
  const results = q || app
    ? searchPrompts({ query: q, app })
    : searchPrompts({ limit: 50 });

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Search</h1>
        <p className="text-sm text-muted-foreground">
          Full-text search across every prompt captured.
        </p>
      </header>

      <form className="flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search prompt or response text…"
          className="flex h-9 flex-1 rounded-md border border-border bg-background px-3 py-1 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border"
        />
        <select
          name="app"
          defaultValue={app ?? ""}
          className="h-9 rounded-md border border-border bg-background px-3 text-sm"
        >
          <option value="">All apps</option>
          {(Object.keys(TARGET_APP_LABEL) as TargetApp[]).map((k) => (
            <option key={k} value={k}>
              {TARGET_APP_LABEL[k]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"
        >
          Search
        </button>
      </form>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {results.length} result{results.length === 1 ? "" : "s"}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {results.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              Nothing matched.
            </p>
          ) : (
            <ul>
              {results.map((p) => (
                <li
                  key={p.id}
                  className="border-b border-border px-6 py-3 last:border-0 hover:bg-accent/40"
                >
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge variant="outline">{TARGET_APP_LABEL[p.app]}</Badge>
                    <span>{formatDateTime(p.sentAt)}</span>
                    <span>·</span>
                    <span>{formatDuration(p.latencyMs)}</span>
                    <span>·</span>
                    <Link
                      href={`/sessions/${p.sessionId}`}
                      className="underline-offset-2 hover:underline"
                    >
                      Session #{p.sessionId}
                    </Link>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">
                    {truncate(p.promptText, 400)}
                  </div>
                  {p.responseSnippet && (
                    <div className="mt-1 whitespace-pre-wrap text-xs text-muted-foreground">
                      → {truncate(p.responseSnippet, 280)}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
