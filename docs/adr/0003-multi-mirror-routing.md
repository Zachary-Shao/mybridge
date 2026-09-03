# ADR-0003: Route Multiple Folder Mirrors by Stable Mirror ID

## Status

Accepted

## Context

V0.2 stores one source folder and one destination folder. V0.3 needs multiple independent Windows project mirrors, while keeping the existing LAN discovery, pairing, streaming upload and atomic replacement path stable. A file's relative path alone is not enough to identify its destination once more than one project exists.

## Decision

Store mirror relationships in a local JSON `mirrors[]` array. Each enabled source mirror owns one existing `SyncEngine` instance with its own watcher and queue. Upload requests add a validated `mirrorId`; the Mac registers that ID after pairing and routes files below `mybridgeRoot/<targetFolderName>`. Target folder names are sanitized and made unique on the Mac. The old single-folder fields and `/api/files` behavior without `mirrorId` remain as a V0.2 compatibility path.

Ignore rules are shared local configuration, with conservative defaults for `.git`, `node_modules`, cache/log folders, editor swap files and temporary files. Removal only unregisters the relationship and stops the watcher; it never removes source or target files.

## Consequences

### Positive

- The existing streaming transport, token checks, path validation and atomic writes are reused.
- Each project has an independent watcher and visible runtime status.
- A target can safely create its own Mac-side folder without asking the user for a destination path.
- Re-registering a mirror after discovery makes restart and offline reconciliation idempotent.

### Negative

- A full reconciliation currently scans and uploads all non-ignored source files; there is no remote manifest or content hash database.
- Multiple watchers and sequential uploads are intentionally simple, so very large collections may take time to catch up.
- The custom Ignore Rules UI applies to all local mirrors rather than supporting per-mirror rule sets.

## Alternatives Considered

**One global destination with folder prefixes:** rejected because it couples unrelated projects and makes rename/removal behavior ambiguous.

**A database or remote manifest:** deferred; it would add persistence and protocol complexity outside the V0.3 personal-LAN scope.

**Syncthing integration:** deferred; the current validated Node transport already satisfies the one-way mirror acceptance path.
