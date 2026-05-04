import React from "react";
import { LabeledBox } from "./labeled-box.js";
import { TimelineBlock } from "./timeline-block.js";

export function Timeline() {
	return React.createElement(
		LabeledBox,
		{ label: "timeline", bgColor: "blue" },
		React.createElement(TimelineBlock),
	);
}
