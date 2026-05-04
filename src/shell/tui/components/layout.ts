import React from "react";
import { Box } from "ink";
import { Footer } from "./footer.js";
import { Header } from "./header.js";
import { LabeledBox } from "./labeled-box.js";
import { Overlay } from "./overlay.js";
import { PromptInput } from "./prompt-input.js";
import { Sidebar } from "./sidebar.js";
import { Timeline } from "./timeline.js";

export function Layout() {
	return React.createElement(
		LabeledBox,
		{ label: "layout", bgColor: "black" },
		React.createElement(Header),
		React.createElement(
			Box,
			{ flexDirection: "row" },
			React.createElement(Timeline),
			React.createElement(Sidebar),
		),
		React.createElement(Footer),
		React.createElement(PromptInput),
		React.createElement(Overlay),
	);
}
