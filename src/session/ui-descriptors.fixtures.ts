import { TypeCompiler } from "@sinclair/typebox/compiler";
import {
	ActionDescriptorSchema,
	DescriptorRefSchema,
	NotificationDescriptorSchema,
	type NotificationDescriptor,
	PresentationDescriptorSchema,
	type PresentationDescriptor,
	StatusDescriptorSchema,
	type StatusDescriptor,
} from "./ui-descriptors.js";

export interface UiDescriptorFixtureValidation {
	name: string;
	expected: boolean;
	actual: boolean;
}

const presentationDescriptorFixture: PresentationDescriptor = {
	scope: "core.memory.review",
	id: "mem_cand_123",
	region: "timeline",
	label: "Review memory candidate",
	body: "Remember: **Prefer concise engineering plans.**",
	parent: { id: "entry_456" },
	actions: [
		{ key: "accept", label: "Accept", style: "primary" },
		{ key: "discard", label: "Discard", style: "danger" },
	],
};

const notificationDescriptorFixture: NotificationDescriptor = {
	scope: "extension.calendar.notification",
	id: "notif_123",
	flow: "async",
	style: "warning",
	label: "Calendar needs configuration",
	body: "Calendar sync cannot continue until an account is selected.",
	dismissible: true,
};

const statusDescriptorFixture: StatusDescriptor = {
	scope: "extension.calendar.status",
	id: "status_001",
	region: "footer",
	label: "Calendar syncing",
	style: "info",
};

const descriptorRefValidator = TypeCompiler.Compile(DescriptorRefSchema);
const actionDescriptorValidator = TypeCompiler.Compile(ActionDescriptorSchema);
const presentationDescriptorValidator = TypeCompiler.Compile(PresentationDescriptorSchema);
const notificationDescriptorValidator = TypeCompiler.Compile(NotificationDescriptorSchema);
const statusDescriptorValidator = TypeCompiler.Compile(StatusDescriptorSchema);

export function validateUiDescriptorFixtures(): UiDescriptorFixtureValidation[] {
	return [
		{
			name: "descriptor ref accepts only id",
			expected: true,
			actual: descriptorRefValidator.Check({ id: "notif_123" }),
		},
		{
			name: "action descriptor accepts local numeric key",
			expected: true,
			actual: actionDescriptorValidator.Check({ key: 1, label: "One", style: "secondary" }),
		},
		{
			name: "presentation descriptor accepts timeline actions and parent",
			expected: true,
			actual: presentationDescriptorValidator.Check(roundTrip(presentationDescriptorFixture)),
		},
		{
			name: "notification descriptor accepts async dismissible notification",
			expected: true,
			actual: notificationDescriptorValidator.Check(roundTrip(notificationDescriptorFixture)),
		},
		{
			name: "status descriptor accepts footer status",
			expected: true,
			actual: statusDescriptorValidator.Check(roundTrip(statusDescriptorFixture)),
		},
		{
			name: "presentation descriptor rejects unknown top-level properties",
			expected: false,
			actual: presentationDescriptorValidator.Check({ ...presentationDescriptorFixture, data: {} }),
		},
		{
			name: "action descriptor rejects payload",
			expected: false,
			actual: actionDescriptorValidator.Check({ key: "accept", label: "Accept", payload: { id: "x" } }),
		},
		{
			name: "notification descriptor rejects actions",
			expected: false,
			actual: notificationDescriptorValidator.Check({ ...notificationDescriptorFixture, actions: [] }),
		},
		{
			name: "status descriptor rejects body",
			expected: false,
			actual: statusDescriptorValidator.Check({ ...statusDescriptorFixture, body: "extra detail" }),
		},
	];
}

function roundTrip<T>(value: T): unknown {
	return JSON.parse(JSON.stringify(value));
}
