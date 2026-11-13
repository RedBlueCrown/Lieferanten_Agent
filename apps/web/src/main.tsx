import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import './styles/tokens.css';
import './styles/app.css';
import './styles/pages.css';
import { api } from './lib/api';
import { useAuth, type Me } from './lib/auth';
import { Shell } from './components/Shell';
import { Skeleton } from './components/ui';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { Lieferanten, LieferantDetail } from './pages/Lieferanten';
import { Vertraege } from './pages/Vertraege';
import { Erfassen, ErfassungPruefen } from './pages/Erfassen';
import { Ordner } from './pages/Ordner';
import { NeuerVorgang } from './pages/NeuerVorgang';
import { VorgangDetail } from './pages/VorgangDetail';
import { PruefungDetail } from './pages/PruefungDetail';
import { Pruefstandards } from './pages/Pruefstandards';
import { Protokoll } from './pages/Protokoll';

const qc = new QueryClient({ defaultOptions: { queries: { staleTime: 10_000, retry: 1, refetchOnWindowFocus: false } } });

function App() {
  const token = useAuth((s) => s.token);
  const setMe = useAuth((s) => s.setMe);
  const current = useAuth((s) => s.me);
  const me = useQuery({ queryKey: ['me', token], queryFn: () => api.get<Me>('/api/v1/me'), enabled: !!token });
  useEffect(() => {
    if (me.data) setMe(me.data);
  }, [me.data, setMe]);

  if (!token) return <Login />;
  if (!me.data || !current) return <Skeleton rows={6} />;
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Home />} />
        <Route path="lieferanten" element={<Lieferanten />} />
        <Route path="lieferanten/:id" element={<LieferantDetail />} />
        <Route path="vertraege" element={<Vertraege />} />
        <Route path="erfassen" element={<Erfassen />} />
        <Route path="erfassen/:jobId" element={<ErfassungPruefen />} />
        <Route path="ordner" element={<Ordner />} />
        <Route path="vorgaenge/neu" element={<NeuerVorgang />} />
        <Route path="vorgaenge/:id" element={<VorgangDetail />} />
        <Route path="pruefungen/:id" element={<PruefungDetail />} />
        <Route path="pruefstandards" element={<Pruefstandards />} />
        <Route path="protokoll" element={<Protokoll />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <App />
        <Toaster position="bottom-right" closeButton richColors={false} />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
