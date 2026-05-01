# V1 Secure Memory Redesign Backlog

This backlog turns ADR 0001 into phased, testable slices. The goal is to ship the full v1 redesign through stable contracts, not a temporary minimal UI that gets replaced later.

## Phase 1: Shell And Contract Foundation

Goal: prove the permanent TUI shell and structured UI contracts while keeping existing chat functional.

Issues:

1. Define shell contracts.
   - Add internal types for layout regions, source identity, action descriptors, widget descriptors, notification descriptors, and audit/provenance references.
   - Acceptance: descriptors are serializable and do not require raw TUI components.

2. Build the new shell layout.
   - Add timeline, sidebar, footer, and overlay regions around the current chat experience.
   - Acceptance: existing interactive chat still works in the timeline region.

3. Add sidebar panel registry.
   - Core can register internal panels by ID, title, source, priority, and render descriptor.
   - Acceptance: a demo/internal panel can be shown, hidden, and updated without replacing chat.

4. Add footer slot and badge registry.
   - Footer supports compact status and notification counts without becoming a dumping ground.
   - Acceptance: footer can show `1 notification` while preserving model/context status.

5. Add structured widget envelope rendering.
   - Every widget displays source identity, action area, and optional permission/data-access summary.
   - Acceptance: demo timeline and sidebar widgets make their source obvious.

6. Mark raw extension UI components as legacy internally.
   - Keep compatibility, but route built-in behavior toward descriptors.
   - Acceptance: no third-party public contract is promised for the new shell yet.

## Phase 2: Notification Center

Goal: route async attention through sidebar/footer and blocking decisions through timeline.

Issues:

1. Implement notification service.
   - Fields: source, severity, title, message, actions, placement, related entity, timestamps, read/resolved state.
   - Acceptance: notifications can be created, listed, resolved, and counted.

2. Connect footer badge to notification service.
   - Acceptance: footer displays compact counts by attention/error state.

3. Connect sidebar notification panel.
   - Acceptance: user can inspect details and invoke descriptor actions from sidebar.

4. Add timeline blocking notification/widget path.
   - Acceptance: a notification can be escalated into timeline only when it blocks current user flow.

5. Add audit/provenance fields to notification actions.
   - Acceptance: action execution records source and related entity.

## Phase 3: Permission Model

Goal: establish phone-style roles and service-enforced grants before exposing personal data to extensions.

Issues:

1. Define permission roles and grant modes.
   - Roles: Memory Reader, Memory Writer, Memory Curator, Private Memory Reader, Session Reader, Blob Reader, Blob Writer, Network Client, Secret Handler.
   - Grant modes: Deny, Allow Once, Allow While Active, Always Allow, Allow Selected Scopes.
   - Acceptance: roles expand to granular capabilities internally.

2. Add permission service API.
   - Acceptance: core code can ask whether actor X may perform capability Y on scope Z.

3. Add permission prompt widget descriptor.
   - Acceptance: permission prompts show source identity, requested roles, data scope, and grant choices.

4. Add actor identity to internal service calls.
   - Actors: core, user, extension ID, pipeline stage.
   - Acceptance: storage-like calls cannot omit actor identity.

5. Restrict extension context.
   - Remove or wrap raw access to session/storage internals for new internal APIs.
   - Acceptance: built-in modules consume capability services instead of raw DB/session handles where practical.

## Phase 4: Encrypted Profile Storage

Goal: make sessions and memory first-class protected data in one encrypted SQLite database per profile.

Issues:

1. Select SQLite encryption approach.
   - Evaluate package fit with Node 20, builds, portability, WAL support, backup behavior, and key handling.
   - Acceptance: choice documented before implementation.

2. Add profile storage service.
   - One encrypted DB per profile.
   - Include metadata, migrations, integrity checks, WAL, foreign keys, and transaction helpers.
   - Acceptance: storage opens through OS keychain or passphrase fallback.

3. Add encrypted backup rotation.
   - Acceptance: storage can create and verify backup snapshots.

4. Move session persistence behind a backend interface.
   - Acceptance: current session manager can use a DB-backed implementation without JSONL as the canonical store.

5. Store session events in SQLite.
   - Preserve session branching, compaction entries, model changes, labels, and custom entries.
   - Acceptance: create/resume/fork/list sessions pass against DB-backed sessions.

6. Add basic FTS/search tables.
   - Acceptance: sessions and accepted memory records can be searched without embeddings.

## Phase 5: Memory Backlog Pipeline

Goal: implement memory as proposed, reviewed, accepted, and consolidated records.

Issues:

1. Define memory record schema.
   - Include status, privacy class, scope, owner/source, provenance, timestamps, tags, and consolidation links.
   - Acceptance: records support proposed, accepted, discarded, superseded, archived.

2. Define pipeline job schema.
   - Include stage, model provenance, prompt version, input refs, output refs, status, errors, fallback model note.
   - Acceptance: failed jobs create notifications instead of interrupting chat.

3. Add deterministic intent gate.
   - Recognize `/remember`, `/forget`, "remember that ...", "save this ...", "forget that ...".
   - Acceptance: explicit memory intent creates timeline review widget.

4. Add transform/extraction model configuration.
   - Global-to-profile config with per-stage overrides and current-model fallback.
   - Acceptance: missing transform model creates a notification and uses current model only with audit note.

5. Add memory candidate review UI.
   - Timeline for explicit requests.
   - Sidebar backlog for proactive extraction.
   - Acceptance: user can accept, edit, discard, classify privacy, and see provenance.

6. Add accepted-memory retrieval path.
   - Only accepted normal memories are injected by default.
   - Acceptance: "what do you remember about X?" retrieves policy-allowed records.

7. Add non-destructive consolidation.
   - Create new records that supersede/derive from old records.
   - Acceptance: originals remain queryable for provenance.

## Phase 6: Blob And Secret Boundaries

Goal: prepare for files and exact secrets without leaking them through LLM transcripts.

Issues:

1. Add encrypted blob metadata schema.
   - Metadata in SQLite, bytes outside DB as encrypted content-addressed blobs.
   - Acceptance: blob IDs are capability handles, not raw paths.

2. Add blob service primitives.
   - Store, read, delete, version, authorize.
   - Acceptance: extensions can only access blobs through permission-checked APIs.

3. Add secret-capture design doc.
   - Define non-LLM-visible capture, exact-character preservation, confirmation UX, and hard-block categories.
   - Acceptance: ordinary memory extraction blocks raw passwords, seed phrases, private keys, and full payment card data.

4. Add sealed/private retrieval policy tests.
   - Acceptance: sealed records never enter LLM context; private records require explicit user intent or grant.

## Phase 7: Extension Hardening

Goal: align extensions with the new service and UI boundaries.

Issues:

1. Add manifest role declarations.
   - Acceptance: extensions can declare requested roles before activation.

2. Gate extension access through permission service.
   - Acceptance: memory/session/blob/model APIs enforce grants.

3. Expose structured widget API to trusted/bundled extensions.
   - Acceptance: bundled extensions can create sidebar/timeline/footer descriptors with source identity.

4. Add audit logs for permissioned extension actions.
   - Acceptance: user can inspect extension reads/writes/actions.

5. Plan v2 sandboxing.
   - Document worker/subprocess RPC boundary for third-party extensions.
   - Acceptance: v1 does not pretend in-process JS is a sandbox.

