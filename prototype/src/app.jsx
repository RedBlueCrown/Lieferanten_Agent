function App() {
  const [logged, setLogged] = useState(() => localStorage.getItem('llv-vm-login') === '1');
  const [state, setState] = useState(() => { try { const s = JSON.parse(localStorage.getItem(STORE_KEY)); if (s && s.lieferanten) return s; } catch (e) {} return initialState(); });
  const [rolle, setRolleS] = useState(() => localStorage.getItem('llv-vm-rolle') || 'Lieferantenmanager');
  const [route, setRoute] = useState(() => { try { return JSON.parse(localStorage.getItem('llv-vm-route')) || { page: 'home', p: {} }; } catch (e) { return { page: 'home', p: {} }; } });
  const [toasts, setToasts] = useState([]);
  const [job, setJob] = useState(null);
  const scroller = useRef();
  useEffect(() => { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }, [state]);
  useEffect(() => { localStorage.setItem('llv-vm-route', JSON.stringify(route)); if (scroller.current) scroller.current.scrollTop = 0; }, [route]);
  const setRolle = (r) => { setRolleS(r); localStorage.setItem('llv-vm-rolle', r); };
  const go = useCallback((page, p = {}) => setRoute({ page, p }), []);
  const dismiss = (id) => setToasts(t => t.filter(x => x.id !== id));
  const toast = useCallback((t) => { const id = Math.random(); setToasts(x => [...x, { ...t, id }]); setTimeout(() => dismiss(id), 5500); }, []);
  const runAI = useCallback(async ({ title, sub, steps, minMs = 4500, preview, task, fallback }) => {
    const id = Math.random();
    setJob({ id, title, sub, steps, minMs, preview, done: false });
    let result, failed = false;
    const t = (async () => { try { return await task(); } catch (e) { console.warn('KI-Fallback:', e); failed = true; return fallback ? fallback() : null; } })();
    [result] = await Promise.all([t, sleep(minMs)]);
    setJob(j => j && { ...j, done: true });
    await sleep(650);
    setJob(null);
    if (failed) toast({ kind: 'info', icon: 'fas fa-circle-info', title: 'KI-Dienst nicht erreichbar', text: 'Es wird ein vorbereitetes Beispielergebnis angezeigt.' });
    return result;
  }, [toast]);
  const alerts = useMemo(() => computeAlerts(state.lieferanten, state.settings, state.quittungen), [state.lieferanten, state.settings, state.quittungen]);
  const reset = () => { const s = initialState(); setState(s); go('home'); toast({ title: 'Demodaten zurückgesetzt' }); };
  const ctx = { state, setState, rolle, setRolle, go, toast, runAI };
  if (!logged) return <SSOScreen onLogin={() => { localStorage.setItem('llv-vm-login', '1'); setLogged(true); }} />;
  const { page, p } = route;
  let view;
  if (page === 'home') view = rolle === 'Lieferantenmanager' ? <LMHome /> : rolle === 'Beschaffung' ? <BHome /> : <JHome />;
  else if (page === 'lieferanten') view = <LieferantenListe />;
  else if (page === 'lieferant') view = <LieferantDetail key={p.id} id={p.id} />;
  else if (page === 'vertraege') view = <VertraegeListe />;
  else if (page === 'erfassen') view = <Erfassen lieferantId={p.lieferantId} />;
  else if (page === 'einstellungen') view = <Einstellungen />;
  else if (page === 'entwuerfe') view = <Entwuerfe />;
  else if (page === 'entwurf-neu') view = <EntwurfNeu key={JSON.stringify(p)} typ={p.typ} lieferantId={p.lieferantId} />;
  else if (page === 'entwurf') view = <EntwurfEditor key={p.id} id={p.id} />;
  else if (page === 'bausteine') view = <StandardDocs mode="bausteine" />;
  else if (page === 'pruefungen') view = <Pruefungen />;
  else if (page === 'pruefung') view = <PruefungDetail key={p.id} id={p.id} auto={p.auto} />;
  else if (page === 'standards') view = <StandardDocs key={p.typ || 'x'} typ={p.typ} />;
  else view = <LMHome />;
  return <AppCtx.Provider value={ctx}>
    <div className="llv-app vm-app" data-screen-label={rolle + ' / ' + page}>
      <Header route={route} alertsCount={alerts.filter(a => a.schwere === 'rot').length} openAlerts={() => go('home')} />
      <main className="vm-main" ref={scroller}>{view}</main>
      <Footer reset={reset} />
    </div>
    {job && <AILoader job={job} />}
    <Toasts items={toasts} dismiss={dismiss} />
  </AppCtx.Provider>;
}
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
