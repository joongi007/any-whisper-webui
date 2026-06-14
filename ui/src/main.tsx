import { CssBaseline, ThemeProvider } from "@mui/material";
import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { I18nextProvider } from "react-i18next";
import { BrowserRouter } from "react-router-dom";

import "./i18n";
import "./index.css";

import { App } from "./App";
import { i18n } from "./i18n";
import { queryClient } from "./lib/queryClient";
import { useThemeStore } from "./stores/themeStore";
import { buildTheme } from "./theme";

function Root() {
  const mode = useThemeStore((s) => s.resolvedMode());
  document.documentElement.setAttribute("data-theme", mode);
  return (
    <ThemeProvider theme={buildTheme(mode)}>
      <CssBaseline />
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </QueryClientProvider>
      </I18nextProvider>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
