import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "ink";
import { TuiApp } from "../dist/shell/tui/index.js";

const rendered = renderToString(React.createElement(TuiApp));
for (const label of [
	"layout",
	"header",
	"timeline",
	"timeline-block",
	"sidebar",
	"footer",
	"prompt-input",
	"overlay",
]) {
	assert.match(rendered, new RegExp(label));
}

console.log("smoke ok");
