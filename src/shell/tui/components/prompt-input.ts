import React from "react";
import { LabeledBox } from "./labeled-box.js";

export function PromptInput() {
	return React.createElement(LabeledBox, { label: "prompt-input", bgColor: "gray" });
}
