import { Route, Routes } from "react-router-dom";
import { RepositoryList } from "./routes/RepositoryList";
import { Workspace } from "./routes/Workspace";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<RepositoryList />} />
      <Route path="/workspace/:repoId?" element={<Workspace />} />
    </Routes>
  );
}
