# V1 Shell Descriptor Contracts

This document records the current design intent behind the first V1 shell descriptor contracts.

The descriptor shapes and naming rules in this document are binding for issue #1. The usage examples are reasoning scenarios only. They are not final public APIs, not extension API requirements, and not commitments for later issues. Later issues must re-evaluate those scenarios against their own requirements before implementation.

## Binding Decisions For Issue #1

### Identity Model

All tracked descriptor objects use:

- `scope`: semantic namespace, ownership, and object type.
- `id`: core-generated unique identity for the object instance.

Rules:

- Do not encode scope into `id`.
- Do not use `id` to mean namespace/source.
- Do not use type-prefixed fields like `descriptorId`, `sourceId`, or `notificationId`.
- Extensions receive generated IDs for tracking; they do not author internal IDs.
- Use `key` for local action choices scoped to a descriptor.

### Descriptor Reference

```ts
interface DescriptorRef {
  id: string;
}
```

Refs intentionally include only `id`. Scope, label, and other metadata are resolved through the timeline/descriptor registry.

### Presentation Descriptor

```ts
interface PresentationDescriptor {
  scope: string;
  id: string;
  region: "timeline" | "sidebar";
  label: string;
  body?: string;
  parent?: DescriptorRef;
  actions?: ActionDescriptor[];
}
```

`body` may contain markdown. Each renderer decides which markdown subset is supported and sanitized.

`parent` links this descriptor to one previous tracked descriptor for timeline/log visualization. Multi-source domain provenance belongs in domain schemas, not generic presentation descriptors.

### Action Descriptor

```ts
interface ActionDescriptor {
  key: string | number;
  label: string;
  style?: "primary" | "secondary" | "danger";
}
```

Actions are presentation-only choices. They do not contain payloads, intents, handlers, callbacks, or arbitrary data.

### Notification Descriptor

```ts
interface NotificationDescriptor {
  scope: string;
  id: string;
  flow: "sync" | "async";
  style?: "neutral" | "info" | "success" | "warning" | "error";
  label: string;
  body?: string;
  parent?: DescriptorRef;
  dismissible?: boolean;
}
```

Notifications are handled by the notification service, not by generic presentation rendering.

- `flow: "sync"` means immediate timeline surfacing.
- `flow: "async"` means sidebar first, timeline when reviewed.
- When a notification is pushed to the timeline, it is marked read.
- Notifications do not define actions.
- `dismissible` enables normalized core dismiss behavior.

### Status Descriptor

```ts
interface StatusDescriptor {
  scope: string;
  id: string;
  region: "footer";
  label: string;
  style?: "neutral" | "info" | "success" | "warning" | "error";
}
```

Statuses are compact shell status objects. They have no body and no actions.

### Explicit Non-Goals

These contracts do not include:

- raw TUI components
- extension-controlled source objects
- `kind` runtime discriminators
- action payloads or intents
- arbitrary `data`
- custom dismiss actions
- footer bodies/actions
- notification action buttons
- overlay/modal regions
- extra top-level properties

Descriptor schemas should be closed and reject unknown top-level fields.

## Reasoning Scenarios

The examples below are not final APIs. They show the scenarios considered while defining issue #1's internal descriptor shapes. Later issues must validate or revise these flows before implementing them.

### Scenario: Async Notification Followed By Timeline Action

A future extension might push an async notification and receive a core-generated ID:

```ts
const notification = notifications.push({
  flow: "async",
  style: "warning",
  label: "Calendar needs configuration",
  body: "Calendar sync cannot continue until an account is selected.",
  dismissible: true,
});
```

If the extension later needs user interaction, it might listen for the notification being read and push a separate timeline presentation:

```ts
notifications.on(`read:${notification.id}`, () => {
  timeline.push({
    label: "Configure Calendar?",
    body: "Choose how Calendar should continue.",
    parent: { id: notification.id },
    actions: [
      { key: "configure", label: "Configure", style: "primary" },
      { key: "skip", label: "Skip", style: "secondary" },
    ],
  });
});
```

This scenario motivated separating notification descriptors from action-bearing presentation descriptors. It does not finalize the extension API.

### Scenario: Timeline Parent Link

A follow-up presentation can point at one previous descriptor:

```ts
{
  scope: "extension.calendar.prompt",
  id: "prompt_456",
  region: "timeline",
  label: "Configure Calendar?",
  parent: { id: "notif_123" },
}
```

This scenario motivated using singular `parent` instead of array-based provenance.

### Scenario: Footer Status Instead Of Notification Spam

An extension may eventually expose low-noise status:

```ts
{
  scope: "extension.calendar.status",
  id: "status_001",
  region: "footer",
  label: "Calendar syncing",
  style: "info",
}
```

This scenario motivated defining `StatusDescriptor` separately from notifications.
