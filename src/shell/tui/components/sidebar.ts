import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function Sidebar() {
	return React.createElement(LabeledBox, { label: "sidebar", bgColor: "magenta" });
}
