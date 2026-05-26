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
- **Subquery Deletes**: Do not fetch all prompt IDs in JavaScript to perform FTS deletions with dynamic lists (`IN (?, ?, ...)`), as this hits SQLite's 999 parameter limits. Instead, delete FTS rows in a single step using an SQL subquery:
  ```sql
  DELETE FROM prompts_fts WHERE rowid IN (SELECT id FROM prompts WHERE session_id = ?)
  ```
- **FTS Prefix Search**: Prompt search queries should be escaped and run using trailing wildcards (e.g., `"${escaped}"*`) for robust prefix matching.
