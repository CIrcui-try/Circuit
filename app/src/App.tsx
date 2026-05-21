import { useEffect } from "react";
import { Route, Routes, useNavigate } from "react-router-dom";
import { AppErrorAlert } from "./components/AppErrorAlert";
import { AppIconRunBadge } from "./components/AppIconRunBadge";
import { AppRunCompletionNotification } from "./components/AppRunCompletionNotification";
import { getHostBridge } from "./host/bridge";
import { RepositoryList } from "./routes/RepositoryList";
import { Workspace } from "./routes/Workspace";
import { useLayoutStore } from "./stores/layoutStore";
import { useRepositoryStore } from "./stores/repositoryStore";

export default function App() {
  useEffect(() => {
    useRepositoryStore.getState().hydrate();
    void useLayoutStore.getState().hydrate();
  }, []);

  return (
    <>
      <AppErrorAlert />
      <AppIconRunBadge />
      <AppRunCompletionNotification />
      <AppNotificationNavigator />
      <Routes>
        <Route path="/" element={<RepositoryList />} />
        <Route path="/workspace/:repoId?" element={<Workspace />} />
      </Routes>
    </>
  );
}

function AppNotificationNavigator() {
  const navigate = useNavigate();

  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | null = null;

    void getHostBridge()
      .onRunCompletionNotificationClicked?.((repositoryId) => {
        navigate(`/workspace/${encodeURIComponent(repositoryId)}`);
      })
      .then((nextUnsubscribe) => {
        if (active) {
          unsubscribe = nextUnsubscribe ?? null;
        } else {
          nextUnsubscribe?.();
        }
      })
      .catch((error: unknown) => {
        console.warn("[AppNotificationNavigator] failed to observe notifications", error);
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [navigate]);

  return null;
}
