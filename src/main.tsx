import "./instrument";

import { reactErrorHandler } from "@sentry/react";
import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!, {
  onUncaughtError: reactErrorHandler(),
  onCaughtError: reactErrorHandler(),
  onRecoverableError: reactErrorHandler(),
}).render(<App />);
