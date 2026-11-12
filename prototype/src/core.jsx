const { useState, useEffect, useRef, useMemo, useContext, createContext, useCallback } = React;
const D = window.LLV_DATA;
const TODAY = new Date(2026, 10, 6);

// ---------- helpers ----------
function pd(s) { if (!s) return null; const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); }
function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function fd(s) { const d = typeof s === 'string' ? pd(s) : s; if (!d) return '–'; return String(d.getDate()).padStart(2, '0') + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + d.getFullYear(); }
function addM(d, m) { const r = new Date(d.getFullYear(), d.getMonth() + m + 1, 0); return new Date(r.getFullYear(), r.getMonth(), Math.min(d.getDate(), r.getDate())); }
function days(d) { return Math.round((d - TODAY) / 86400000); }
function chf(n) { if (!n) return '–'; return 'CHF ' + String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2019'); }
function relDays(t) { if (t === 0) return 'heute'; if (t < 0) return 'seit ' + (-t) + ' Tagen'; return 'in ' + t + ' Tagen'; }
const uid = (p) => p + '-' + Math.floor(Math.random() * 9000 + 1000);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function kuendTermin(v) { if (!v.ende || !v.kuendigungsfrist) return null; return addM(pd(v.ende), -v.kuendigungsfrist); }

function alertKey(a) { return [a.art, a.lieferant.id, a.vertrag ? a.vertrag.id : '', a.datum ? iso(a.datum) : a.text].join('|'); }
function qAktiv(q) { return q && (q.aktion !== 'zurueck' || days(pd(q.bis)) > 0); }
function computeAlerts(lieferanten, settings, quittungen, mode) {
  const all = computeAllAlerts(lieferanten, settings).map(a => { const key = alertKey(a); return { ...a, key, q: (quittungen || []).find(q => q.key === key) }; });
  return mode === 'erledigt' ? all.filter(a => qAktiv(a.q)) : all.filter(a => !qAktiv(a.q));
}
function computeAllAlerts(lieferanten, settings) {
  const out = [], L = settings.lead;
  lieferanten.forEach(l => {
    const hasAVV = l.vertraege.some(v => v.typ === 'AVV');
    l.vertraege.forEach(v => {
      const base = { lieferant: l, vertrag: v };
      const kt = kuendTermin(v);
      if (kt && settings.aktiv.kuendigung) {
        const t = days(kt), endT = days(pd(v.ende));
        if (t < 0 && endT >= 0 && v.autoVerl) out.push({ ...base, art: 'kuendigung', datum: kt, tage: t, schwere: 'rot', text: 'Kündigungsfrist verpasst – verlängert sich um ' + v.autoVerl + ' Monate' });
        else if (t >= 0 && t <= L.kuendigung) out.push({ ...base, art: 'kuendigung', datum: kt, tage: t, schwere: t <= 30 ? 'rot' : 'gelb', text: 'Kündigungsfrist läuft ab' });
      }
      if (v.review && settings.aktiv.review) { const t = days(pd(v.review)); if (t <= L.review) out.push({ ...base, art: 'review', datum: pd(v.review), tage: t, schwere: t < 0 ? 'rot' : 'gelb', text: t < 0 ? 'Review überfällig' : 'Review fällig' }); }
      if (v.ende && !v.autoVerl && settings.aktiv.ende) { const t = days(pd(v.ende)); if (t >= 0 && t <= L.ende) out.push({ ...base, art: 'ende', datum: pd(v.ende), tage: t, schwere: t <= 30 ? 'rot' : 'gelb', text: 'Vertrag läuft aus' }); }
      if (settings.aktiv.fehlend) {
        if (!v.ablage) out.push({ ...base, art: 'fehlend', tage: 999, schwere: 'grau', text: 'Kein Vertragsdokument in SharePoint abgelegt' });
        if (!v.review && v.typ !== 'NDA') out.push({ ...base, art: 'fehlend', tage: 999, schwere: 'grau', text: 'Review-Datum fehlt' });
      }
    });
    if (settings.aktiv.fehlend) {
      l.apps.forEach(a => {
        if ((a.level === 'L3' || a.level === 'L4') && !hasAVV) out.push({ lieferant: l, vertrag: null, art: 'fehlend', tage: 998, schwere: 'rot', text: 'AVV fehlt für ' + a.level + '-Anwendung «' + a.name + '»' });
        if (!a.betrieb) out.push({ lieferant: l, vertrag: null, art: 'fehlend', tage: 999, schwere: 'grau', text: 'Betriebsverantwortung fehlt für «' + a.name + '»' });
      });
      if (!Object.keys(l.kpi).length) out.push({ lieferant: l, vertrag: null, art: 'fehlend', tage: 999, schwere: 'grau', text: 'Leistungsbeurteilung (KPI) nicht erfasst' });
    }
  });
  return out.sort((a, b) => a.tage - b.tage);
}

async function askClaude(prompt, system, max = 3000) {
  if (!window.claude || !window.claude.complete) throw new Error('KI nicht verfügbar');
  const txt = await window.claude.complete({ system, max_tokens: max, messages: [{ role: 'user', content: prompt }] });
  return txt;
}
function parseJSON(txt) { const m = txt.match(/[\[{][\s\S]*[\]}]/); return JSON.parse(m ? m[0] : txt); }

// ---------- store ----------
const AppCtx = createContext(null);
const useApp = () => useContext(AppCtx);
const STORE_KEY = 'llv-vm-state-v1';
function initialState() {
  return {
    lieferanten: JSON.parse(JSON.stringify(D.LIEFERANTEN)),
    pruefungen: JSON.parse(JSON.stringify(D.PRUEFAUFTRAEGE)),
    entwuerfe: [],
    quittungen: [],
    settings: { lead: { kuendigung: 90, review: 30, ende: 60 }, aktiv: { kuendigung: true, review: true, ende: true, fehlend: true }, kanal: { mail: true, kalender: true }, empfaenger: 'Lieferantenmanager und Fachverantwortliche', zusammenfassung: 'Wöchentlich (Montag 07.30 Uhr)' }
  };
}

// ---------- UI atoms ----------
function Btn({ kind = 'primary', icon, children, ...p }) { return <button className={'llv-btn llv-btn--' + kind} {...p}>{icon && <i className={icon}></i>}{children}</button>; }
function Tag({ c = 'grey', children }) { return <span className={'llv-tag llv-tag--' + c}>{children}</span>; }
function Ampel({ v, label }) {
  const map = { gruen: ['var(--color-green-500)', 'Akzeptabel'], gelb: ['var(--color-yellow-500)', 'Verhandeln'], rot: ['var(--color-red-500)', 'Nicht akzeptabel'], grau: ['var(--color-gray-200)', 'Offen'] };
  const [c, t] = map[v] || map.grau;
  return <span className="vm-ampel"><span className="vm-ampel__dot" style={{ background: c }}></span>{label !== false && <span>{label || t}</span>}</span>;
}
function Field({ label, children, hint, full }) { return <label className={'vm-field' + (full ? ' vm-field--full' : '')}><span className="vm-field__label">{label}</span>{children}{hint && <span className="vm-field__hint">{hint}</span>}</label>; }
function Input(p) { return <input className="llv-input" {...p} />; }
function Select({ options, ...p }) { return <select className="llv-input vm-select" {...p}>{options.map(o => typeof o === 'string' ? <option key={o} value={o}>{o}</option> : <option key={o.v} value={o.v}>{o.l}</option>)}</select>; }
function Card({ title, actions, children, pad = true, className = '', open, onToggle }) {
  const coll = !!onToggle, shut = coll && !open;
  return <section className={'llv-card vm-card ' + className + (coll ? ' vm-coll' : '') + (shut ? ' is-shut' : '')} style={pad ? null : { padding: 0 }}>
    {(title || actions) && <div className="vm-card__head" style={pad ? (shut ? { marginBottom: 0 } : null) : { padding: shut ? '15px 20px' : '15px 20px 0', marginBottom: shut ? 0 : undefined }}><h2 onClick={onToggle} style={coll ? { cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 10 } : null}>{coll && <i className={'fas fa-chevron-' + (open ? 'down' : 'right')} style={{ fontSize: 14, width: 14 }}></i>}{title}</h2>{!shut && <div className="vm-row">{actions}</div>}</div>}
    {!shut && children}
  </section>;
}
function Dialog({ title, onClose, children, footer, width = 560 }) {
  return <div className="llv-dialog-backdrop" onMouseDown={e => e.target === e.currentTarget && onClose()}>
    <div className="llv-dialog" style={{ width }}>
      <div className="llv-dialog__header"><h2>{title}</h2><button className="llv-btn llv-btn--icon" onClick={onClose}><i className="fas fa-xmark"></i></button></div>
      <div className="llv-dialog__body">{children}</div>
      {footer && <div className="llv-dialog__footer">{footer}</div>}
    </div>
  </div>;
}
function PageHead({ crumbs, title, sub, actions, inline, right }) {
  const { go } = useApp();
  return <div className="llv-context">
    {crumbs && <div className="llv-context__crumbs">{crumbs.map((c, i) => <span key={i}>{i > 0 && <i className="fas fa-chevron-right vm-crumb-sep"></i>}{c.to ? <a onClick={() => go(c.to, c.p)}>{c.l}</a> : c.l}</span>)}</div>}
    <div className="vm-pagehead"><div><h1>{title}</h1>{sub && <div className="vm-sub">{sub}</div>}{inline && actions && <div className="vm-row" style={{ marginTop: 12 }}>{actions}</div>}</div>{!inline && actions && <div className="vm-row">{actions}</div>}{right && <div className="vm-row">{right}</div>}</div>
  </div>;
}
function Toasts({ items, dismiss }) {
  return <div className="vm-toasts">{items.map(t => <div key={t.id} className={'llv-notif llv-notif--' + (t.kind || 'success') + ' vm-toast'}>
    <div className="llv-notif__icon"><i className={t.icon || 'fas fa-check'}></i></div>
    <div className="llv-notif__body"><div><b>{t.title}</b>{t.text && <div>{t.text}</div>}</div></div>
    <i className="fas fa-xmark llv-notif__dismiss" onClick={() => dismiss(t.id)}></i>
  </div>)}</div>;
}
function SPPath({ path }) { return <span className="vm-sp"><i className="fas fa-folder-open"></i>SharePoint › Lieferantenmanagement › {path.split('/').slice(0, -1).join(' › ')} › <b>{path.split('/').pop()}</b></span>; }

// ---------- AI loader ----------
function AILoader({ job }) {
  const [step, setStep] = useState(0);
  const [lines, setLines] = useState([]);
  useEffect(() => {
    setStep(0); setLines([]);
    const per = job.minMs / job.steps.length;
    const timers = job.steps.map((_, i) => setTimeout(() => setStep(s => Math.max(s, i)), i * per));
    const words = (job.preview || '').split(/(?<=[.;:])\s+/).filter(Boolean);
    let wi = 0; const iv = setInterval(() => { if (!words.length) return; setLines(l => [...l.slice(-3), words[wi % words.length]]); wi++; }, 650);
    return () => { timers.forEach(clearTimeout); clearInterval(iv); };
  }, [job.id]);
  const done = job.done;
  const pct = done ? 100 : Math.min(92, Math.round(((step + 0.6) / job.steps.length) * 100));
  return <div className="llv-dialog-backdrop vm-ai-backdrop">
    <div className="vm-ai">
      <div className="vm-ai__orb"><span></span><span></span><i className="fas fa-wand-magic-sparkles"></i></div>
      <h2>{job.title}</h2>
      <div className="vm-ai__sub">{job.sub || 'Die KI erledigt das für Sie – einen Moment bitte.'}</div>
      <div className="vm-ai__bar"><div style={{ width: pct + '%' }}></div></div>
      <ol className="vm-ai__steps">{job.steps.map((s, i) => {
        const st = done || i < step ? 'done' : i === step ? 'run' : 'wait';
        return <li key={i} className={'is-' + st}>{st === 'done' ? <i className="fas fa-circle-check"></i> : st === 'run' ? <span className="vm-mini-spin"></span> : <i className="far fa-circle"></i>}<span>{s}</span></li>;
      })}</ol>
      {job.preview && <div className="vm-ai__stream">{lines.map((l, i) => <div key={i + l} className="vm-ai__line">{l}</div>)}</div>}
      <div className="vm-ai__foot"><i className="fas fa-shield-halved"></i>Verarbeitung in Azure OpenAI · Rechenzentrum Schweiz Nord · keine Speicherung beim Modellanbieter</div>
    </div>
  </div>;
}

// ---------- Header / Footer / SSO ----------
const ROLLEN = {
  Lieferantenmanager: { icon: 'fas fa-building', nav: [['home', 'Übersicht'], ['lieferanten', 'Lieferanten'], ['vertraege', 'Verträge'], ['einstellungen', 'Erinnerungen']] },
  Beschaffung: { icon: 'fas fa-file-pen', nav: [['home', 'Übersicht'], ['entwuerfe', 'Entwürfe'], ['lieferanten', 'Lieferanten'], ['bausteine', 'Textbausteine']] },
  Jurist: { icon: 'fas fa-scale-balanced', nav: [['home', 'Übersicht'], ['pruefungen', 'Prüfungen'], ['vertraege', 'Verträge'], ['standards', 'Prüfstandards']] }
};
const ROLLE_LABEL = { Lieferantenmanager: 'Lieferantenmanagement', Beschaffung: 'Beschaffung', Jurist: 'Rechtsdienst' };
function Header({ route, alertsCount, openAlerts }) {
  const { rolle, setRolle, go } = useApp();
  const [menu, setMenu] = useState(false);
  const cur = ROLLEN[rolle];
  const activeKey = { lieferant: 'lieferanten', erfassen: 'vertraege', entwurf: 'entwuerfe', 'entwurf-neu': 'entwuerfe', pruefung: 'pruefungen' }[route.page] || route.page;
  return <header className="llv-header llv-header--compact vm-header">
    <div className="llv-header__brand"><img src={(window.__resources && window.__resources.llvLogo) || 'assets/llv-logo.png'} alt="LLV" /><span className="vm-header__div"></span><span className="llv-header__app">Vertragsmanagement</span></div>
    <nav className="llv-header__nav">{cur.nav.map(([k, l]) => <a key={k} className={activeKey === k ? 'is-active' : ''} onClick={() => go(k)}>{l}</a>)}</nav>
    <div className="llv-header__right">
      {rolle === 'Lieferantenmanager' && <button className="llv-iconbtn vm-bell" title="Erinnerungen" onClick={openAlerts}><i className="fas fa-bell"></i>{alertsCount > 0 && <span>{alertsCount}</span>}</button>}
      <div className="vm-rolemenu">
        <button className="vm-rolebtn" onClick={() => setMenu(!menu)}><i className={cur.icon}></i>{ROLLE_LABEL[rolle]}<i className="fas fa-chevron-down vm-rolebtn__chev"></i></button>
        {menu && <div className="vm-rolemenu__pop" onMouseLeave={() => setMenu(false)}>
          <div className="vm-rolemenu__cap">Ihre Rollen (Entra ID)</div>
          {Object.keys(ROLLEN).map(r => <a key={r} className={r === rolle ? 'is-active' : ''} onClick={() => { setRolle(r); setMenu(false); go('home'); }}><i className={ROLLEN[r].icon}></i><span>{ROLLE_LABEL[r]}</span>{r === rolle && <i className="fas fa-check vm-rolemenu__chk"></i>}</a>)}
          <div className="vm-rolemenu__note">In der Produktion sehen Benutzer nur ihre zugewiesenen Rollen.</div>
        </div>}
      </div>
      <span className="llv-avatar" title="Daniel Meier">DM</span>
    </div>
  </header>;
}
function Footer({ reset }) {
  return <footer className="llv-footer vm-footer"><span>© 2026 Liechtensteinische Landesverwaltung – Vertragsmanagement – Version 0.9.0 (Prototyp)</span><span className="vm-row"><span><i className="fab fa-microsoft"></i> Angemeldet über Entra ID</span><a onClick={reset}>Demodaten zurücksetzen</a></span></footer>;
}
function SSOScreen({ onLogin }) {
  const [busy, setBusy] = useState(false);
  return <div className="vm-sso">
    <div className="llv-login__card vm-sso__card">
      <img className="llv-login__logo" src={(window.__resources && window.__resources.llvLogo) || 'assets/llv-logo.png'} alt="LLV" />
      <h1 style={{ fontSize: 22, marginBottom: 5 }}>Vertragsmanagement</h1>
      <p className="vm-muted" style={{ marginBottom: 25 }}>Lieferanten, Vertragsentwürfe und rechtliche Prüfung an einem Ort.</p>
      {busy ? <div className="vm-sso__busy"><span className="llv-spinner"></span><span>Anmeldung bei Microsoft Entra ID …</span></div> :
        <Btn icon="fab fa-microsoft" style={{ width: '100%' }} onClick={() => { setBusy(true); setTimeout(onLogin, 1400); }}>Mit LLV-Konto anmelden</Btn>}
      <div className="vm-sso__hint">Single Sign-on über Microsoft Entra ID. Ihre Rollen werden aus den Gruppen <b>SG-VM-Lieferantenmanagement</b>, <b>SG-VM-Beschaffung</b> und <b>SG-VM-Rechtsdienst</b> übernommen.</div>
    </div>
  </div>;
}

Object.assign(window, { pd, iso, fd, addM, days, chf, relDays, uid, sleep, kuendTermin, computeAlerts, alertKey, askClaude, parseJSON, AppCtx, useApp, STORE_KEY, initialState, Btn, Tag, Ampel, Field, Input, Select, Card, Dialog, PageHead, Toasts, SPPath, AILoader, Header, Footer, SSOScreen, ROLLEN, ROLLE_LABEL, TODAY });
