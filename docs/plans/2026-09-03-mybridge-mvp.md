# MyBridge V0.1 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a dependency-light cross-platform MyBridge Agent that discovers and pairs two LAN devices, watches a Windows source folder, and automatically writes new/updated files into a Mac destination folder.

**Architecture:** One Node.js process per device exposes a local HTTP control console and file receiver, broadcasts discovery packets over UDP, persists small JSON configuration/activity state, and keeps the source watcher behind a `SyncEngine` boundary. A static HTML/CSS/JS UI calls the local API and polls state.

**Tech Stack:** Node.js 22 standard library, native `node:test`, HTTP streaming, UDP broadcast, `fs.watch`, HTML/CSS/vanilla browser JavaScript.

---

### Task 1: Create the runnable project shell

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `README.md`
- Create: `src/cli.js`

**Step 1: Write the project metadata and CLI entrypoint.**

Add start/test scripts and a CLI that starts the Agent with `--port`, `--name`, and `--data-dir` overrides.

**Step 2: Run the CLI help and test discovery.**

Run: `node src/cli.js --help`

Expected: usage text exits successfully.

### Task 2: Implement config, state, and filesystem-safe utilities

**Files:**
- Create: `src/config.js`
- Create: `src/state.js`
- Create: `src/path-utils.js`
- Test: `test/path-utils.test.js`
- Test: `test/config.test.js`

**Step 1: Write failing tests for safe relative paths and config persistence.**

Cover nested paths, traversal rejection, default config creation, and reload.

**Step 2: Implement minimal utilities and JSON store.**

Use platform-specific app data defaults, with explicit `dataDir` overrides for tests.

**Step 3: Run unit tests.**

Run: `npm test -- --test-reporter=spec`

Expected: all tests pass.

### Task 3: Implement the HTTP file receiver

**Files:**
- Create: `src/receiver.js`
- Test: `test/receiver.test.js`

**Step 1: Write a test that PUTs a file into a temporary destination.**

Assert the file contents, nested directory creation, token rejection, and traversal rejection.

**Step 2: Implement streaming temp-file writes and atomic replacement.**

Only accept the paired source token and resolve paths below the configured destination root.

**Step 3: Run receiver tests.**

Run: `npm test -- --test-reporter=spec`

Expected: receiver tests pass.

### Task 4: Implement source sync engine and initial scan

**Files:**
- Create: `src/sync-engine.js`
- Test: `test/sync-engine.test.js`

**Step 1: Write a test for a new file and a changed file.**

Use a fake transport against a temporary source folder, then assert both relative paths and latest contents are sent.

**Step 2: Implement debounce, stability checks, initial recursive scan, and watcher lifecycle.**

Ignore deletes for V0.1 and serialize uploads to keep behavior predictable.

**Step 3: Run sync engine tests.**

Run: `npm test -- --test-reporter=spec`

Expected: all sync engine tests pass.

### Task 5: Add discovery, pairing, and Agent orchestration

**Files:**
- Create: `src/discovery.js`
- Create: `src/http-server.js`
- Create: `src/agent.js`
- Modify: `src/cli.js`
- Test: `test/agent.integration.test.js`

**Step 1: Write a two-agent integration test.**

Start source and destination agents on ephemeral ports with temporary folders, pair over HTTP, create/update a file, and assert the destination contents.

**Step 2: Implement HTTP APIs and UDP discovery.**

Provide `/api/state`, `/api/settings`, `/api/pair`, `/api/pair/accept`, `/api/ping`, and `/api/files`; use random pairing tokens and persist recent events.

**Step 3: Run the integration test.**

Run: `npm test -- --test-reporter=spec`

Expected: two-agent file sync passes without a database.

### Task 6: Build the local control console

**Files:**
- Create: `public/index.html`
- Create: `public/app.js`
- Create: `public/styles.css`
- Modify: `src/http-server.js`

**Step 1: Add the UI shell and empty/error/success states.**

Show online status, configured folders, discovered devices, pairing action, resync action, and recent activity.

**Step 2: Connect controls to the local API.**

Poll `/api/state`, save settings, pair a device, and trigger a resync.

**Step 3: Verify the served UI and API response.**

Run: `npm start -- --port 39875`, then `curl http://127.0.0.1:39875/api/state` and `curl http://127.0.0.1:39875/`.

Expected: JSON state contains device/config/activity fields and HTML contains the MyBridge console.

### Task 7: End-to-end acceptance run and documentation

**Files:**
- Modify: `README.md`

**Step 1: Run the complete local test suite.**

Run: `npm test`

Expected: all tests pass.

**Step 2: Run the two-process acceptance scenario.**

Use two temporary data directories and two ports on the same machine to simulate Windows source and Mac destination; create then modify a file and verify both contents.

**Step 3: Document the Windows/macOS setup and known V0.1 boundaries.**

Include commands, firewall note, local UI URL, and the fact that deletes are not synced.
