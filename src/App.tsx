import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { Layout } from './components/Layout';
import { RequireAuth, RequirePerm } from './components/Guards';
import { LoginPage } from './pages/Login';
import NotFound from './pages/NotFound';

const FilesPage = lazy(() => import('./pages/Files'));
const RefinePage = lazy(() => import('./grid/RefinePage'));
const EstadoPage = lazy(() => import('./pages/Estado'));

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage mode="login" />} />
      <Route path="/register" element={<LoginPage mode="register" />} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route path="/" element={<Navigate to="/files" replace />} />
        <Route path="/files" element={<RequirePerm perm="files:read"><FilesPage /></RequirePerm>} />
        <Route path="/files/:id/refine" element={<RequirePerm perm="files:read"><RefinePage /></RequirePerm>} />
        <Route path="/estado" element={<EstadoPage />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
