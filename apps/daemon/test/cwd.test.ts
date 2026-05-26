import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Sandboxed HOME environment so tests don't touch real files
const tempHome = mkdtempSync(join(tmpdir(), "promptlog-cwd-test-"));
process.env.HOME = tempHome;

import { test } from "node:test";
import assert from "node:assert/strict";

// Dynamic import to prevent ESM import hoisting from reading the real HOME
const { extractPath } = await import("../src/cwd.js");

test("extractPath — returns null on empty or invalid titles", () => {
  assert.equal(extractPath(""), null);
  assert.equal(extractPath("Just a title without separator"), null);
});

test("extractPath — absolute path with various dashes", () => {
  // Create a real directory that exists so existsSync succeeds
  const tempDir = mkdtempSync(join(tmpdir(), "promptlog-target-"));

  try {
    // 1. Hyphen separator
    assert.equal(
      extractPath(`index.ts - ${tempDir}`),
      tempDir,
    );

    // 2. Em-dash separator
    assert.equal(
      extractPath(`index.ts — ${tempDir}`),
      tempDir,
    );

    // 3. En-dash separator
    assert.equal(
      extractPath(`index.ts – ${tempDir}`),
      tempDir,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("extractPath — trims common editor suffixes", () => {
  const tempDir = mkdtempSync(join(tmpdir(), "promptlog-suffix-target-"));

  try {
    // VS Code Workspace suffix
    assert.equal(
      extractPath(`index.ts — ${tempDir} (Workspace)`),
      tempDir,
    );

    // SSH Remote suffix
    assert.equal(
      extractPath(`index.ts — ${tempDir} [SSH: remote-server]`),
      tempDir,
    );

    // Restricted Mode suffix
    assert.equal(
      extractPath(`index.ts — ${tempDir} [Restricted Mode]`),
      tempDir,
    );

    // Unsupported / Read Only suffixes
    assert.equal(
      extractPath(`index.ts — ${tempDir} [Read Only]`),
      tempDir,
    );
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test("extractPath — candidate relative path resolution", () => {
  // Create ~/Work/my-cool-project in sandboxed HOME
  const workDir = join(tempHome, "Work");
  const projectDir = join(workDir, "my-cool-project");
  mkdirSync(projectDir, { recursive: true });

  try {
    // Verify standard folder title resolves correctly to ~/Work/my-cool-project
    assert.equal(
      extractPath("main.go — my-cool-project"),
      projectDir,
    );

    // Verify resolving with en-dash and suffixes
    assert.equal(
      extractPath("main.go – my-cool-project (workspace)"),
      projectDir,
    );
  } finally {
    rmSync(tempHome, { recursive: true, force: true });
  }
});
