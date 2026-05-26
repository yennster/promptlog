# CLAUDE.md Guide for promptlog

This document outlines the core build, run, test, and styling guidelines for the `promptlog` monorepo.

## Commands

### Running Development Server
Runs both the Next.js web interface and the prompt-logging background daemon concurrently:
```bash
pnpm dev
```

### Build & Compilation
- **Build Everything**: Builds all JS/TS projects and compiles the Swift accessibility utility:
  ```bash
  pnpm build
  ```
- **Build Swift Capture Utility Only**: Compiles the macOS `ax-capture` binary:
  ```bash
  pnpm build:swift
  ```

### Database Management (Drizzle ORM)
- **Generate Migrations**:
  ```bash
  pnpm db:generate
  ```
- **Apply Migrations**:
  ```bash
  pnpm db:migrate
  ```

### Typechecking & Testing
- **Typecheck Entire Workspace**:
  ```bash
  pnpm typecheck
  ```
- **Run All Tests**: Runs the native Node.js test suite:
  ```bash
  pnpm test
  ```
- **Run Daemon Tests Directly**:
  ```bash
  pnpm -C apps/daemon test
  ```

### AX-Debug Harness
For iterating on the AX-blob filtering pipeline without driving the UI:
```bash
pnpm -C apps/daemon ax:snapshot <app>            # one-shot raw + cleaned blob
pnpm -C apps/daemon ax:live <app>                # simulate the capture loop
pnpm -C apps/daemon ax:record <app> <file> [s]   # record N seconds to fixture
pnpm -C apps/daemon ax:replay <fixture> [prompt] # replay through the filter
```
`<app>` is one of `claude | chatgpt | codex | antigravity`.

---

## Code Guidelines & Architecture

### Tech Stack & Project Layout
- **Monorepo Manager**: `pnpm` workspace (`pnpm-workspace.yaml`).
- **Web App (`apps/web`)**: React / Next.js web dashboard.
- **Daemon (`apps/daemon`)**: TypeScript agent polling target apps via macOS Accessibility APIs.
- **Swift Helper (`apps/ax-capture`)**: macOS Swift CLI helper for retrieving Accessibility trees.
- **Database (`packages/db`)**: SQLite DB using `better-sqlite3`, `drizzle-orm`, and FTS5 search.
- **Shared (`packages/shared`)**: Shared types, configuration rates, and environment paths.

### TypeScript & Import Style
- **ES Modules (ESM)**: The daemon and database packages run in pure ESM mode (`"type": "module"`).
- **Import Extensions**: Relative imports **MUST** include the `.js` extension (e.g., `import { foo } from "./cwd.js";`), which TypeScript compiles natively.
- **Type Safety**: Keep TypeScript configurations strict (`tsc --noEmit`).

### Testing & Sandboxing
- **Test Runner**: Node's built-in test runner (`import { test } from "node:test"`).
- **No Mocking Sandboxing**: To prevent tests from polluting local configurations or database state (`~/.promptlog`), always override `process.env.HOME` at the very beginning of the test script.
- **ESM Gotcha**: Because ESM imports are hoisted and executed before top-level code, **always** use dynamic imports (`await import`) inside test files if they require access to packages reading `process.env` (e.g., `@promptlog/shared` or `@promptlog/db`).
  ```ts
  const tempHome = mkdtempSync(join(tmpdir(), "promptlog-test-"));
  process.env.HOME = tempHome;

  // Dynamically load to ensure sandboxed env is active
  const { db } = await import("@promptlog/db");
  ```

### Database Queries & FTS
- **FTS5 Synchronization**: Keep the FTS5 search index (`prompts_fts`) strictly mirrored with the primary `prompts` table on insert, update, and delete.
- **FTS Rebuild on Daemon Startup**: The daemon calls `rebuildFtsIndex()` at boot to recover from drift (raw-SQL inserts, partial writes from a crash, restore from a non-FTS-aware backup). Cheap and idempotent — don't add a code path that inserts into `prompts` without also mirroring to `prompts_fts`, but if one slips through, the next daemon restart cleans it up.
- **Subquery Deletes**: Do not fetch all prompt IDs in JavaScript to perform FTS deletions with dynamic lists (`IN (?, ?, ...)`), as this hits SQLite's 999 parameter limits. Instead, delete FTS rows in a single step using an SQL subquery:
  ```sql
  DELETE FROM prompts_fts WHERE rowid IN (SELECT id FROM prompts WHERE session_id = ?)
  ```
- **FTS Prefix Search**: Prompt search queries should be escaped and run using trailing wildcards (e.g., `"${escaped}"*`) for robust prefix matching.
- **Drizzle Correlated Subqueries**: Drizzle renders column refs unqualified when selecting from a single table. That breaks correlated subqueries — `WHERE prompts.session_id = id` reads `id` as `prompts.id` (subquery's FROM), not `sessions.id`. Use `sql.raw('"sessions"."id"')` to force qualification. See `listSessions` in `packages/db/src/queries.ts` for the pattern.

### Daemon Lifecycle
- **Socket-Collision Guard**: On startup, `startSocketServer` pings the existing socket. If a daemon already responds, the new process logs an error and exits 1. Prevents the dual-daemon race that happens when tsx-watch's reload doesn't fully kill the previous process.
- **Recovery**: If you ever see `another daemon is already listening...` on startup, run `pkill -f "tsx.*daemon"` then restart `pnpm dev`.

### Capture-Pipeline Conventions
- **Per-app chrome filters live in `apps/daemon/src/adapters.ts`**: `RESPONSE_NOISE` (regex strips that can run anywhere — disclaimers, model picker, timestamp lines) and `CHROME_LINES` (exact-line drops — toolbar/control button labels like `Copy`, `Retry`). Prefer `CHROME_LINES` for short labels that could plausibly appear inside real prose; prefer `RESPONSE_NOISE` for patterns with dynamic content (timestamps, "Ran N commands", model badges).
- **Prompt anchoring is line-based**: `extractAssistantResponse` only slices on the prompt when it appears as a complete line in the blob. Substring matches via `lastIndexOf` over-slice when the response echoes the prompt mid-sentence.
- **Two prompt detectors run in parallel**: `composerSent` (composer transitions text→empty — primary) and `userBubbleSent` (a new "User message" labeled AXGroup appears — fallback for Antigravity-style labeled apps, used when the composer transition was missed). The user-bubble path is also preferred over a composer capture when it's a longer superstring, because the composer can be caught mid-typing.
