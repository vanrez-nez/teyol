import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function Footer() {
	return React.createElement(LabeledBox, { label: "footer", bgColor: "yellow" });
}
