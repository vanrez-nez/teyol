# V1 State Layer Good Practices

This document defines how state should be introduced and refactored in the V1 CLI shell.

The goal is not to change current behavior. The goal is to create a clear state Module with explicit seams for validation, reactivity, persistence, and inspection.

## Core Rule

State Modules use Effector and TypeScript.

State is not every property on an object.

A value belongs in the CLI state Module only when it is:

- needed to reconstruct the CLI shell with its last semantic state, or
- consumed or reacted to by more than one Module.

Internal Adapter state may stay local when no other Module consumes it and it is not needed for shell reconstruction.

TypeBox is only for ingress adapters that receive unknown, serialized, or untrusted data.

Do not mirror internal state with TypeBox schemas by default.

## State Boundary

Good CLI state candidates:

- shell display preferences such as tool expansion and thinking visibility
- pending queues rendered in one place and modified in another
- footer status data written by extension-facing code and rendered by the footer
- future descriptors shared by timeline, sidebar, footer, logs, and action waiters
- future notification read/review state shared by sidebar, timeline, and counters

Poor CLI state candidates:

- TUI components, containers, loaders, timers, and text instances
- unsubscribe callbacks, signal cleanup callbacks, and dispose handles
- input timing details such as double-escape or double-interrupt timestamps
- render optimizations such as cached last status text components
- object lifecycle flags with no shell-state meaning

Timeline state must not become a second message history. Session messages remain canonical in `SessionManager` and `AgentSession`. Future timeline state should cover shell descriptor entities that do not already have a canonical owner.

## Responsibilities

### Validation

Validation belongs at ingress seams:

- LLM tool-call arguments.
- Extension public call inputs.
- RPC payloads.
- User/project JSON or YAML files.
- Theme files.
- Imported/restored artifacts.

Ingress adapters validate and translate external payloads into trusted internal events.

Do not put TypeBox validation in reducers, selectors, derived stores, or trusted internal event paths.

### Reactivity

Effector owns state reactivity:

- State changes happen through named events.
- Stores are updated from events.
- Adapters subscribe to stores and render/apply effects.
- Callers do not mutate store state directly.

The Interface of a state Module is its events, stores, selectors, and documented invariants.

### Serialization And Persistence

Persistence is explicit and adapter-owned.

Do not persist Effector store shapes by default. A persistence/import Module owns its artifact format, validates that artifact at ingress, and translates it into internal events.

If a persisted artifact resembles an internal store, that resemblance is not a contract unless the persistence Module explicitly documents it as one.

### Inspection

Inspection observes Effector events and stores.

Inspection must avoid logging raw prompt bodies, secrets, API keys, OAuth tokens, and large payloads by default. Prefer event names, ids, scopes, counts, and summarized values.

## TypeBox Boundary

Allowed:

```ts
// Extension ingress adapter.
const input = parseExtensionNotificationInput(raw);

notificationRequested({
	scope,
	label: input.label,
	body: input.body,
});
```

Not allowed:

```ts
// Internal store shape duplicated as schema without owning an ingress artifact.
export const NotificationStateSchema = Type.Object({
	byId: Type.Record(Type.String(), NotificationRecordSchema),
	orderedIds: Type.Array(Type.String()),
});
```

## Effector Boundary

Allowed:

```ts
export const notificationRequested = createEvent<NotificationRequested>();

export const $notifications = createStore<NotificationsState>(initialState).on(
	notificationRequested,
	(state, event) => addNotification(state, event),
);
```

Not allowed:

```ts
// External adapter mutates store-owned data directly.
$notifications.getState().orderedIds.push(id);
```

## First Refactor Rule

The first CLI state refactor must preserve current logic and flow.

Move shared or reconstructable shell data behind state Modules first. Later issues can merge, remove, or optimize how shell entities communicate once the seams are explicit.
