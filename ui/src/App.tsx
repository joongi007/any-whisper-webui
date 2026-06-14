import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./components/layout/AppShell";
import { useSettingsDialog } from "./components/settings/SettingsDialog";
import { DashboardPage } from "./routes/DashboardPage";
import { FilePage } from "./routes/FilePage";
import { HistoryPage } from "./routes/HistoryPage";
import { JobDetailPage } from "./routes/JobDetailPage";
import { RealtimePage } from "./routes/RealtimePage";
import { YouTubePage } from "./routes/YouTubePage";

/** Settings is a global dialog, not a page. A direct /settings link opens the
 *  dialog over the dashboard so the URL still works. */
function SettingsRedirect() {
  const openSettings = useSettingsDialog();
  useEffect(() => { openSettings(); }, [openSettings]);
  return <Navigate to="/" replace />;
}

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/file" element={<FilePage />} />
        <Route path="/youtube" element={<YouTubePage />} />
        <Route path="/realtime" element={<RealtimePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/jobs/:id" element={<JobDetailPage />} />
        <Route path="/settings" element={<SettingsRedirect />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </AppShell>
  );
}
