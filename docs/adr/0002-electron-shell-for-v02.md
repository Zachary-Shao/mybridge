# ADR-0002: Use Electron as the V0.2 Desktop Shell

## Status

Accepted

## Context

V0.1 already has a working Node.js Agent and local browser console. V0.2 requires an installable Windows/macOS application with a hidden-on-close window, system tray, native folder dialogs, auto-launch, and resilient background runtime. The current development environment has Node.js 22 but no `rustc`, `cargo`, or `cargo-tauri`.

## Decision

Use Electron for V0.2 and run the existing `Agent` inside Electron's main process. Load the existing HTTP UI in a `BrowserWindow`, expose only narrow native actions through a context-isolated preload bridge, and keep the sync engine/API protocol unchanged. Package with electron-builder for macOS and Windows targets.

## Consequences

### Positive

- Fastest path to an actual desktop window and tray on both target OSes.
- Native directory picker and login-item APIs are available without redesigning the Agent.
- Existing CLI and tests remain useful for diagnostics and regression coverage.
- Future Tauri migration can replace the shell while reusing the Agent.

### Negative

- Larger installer and higher idle memory usage than Tauri.
- Electron packaging/signing and per-platform smoke tests are still required.
- The UI is still served by the local Agent rather than being bundled as a direct frontend asset.

### Neutral

- `nodeIntegration` remains disabled; renderer native access goes through preload IPC only.
- The Agent still listens on a localhost HTTP port for the renderer and LAN HTTP for the peer.

## Alternatives Considered

**Tauri**

Deferred because Rust/Tauri are not installed in the current environment and adding that toolchain is not required to preserve the validated sync core.

**Continue with browser-only Agent**

Rejected because it fails the user's install/no-terminal/no-localhost acceptance criteria and cannot provide a real tray lifecycle.

**Rewrite the sync core around Syncthing**

Rejected because V0.2 is a packaging and lifecycle milestone, not a protocol rewrite; the current core already passes the required sync acceptance flow.

