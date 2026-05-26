import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, FileText, Home, Search, Settings } from "lucide-react";
import { activeSession } from "@promptlog/db/queries";
import { RecordPill } from "@/components/record-pill";

export const metadata: Metadata = {
  title: "Promptlog",
  description: "Local audit log of prompts to your AI desktop apps.",
};

export const dynamic = "force-dynamic";

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const active = activeSession();

  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-border bg-card flex flex-col justify-between">
            <div>
              <div className="flex h-14 items-center gap-2 border-b border-border px-4">
                <CircleDot className="h-4 w-4 text-destructive" />
                <span className="text-sm font-semibold tracking-tight">
                  Promptlog
                </span>
              </div>
              <nav className="flex flex-col gap-1 p-2 text-sm">
                <NavLink href="/" icon={<Home className="h-4 w-4" />}>
                  Sessions
                </NavLink>
                <NavLink href="/search" icon={<Search className="h-4 w-4" />}>
                  Search
                </NavLink>
                <NavLink href="/settings" icon={<Settings className="h-4 w-4" />}>
                  Settings
                </NavLink>
              </nav>
            </div>
            <div className="p-2 text-[10px] uppercase tracking-wider text-muted-foreground border-t border-border bg-card">
              <div className="flex items-center gap-1 px-2 py-1">
                <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                <span>Local · SQLite</span>
              </div>
            </div>
          </aside>
          
          <div className="flex-1 flex flex-col min-h-screen">
            <header className="flex h-14 items-center justify-between border-b border-border px-6 bg-card shrink-0">
              <div className="flex items-center gap-2">
                {!active ? (
                  <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <CircleDot className="h-3.5 w-3.5 text-muted-foreground" />
                    Idle
                  </span>
                ) : (
                  <span className="text-xs text-primary flex items-center gap-1.5">
                    <CircleDot className="h-3.5 w-3.5 text-destructive animate-pulse" />
                    Recording: <span className="font-semibold">{active.name}</span>
                  </span>
                )}
              </div>
              <RecordPill activeSessionId={active?.id ?? null} />
            </header>
            <main className="flex-1 overflow-x-hidden">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}

function NavLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-2 rounded-md px-3 py-2 text-foreground transition-colors hover:bg-accent"
    >
      {icon}
      {children}
    </Link>
  );
}
