import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { CircleDot, FileText, Home, Search, Settings } from "lucide-react";

export const metadata: Metadata = {
  title: "Promptlog",
  description: "Local audit log of prompts to your AI desktop apps.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body
        className="min-h-screen bg-background font-sans antialiased"
        suppressHydrationWarning
      >
        <div className="flex min-h-screen">
          <aside className="w-56 shrink-0 border-r border-border bg-card">
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
            <div className="mt-auto p-2 text-[10px] uppercase tracking-wider text-muted-foreground">
              <div className="flex items-center gap-1 px-2 pt-2">
                <FileText className="h-3 w-3" />
                Local · SQLite
              </div>
            </div>
          </aside>
          <main className="flex-1 overflow-x-hidden">{children}</main>
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
