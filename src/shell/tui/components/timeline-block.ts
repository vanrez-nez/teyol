import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function TimelineBlock() {
	return React.createElement(LabeledBox, { label: "timeline-block", bgColor: "green" });
}
