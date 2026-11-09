import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AuthProvider } from './auth/AuthContext';
import { HealthGate } from './components/HealthGate';
import { ErrorBoundary } from './components/ErrorBoundary';

const root = document.getElementById('root');
if (!root) throw new Error('Falta #root');
createRoot(root).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <HealthGate>
          <AuthProvider>
            <App />
          </AuthProvider>
        </HealthGate>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
);
