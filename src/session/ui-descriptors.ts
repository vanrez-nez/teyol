import { type Static, Type } from "@sinclair/typebox";

const strict = { additionalProperties: false } as const;

/**
 * Identity and scope rule:
 *
 * - `scope` is the semantic namespace, ownership, and object type.
 * - `id` is the core-generated unique identity for the object instance.
 * - Do not encode scope into `id`.
 * - Do not use `id` to mean namespace/source.
 * - Do not use type-prefixed fields like `descriptorId`, `sourceId`, or `notificationId`.
 * - Use `key` for local action choices scoped to a descriptor.
 */

export const ShellRegionSchema = Type.Union([
	Type.Literal("timeline"),
	Type.Literal("sidebar"),
	Type.Literal("footer"),
]);
export type ShellRegion = Static<typeof ShellRegionSchema>;

export const PresentationRegionSchema = Type.Union([Type.Literal("timeline"), Type.Literal("sidebar")]);
export type PresentationRegion = Static<typeof PresentationRegionSchema>;

export const ActionStyleSchema = Type.Union([
	Type.Literal("primary"),
	Type.Literal("secondary"),
	Type.Literal("danger"),
]);
export type ActionStyle = Static<typeof ActionStyleSchema>;

export const StateStyleSchema = Type.Union([
	Type.Literal("neutral"),
	Type.Literal("info"),
	Type.Literal("success"),
	Type.Literal("warning"),
	Type.Literal("error"),
]);
export type StateStyle = Static<typeof StateStyleSchema>;

export const NotificationFlowSchema = Type.Union([Type.Literal("sync"), Type.Literal("async")]);
export type NotificationFlow = Static<typeof NotificationFlowSchema>;

export const DescriptorRefSchema = Type.Object(
	{
		id: Type.String(),
	},
	strict,
);
export type DescriptorRef = Static<typeof DescriptorRefSchema>;

export const ActionDescriptorSchema = Type.Object(
	{
		key: Type.Union([Type.String(), Type.Number()]),
		label: Type.String(),
		style: Type.Optional(ActionStyleSchema),
	},
	strict,
);
export type ActionDescriptor = Static<typeof ActionDescriptorSchema>;

export const PresentationDescriptorSchema = Type.Object(
	{
		scope: Type.String(),
		id: Type.String(),
		region: PresentationRegionSchema,
		label: Type.String(),
		body: Type.Optional(Type.String()),
		parent: Type.Optional(DescriptorRefSchema),
		actions: Type.Optional(Type.Array(ActionDescriptorSchema)),
	},
	strict,
);
export type PresentationDescriptor = Static<typeof PresentationDescriptorSchema>;

export const NotificationDescriptorSchema = Type.Object(
	{
		scope: Type.String(),
		id: Type.String(),
		flow: NotificationFlowSchema,
		style: Type.Optional(StateStyleSchema),
		label: Type.String(),
		body: Type.Optional(Type.String()),
		parent: Type.Optional(DescriptorRefSchema),
		dismissible: Type.Optional(Type.Boolean()),
	},
	strict,
);
export type NotificationDescriptor = Static<typeof NotificationDescriptorSchema>;

export const StatusDescriptorSchema = Type.Object(
	{
		scope: Type.String(),
		id: Type.String(),
		region: Type.Literal("footer"),
		label: Type.String(),
		style: Type.Optional(StateStyleSchema),
	},
	strict,
);
export type StatusDescriptor = Static<typeof StatusDescriptorSchema>;
