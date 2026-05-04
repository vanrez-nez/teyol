import React, { type ReactNode } from "react";
import { Box, Text } from "ink";

interface LabeledBoxProps {
	label: string;
	bgColor: string;
	children?: ReactNode;
}

export function LabeledBox({ label, bgColor, children }: LabeledBoxProps) {
	return React.createElement(
		Box,
		{ bgColor, flexDirection: "column", paddingX: 1 },
		React.createElement(Text, null, label),
		children,
	);
}
