import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function Header() {
	return React.createElement(LabeledBox, { label: "header", bgColor: "cyan" });
}
