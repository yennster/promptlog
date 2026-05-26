import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import { TARGET_APP_LABEL } from "@promptlog/shared";
import type { SessionBundle } from "./csv";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 10, color: "#666", marginBottom: 14 },
  sessionTitle: { fontSize: 13, fontWeight: 700, marginTop: 18, marginBottom: 2 },
  sessionSub: { fontSize: 9, color: "#666", marginBottom: 8 },
  statRow: { flexDirection: "row", marginBottom: 10, gap: 8 },
  statBox: {
    flex: 1,
    border: "1pt solid #ddd",
    borderRadius: 4,
    padding: 6,
  },
  statLabel: { fontSize: 7, color: "#888", textTransform: "uppercase" },
  statValue: { fontSize: 12, fontWeight: 700, marginTop: 2 },
  table: { border: "1pt solid #ddd", borderRadius: 4 },
  th: {
    flexDirection: "row",
    backgroundColor: "#f5f5f5",
    borderBottom: "1pt solid #ddd",
    paddingVertical: 4,
    paddingHorizontal: 6,
    fontSize: 7,
    textTransform: "uppercase",
    color: "#666",
  },
  tr: {
    flexDirection: "row",
    borderBottom: "1pt solid #eee",
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  c_time: { width: 100 },
  c_app: { width: 60 },
  c_lat: { width: 60 },
  c_prompt: { flex: 2, paddingRight: 6 },
  c_resp: { flex: 2 },
  empty: { fontSize: 9, color: "#888", fontStyle: "italic", marginTop: 4 },
});

export interface MultiSessionReportProps {
  bundles: SessionBundle[];
  generatedAt: Date;
}

export function MultiSessionReport({
  bundles,
  generatedAt,
}: MultiSessionReportProps) {
  const totalPrompts = bundles.reduce((a, b) => a + b.prompts.length, 0);
  const totalCost = bundles
    .flatMap((b) => b.prompts)
    .reduce((a, p) => a + (p.estCostUsd ?? 0), 0);

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>
          {bundles.length} session{bundles.length === 1 ? "" : "s"} — Promptlog
          report
        </Text>
        <Text style={styles.sub}>
          Generated {generatedAt.toLocaleString()} · {totalPrompts} prompts
          {totalCost > 0 ? ` · est. $${totalCost.toFixed(4)}` : ""}
        </Text>

        {bundles.map(({ session, prompts }) => {
          const duration = session.endedAt
            ? session.endedAt.getTime() - session.startedAt.getTime()
            : Date.now() - session.startedAt.getTime();
          return (
            <View key={session.id} wrap>
              <Text style={styles.sessionTitle}>{session.name}</Text>
              <Text style={styles.sessionSub}>
                {session.startedAt.toLocaleString()}
                {session.endedAt
                  ? ` → ${session.endedAt.toLocaleString()}`
                  : " (in progress)"}
                {session.projectContext ? ` · ${session.projectContext}` : ""}
              </Text>
              <View style={styles.statRow}>
                <Stat label="Prompts" value={String(prompts.length)} />
                <Stat label="Duration" value={formatDuration(duration)} />
              </View>
              {prompts.length === 0 ? (
                <Text style={styles.empty}>No prompts captured.</Text>
              ) : (
                <View style={styles.table}>
                  <View style={styles.th}>
                    <Text style={styles.c_time}>Sent</Text>
                    <Text style={styles.c_app}>App</Text>
                    <Text style={styles.c_lat}>Latency</Text>
                    <Text style={styles.c_prompt}>Prompt</Text>
                    <Text style={styles.c_resp}>Response</Text>
                  </View>
                  {prompts.map((p) => (
                    <View key={p.id} style={styles.tr} wrap={false}>
                      <Text style={styles.c_time}>
                        {p.sentAt.toLocaleString(undefined, {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </Text>
                      <Text style={styles.c_app}>{TARGET_APP_LABEL[p.app]}</Text>
                      <Text style={styles.c_lat}>
                        {p.latencyMs ? `${(p.latencyMs / 1000).toFixed(2)}s` : "—"}
                      </Text>
                      <Text style={styles.c_prompt}>
                        {truncate(p.promptText, 400)}
                      </Text>
                      <Text style={styles.c_resp}>
                        {truncate(p.responseSnippet ?? "", 400)}
                      </Text>
                    </View>
                  ))}
                </View>
              )}
            </View>
          );
        })}
      </Page>
    </Document>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statBox}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
