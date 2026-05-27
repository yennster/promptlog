import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Prompt, Session } from "@promptlog/db";
import { TARGET_APP_LABEL } from "@promptlog/shared";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  sub: { fontSize: 10, color: "#666", marginBottom: 14 },
  statRow: { flexDirection: "row", marginBottom: 14, gap: 12 },
  statBox: {
    flex: 1,
    border: "1pt solid #ddd",
    borderRadius: 4,
    padding: 8,
  },
  statLabel: { fontSize: 7, color: "#888", textTransform: "uppercase" },
  statValue: { fontSize: 14, fontWeight: 700, marginTop: 2 },
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
});

export interface SessionReportProps {
  session: Session;
  prompts: Prompt[];
}

export function SessionReport({ session, prompts }: SessionReportProps) {
  const duration = session.endedAt
    ? session.endedAt.getTime() - session.startedAt.getTime()
    : Date.now() - session.startedAt.getTime();

  return (
    <Document>
      <Page size="LETTER" orientation="landscape" style={styles.page}>
        <Text style={styles.title}>{session.name}</Text>
        <Text style={styles.sub}>
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
              <Text style={styles.c_prompt}>{truncate(p.promptText, 400)}</Text>
              <Text style={styles.c_resp}>
                {truncate(p.responseSnippet ?? "", 400)}
              </Text>
            </View>
          ))}
        </View>
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
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}
