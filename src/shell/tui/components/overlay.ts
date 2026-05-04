import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function Overlay() {
	return React.createElement(LabeledBox, { label: "overlay", bgColor: "red" });
}
