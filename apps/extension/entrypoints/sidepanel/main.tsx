import React from "react";
import ReactDOM from "react-dom/client";

import "@blueprint/ui/tokens.css";
import "./style.css";

import { App } from "./App";
import { initExtensionObservability } from "../../src/observability";

initExtensionObservability();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
