import React from "react";
import ReactDOM from "react-dom/client";

import "@blueprint/ui/styles.css";
import "./style.css";

import { App } from "./App";
import { initExtensionObservability } from "../../src/observability";

initExtensionObservability();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><App /></React.StrictMode>,
);
