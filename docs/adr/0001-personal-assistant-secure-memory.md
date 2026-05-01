# ADR 0001: Personal Assistant With Secure Memory

## Status

Accepted.

## Context

Teyol is a fork of a coding-agent CLI, but its product boundary is different. Teyol is a local personal assistant and extensible power tool for users who want dependable access to LLMs, sessions, tools, skills, and extensions without making direct filesystem access the default interaction model.

The system should work as a secure back buffer for the user's mind: it can extract, organize, protect, and retrieve personal information. Coding-agent infrastructure can be reused where it supports that goal, but producing code is not the intended product model.

## Decision

Teyol will keep the agent/runtime concepts of tools, sessions, extensions, and skills, but will reshape them around a permissioned virtual layer.

Core principles:

- Sessions and memory are conceptually separate.
- Sessions are transcript/event history.
- Memory is curated structured knowledge derived from sessions, tools, imports, and user review.
- Both sessions and memory should live as first-class protected entities in a built-in encrypted storage service.
- The first storage implementation is one encrypted SQLite database per profile.
- JSONL session files are not the long-term storage boundary.
- Large files are stored as encrypted blobs outside SQLite and referenced by metadata rows.
- Extension and tool access is permissioned through service APIs, not direct raw file, DB, or session-manager access.

## Storage Model

Teyol will use a profile-scoped encrypted SQLite database as the first built-in storage layer. Each profile owns its sessions, memory records, extension records, notifications, permissions, metadata, and indexes.

The database should use WAL, foreign keys, explicit transactions, integrity checks, and rotating encrypted backups. Backups are part of the storage design because a single local database is a single failure unit.

SQLite is acceptable for the expected workload. Performance concerns should be handled first through schema design, indexes, FTS, transaction discipline, and moving large artifacts to encrypted blob storage. Splitting databases is reserved for later needs such as specialized vector indexes, sync units, or very high-volume extension writes.

## Encryption And Key Management

Storage is encrypted by default. Insecure mode exists only for explicit development and debugging.

Key handling:

- Use OS keychain or OS credential storage by default.
- Use passphrase-derived keys as fallback.
- Add pluggable key providers later.
- Avoid local raw key files outside insecure/dev mode.

Future cloud/self-hosted sync should operate over encrypted data and should not require the sync service to read plaintext.

## Memory Pipeline

The model must not freely write memories. Memory extraction is a pipeline:

1. Session events are persisted.
2. Pipeline stages inspect committed events.
3. Extractors create candidates.
4. Policy decides whether candidates block the current flow, go to sidebar backlog, are discarded, or require user review.
5. Accepted writes go through permission-checked storage APIs.

Default behavior:

- Explicit user intent, such as `/remember` or "remember that ...", creates a blocking timeline prompt.
- Proactive extraction and consolidation go to the sidebar/backlog.
- User review is authoritative.
- The backlog does not expire by default.
- Memory candidates are not active until accepted.

Candidate lifecycle:

- `proposed`: extractor created it; not active by default.
- `accepted`: user approved it; eligible for retrieval under policy.
- `discarded`: user rejected it; keep enough provenance to avoid repeated proposals.
- `superseded`: replaced by a later accepted/consolidated record.
- `archived`: valid but not normally injected into context.

Consolidation is non-destructive. It creates new accepted records linked to source records through provenance fields such as `derived_from`, `supersedes`, `confidence`, and `consolidation_reason`.

## Pipeline Models

Pipeline work uses registered models from the existing model registration system. The configuration is global-to-profile with optional stage overrides:

- conversational model
- transform/extraction model
- optional intent model
- optional extraction model
- optional consolidation model
- optional classification model

Fallback order:

1. Stage-specific model.
2. Profile transform model.
3. Current conversational model, with notification/audit note.
4. Wait if no model is available.

The configuration should not depend on "local" versus "remote" labels because users may host local models through LAN endpoints or custom providers.

## Permissions

Teyol will use phone-style roles and grants, not an extension scope as a permission substitute.

User-facing permission roles expand internally to granular capabilities. Example roles:

- Memory Reader
- Memory Writer
- Memory Curator
- Private Memory Reader
- Session Reader
- Blob Reader
- Blob Writer
- Network Client
- Secret Handler

Grant modes:

- Deny
- Allow Once
- Allow While Active
- Always Allow
- Allow Selected Scopes

Permissions are enforced by core service APIs. In v1, third-party extensions may still run in-process, but they should not receive raw DB handles, raw filesystem paths, auth storage, or unrestricted session managers.

## Sensitive Data

Assume anything relayed to an LLM is disclosed outside the trusted local boundary unless policy explicitly allows it.

Memory records need privacy and prompt-eligibility policy. Initial classes:

- `normal`: eligible for ordinary accepted-memory retrieval.
- `private`: requires direct user intent or one-time permission before use.
- `sealed`: never injected into LLM context.

Exact secrets are not stored from ordinary chat memory extraction. Passwords, seed phrases, private keys, full payment card data, and similar character-sensitive secrets must route to a dedicated non-LLM-visible capture flow or be blocked until that flow exists.

## UI Shell

Teyol v1 includes a full TUI redesign delivered in testable phases.

Permanent regions:

- Timeline: blocking or in-flow user decisions.
- Sidebar: asynchronous work, attention, notifications, backlog, background jobs.
- Footer: compact global state, badges, and status.
- Overlay/modal: focused flows such as login, unlock, editing, secure capture, and large selectors.

Extensions should not render arbitrary unframed UI into these regions. Core defines structured descriptors and renders the shell/envelope so users can always see source identity, requested actions, permissions used, and provenance.

The structured shell API is internal first. Built-in modules use the same descriptors intended for future extensions, but third-party extension access is gated until permissions and audit trails are enforced.

## Notifications

Teyol will have a central notification service. Notifications are async attention items by default.

Fields include source, severity, title, message, actions, placement, related entity, timestamps, and resolution state.

Footer shows badge counts only. Sidebar shows details and actions. Timeline is used only when the notification blocks a user-requested flow.

## Consequences

This decision requires significant refactoring of the current coding-agent-derived implementation:

- Session storage must move behind a storage backend and eventually into encrypted SQLite.
- Extension APIs must be narrowed around service capabilities.
- Current raw extension UI hooks need to be superseded by structured layout contracts.
- Memory and notification systems become first-class core services.
- Shell/coding assumptions should be removed from the product surface unless a trusted extension/profile enables them.

