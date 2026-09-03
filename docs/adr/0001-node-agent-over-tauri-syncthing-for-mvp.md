# ADR-0001: Use a dependency-light Node Agent for V0.1

## Status

Accepted

## Context

MyBridge V0.1 needs a real Windows → Mac LAN file-sync loop with no login, cloud service, database, or public-network transport. The current workspace is empty. Node.js 22 is installed, while Rust and Tauri are not. Syncthing is mature, but embedding and managing its process/configuration lifecycle would add setup and debugging cost before the first acceptance test.

## Decision

Implement the first vertical slice as one cross-platform Node.js Agent using only Node standard-library modules plus a static local web UI. Keep discovery, pairing, transport, file watching, and UI state in separate modules. Store configuration and recent activity in a small platform-specific JSON file. Reserve a future adapter boundary around the sync engine so Syncthing or a Tauri shell can replace the transport later.

## Consequences

### Positive

- Runs on Windows and macOS with the existing Node runtime.
- No package installation or database is needed for the MVP.
- HTTP requests, file writes, and state transitions are easy to inspect during vibe coding.
- The sync core can be reused by a future Tauri/React desktop shell.

### Negative

- V0.1 requires Node.js to be installed and a browser for the local console.
- `fs.watch` behavior is OS-dependent and needs explicit validation on both target OSes.
- The protocol is intentionally smaller and less battle-tested than Syncthing.
- Large-file resume, bandwidth shaping, encryption, and conflict handling are deferred.

### Neutral

- A JSON config file is local application state, not a database.
- Pairing uses a random token but no user account or central identity service.

## Alternatives Considered

**Tauri + React + Syncthing**

Rejected for the first runnable slice because the current environment lacks Rust and the integration introduces multiple process lifecycles. Revisit after the core acceptance flow is stable.

**Electron + Node**

Rejected because it increases package size and moving parts without improving the sync proof of concept.

**Syncthing standalone with a thin UI**

Rejected for V0.1 because pairing, folder IDs, and process management would become the main work instead of the requested file-sync loop.

