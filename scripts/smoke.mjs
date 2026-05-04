import assert from "node:assert/strict";
import React from "react";
import { renderToString } from "ink";
import { HelloWorldApp } from "../dist/tui/index.js";

const rendered = renderToString(React.createElement(HelloWorldApp));
assert.match(rendered, /hello world/);

console.log("smoke ok");
