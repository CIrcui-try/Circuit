import { useEffect } from "react";
import { Route, Routes } from "react-router-dom";
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
    <Routes>
      <Route path="/" element={<RepositoryList />} />
      <Route path="/workspace/:repoId?" element={<Workspace />} />
    </Routes>
  );
}
