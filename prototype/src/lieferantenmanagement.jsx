// ---------- Modul 1: Lieferantenmanagement ----------
const ART_LABEL = { kuendigung: 'Kündigungsfrist', review: 'Review', ende: 'Vertragsende', fehlend: 'Fehlende Daten' };

function useAlerts(mode) { const { state } = useApp(); return useMemo(() => computeAlerts(state.lieferanten, state.settings, state.quittungen, mode), [state.lieferanten, state.settings, state.quittungen, mode]); }

const ERL_OPT = {
  kuendigung: [['gekuendigt', 'Vertrag fristgerecht gekündigt', 'Status wird auf «Gekündigt» gesetzt.'], ['verlaengern', 'Verlängerung bewusst akzeptiert', 'Vertrag läuft weiter, nächste Frist wird wieder überwacht.']],
  review: [['review', 'Review durchgeführt', 'Nächstes Review-Datum festlegen – die Erinnerung verschwindet dadurch automatisch.']],
  ende: [['nachfolge', 'Nachfolge geregelt', 'Neuer Vertrag oder Verlängerung ist in Arbeit bzw. erfasst.'], ['auslaufen', 'Vertrag läuft bewusst aus', 'Keine Nachfolge nötig.']],
  fehlend: [['ergaenzen', 'Daten jetzt ergänzen', 'Öffnet den Lieferanten – sobald die Daten erfasst sind, verschwindet der Hinweis.'], ['nz', 'Nicht zutreffend', 'Begründung erforderlich, wird protokolliert.']]
};
const AKTION_LABEL = { gekuendigt: 'Gekündigt', verlaengern: 'Verlängerung akzeptiert', nachfolge: 'Nachfolge geregelt', auslaufen: 'Läuft bewusst aus', nz: 'Nicht zutreffend', zurueck: 'Zurückgestellt' };

function ErledigenDialog({ a, onClose }) {
  const { setState, go, toast } = useApp();
  const opts = ERL_OPT[a.art];
  const [akt, setAkt] = useState(opts[0][0]);
  const [bis, setBis] = useState(14);
  const [rev, setRev] = useState(iso(addM(TODAY, 12)));
  const [kom, setKom] = useState('');
  const needKom = akt === 'nz';
  const ok = !(needKom && !kom.trim());
  const save = () => {
    if (akt === 'ergaenzen') { onClose(); go('lieferant', { id: a.lieferant.id }); return; }
    const q = { key: a.key, aktion: akt, kommentar: kom.trim(), von: 'Daniel Meier', am: iso(TODAY), bis: akt === 'zurueck' ? iso(new Date(TODAY.getTime() + bis * 864e5)) : null };
    setState(s => {
      let lieferanten = s.lieferanten;
      const patch = p => lieferanten.map(l => l.id !== a.lieferant.id ? l : { ...l, vertraege: l.vertraege.map(v => v.id === a.vertrag.id ? { ...v, ...p } : v) });
      if (akt === 'gekuendigt') lieferanten = patch({ status: 'Gekündigt' });
      if (akt === 'review') return { ...s, lieferanten: patch({ review: rev }) };
      return { ...s, lieferanten, quittungen: [...(s.quittungen || []).filter(x => x.key !== a.key), q] };
    });
    toast({ title: akt === 'zurueck' ? 'Erinnerung zurückgestellt' : 'Erledigt', text: akt === 'zurueck' ? 'Erscheint wieder am ' + fd(pd(q.bis)) + '.' : akt === 'review' ? 'Nächstes Review: ' + fd(pd(rev)) : 'Unter «Erledigt» protokolliert.' });
    onClose();
  };
  return <Dialog title="Erinnerung bearbeiten" onClose={onClose} footer={<><Btn kind="secondary" onClick={onClose}>Abbrechen</Btn><Btn icon="fas fa-check" disabled={!ok} onClick={save}>{akt === 'ergaenzen' ? 'Zum Lieferanten' : 'Speichern'}</Btn></>}>
    <div className="vm-stack" style={{ gap: 14 }}>
      <div className="vm-row" style={{ gap: 8 }}><Tag c={a.schwere === 'rot' ? 'red' : a.schwere === 'gelb' ? 'yellow' : 'grey'}>{ART_LABEL[a.art]}</Tag><span><b>{a.lieferant.name}</b>{a.vertrag && ' · ' + a.vertrag.titel}</span></div>
      <div>{a.text}{a.datum && <span className="vm-muted"> · {fd(a.datum)}</span>}</div>
      <div className="vm-stack" style={{ gap: 8 }}>
        {[...opts, ['zurueck', 'Später erinnern', 'Erinnerung vorübergehend ausblenden.']].map(([k, l, s]) => <label key={k} className="llv-check" style={{ alignItems: 'flex-start' }}><input type="radio" name="erl" checked={akt === k} onChange={() => setAkt(k)} /><span><b>{l}</b><div className="vm-small vm-muted">{s}</div></span></label>)}
      </div>
      {akt === 'zurueck' && <Field label="Zurückstellen um"><Select value={bis} onChange={e => setBis(+e.target.value)} options={[{ v: 7, l: '7 Tage' }, { v: 14, l: '14 Tage' }, { v: 30, l: '30 Tage' }]} /></Field>}
      {akt === 'review' && <Field label="Nächstes Review-Datum"><Input type="date" value={rev} onChange={e => setRev(e.target.value)} /></Field>}
      {akt !== 'ergaenzen' && akt !== 'review' && <Field label={needKom ? 'Begründung *' : 'Kommentar (optional)'}><textarea className="llv-input" rows={3} value={kom} onChange={e => setKom(e.target.value)} placeholder={needKom ? 'Warum trifft der Hinweis nicht zu?' : 'z. B. Kündigung per Einschreiben am …'}></textarea></Field>}
    </div>
  </Dialog>;
}

function NeuTag({ l, b }) { const n = (l.protokoll || []).filter(p => (!b || p.bereich === b) && days(pd(p.am)) > -14).length; return n ? <span style={{ marginLeft: 10, fontWeight: 400 }}><Tag c="yellow"><i className="fas fa-file-import"></i> {n} neu aus Vertragsimport</Tag></span> : null; }
function AlertBanner({ alerts }) {
  const [dlg, setDlg] = useState(null);
  if (!alerts.length) return null;
  return <div className={'llv-notif llv-notif--' + (alerts.some(a => a.schwere === 'rot') ? 'error' : 'warn')}><div className="llv-notif__icon"><i className="fas fa-bell"></i></div><div className="llv-notif__body" style={{ flex: 1 }}><div className="vm-stack" style={{ gap: 6, width: '100%' }}>{alerts.map((a, i) => <div key={i} className="vm-row" style={{ justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap', alignItems: 'flex-start' }}><span style={{ flex: 1, minWidth: 0 }}><b>{ART_LABEL[a.art]}:</b> {a.text}{a.vertrag ? ' – ' + a.vertrag.titel : ''}{a.datum ? ' (' + fd(a.datum) + ')' : ''}</span><a className="vm-small vm-nowrap" onClick={() => setDlg(a)}><i className="fas fa-check"></i> Erledigen</a></div>)}</div></div>{dlg && <ErledigenDialog a={dlg} onClose={() => setDlg(null)} />}</div>;
}
function AlertTable({ alerts, compact, erledigt }) {
  const { go, toast, setState } = useApp();
  const [dlg, setDlg] = useState(null);
  const [sort, setSort] = useState({ k: '', d: 1 });
  const SEV = { rot: 0, gelb: 1, grau: 2, gruen: 3 };
  const val = { ampel: a => SEV[a.schwere], datum: a => a.datum ? a.datum.getTime() : 9e15, lieferant: a => a.lieferant.name, vertrag: a => a.vertrag ? a.vertrag.titel : '', hinweis: a => (a.art ? ART_LABEL[a.art] : '~') + a.text };
  const rows = sort.k ? [...alerts].sort((x, y) => { const p = val[sort.k](x), q = val[sort.k](y); return (typeof p === 'string' ? p.localeCompare(q, 'de') : p - q) * sort.d; }) : alerts;
  const H = ({ k, children, style }) => <th style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap', ...style }} onClick={() => setSort(s => s.k === k ? (s.d === 1 ? { k, d: -1 } : { k: '', d: 1 }) : { k, d: 1 })}>{children}<i className={'fas fa-sort' + (sort.k === k ? (sort.d === 1 ? '-up' : '-down') : '')} style={{ marginLeft: 6, opacity: sort.k === k ? 1 : .35, fontSize: 11 }}></i></th>;
  const reopen = a => { setState(s => ({ ...s, quittungen: s.quittungen.filter(q => q.key !== a.key) })); toast({ title: 'Wieder geöffnet', text: a.text }); };
  if (!alerts.length) return <div className="vm-empty"><i className="fas fa-circle-check"></i>Kein Handlungsbedarf in diesem Filter.</div>;
  return <table className="llv-table vm-table"><thead><tr><H k="ampel" style={{ width: 30 }}></H><H k="datum">Fällig</H><H k="lieferant">Lieferant</H><H k="vertrag">Vertrag</H><H k="hinweis">Hinweis</H><th></th></tr></thead><tbody>
    {rows.map((a, i) => <tr key={i} className="vm-click" onClick={() => go('lieferant', { id: a.lieferant.id })}>
      <td><Ampel v={a.schwere} label={false} /></td>
      <td className="vm-nowrap">{a.datum ? <><b>{fd(a.datum)}</b><div className="vm-muted vm-small">{relDays(a.tage)}</div></> : <span className="vm-muted">–</span>}</td>
      <td><div className="vm-strong">{a.lieferant.name}</div><div className="vm-small vm-muted">Klasse {a.lieferant.klasse}</div></td>
      <td>{a.vertrag ? <><div>{a.vertrag.titel}</div><div className="vm-small vm-muted">{a.vertrag.typ}</div></> : <span className="vm-muted">–</span>}</td>
      <td><div className="vm-row" style={{ gap: 8 }}>{a.art ? <Tag c={a.schwere === 'rot' ? 'red' : a.schwere === 'gelb' ? 'yellow' : 'grey'}>{ART_LABEL[a.art]}</Tag> : null}<span className={a.art ? '' : 'vm-muted'}>{a.text}</span></div></td>
      <td className="vm-nowrap" onClick={e => e.stopPropagation()}>{erledigt ? <div className="vm-row" style={{ gap: 8, justifyContent: 'flex-end' }}><span className="vm-small vm-muted" title={a.q.kommentar}>{AKTION_LABEL[a.q.aktion]}{a.q.bis ? ' bis ' + fd(pd(a.q.bis)) : ''} · {a.q.von}, {fd(pd(a.q.am))}</span><Btn kind="secondary" icon="fas fa-rotate-left" onClick={() => reopen(a)}>Öffnen</Btn></div> : <div className="vm-row" style={{ gap: 4, justifyContent: 'flex-end' }}>{a.datum && !compact && <button className="llv-btn llv-btn--icon" title="Termin in Outlook eintragen" onClick={() => toast({ title: 'Termin erstellt', text: 'Outlook-Kalender: «' + ART_LABEL[a.art] + ' ' + a.lieferant.name + '» am ' + fd(a.datum), icon: 'fas fa-calendar-plus' })}><i className="far fa-calendar-plus"></i></button>}{a.art && <Btn kind="secondary" icon="fas fa-check" onClick={() => setDlg(a)}>Erledigen</Btn>}</div>}</td>
    </tr>)}
  </tbody>{dlg && <ErledigenDialog a={dlg} onClose={() => setDlg(null)} />}</table>;
}

function LMHome() {
  const { state, go, setState, toast } = useApp();
  const alerts = useAlerts();
  const erledigt = useAlerts('erledigt');
  const [f, setF] = useState('alle');
  const [nur, setNur] = useState(true);
  const ohne = state.lieferanten.flatMap(l => l.vertraege.filter(v => !alerts.some(a => a.vertrag && a.vertrag.id === v.id)).map(v => { const kt = kuendTermin(v); const d = kt && days(kt) >= 0 ? kt : v.ende ? pd(v.ende) : null; return { lieferant: l, vertrag: v, art: null, schwere: 'gruen', datum: d, tage: d ? days(d) : 9999, text: 'Kein Handlungsbedarf' + (d ? (kt && days(kt) >= 0 ? ' · nächster Kündigungstermin' : ' · Vertragsende') : '') }; }));
  const shown = f === 'erledigt' ? erledigt : [...alerts.filter(a => f === 'alle' || a.art === f), ...(!nur && f === 'alle' ? ohne : [])];
  const vs = state.lieferanten.flatMap(l => l.vertraege);
  const freigegeben = state.pruefungen.filter(p => p.status === 'Freigegeben' && !p.uebernommen);
  const counts = { alle: alerts.length, erledigt: erledigt.length }; alerts.forEach(a => counts[a.art] = (counts[a.art] || 0) + 1);
  return <>
    <PageHead title="Guten Tag, Daniel Meier" sub={'Lieferantenmanagement · ' + fd(TODAY)} actions={<Btn icon="fas fa-file-arrow-up" onClick={() => go('erfassen')}>Vertrag erfassen</Btn>} />
    <div className="llv-content vm-stack">
      <div className="vm-stats">
        <div className="vm-stat"><span>Aktive Verträge</span><b>{vs.length}</b><small>{state.lieferanten.length} Lieferanten</small></div>
        <div className="vm-stat"><span>Dringend</span><b style={{ color: 'var(--color-red-500)' }}>{alerts.filter(a => a.schwere === 'rot').length}</b><small>Fristen ≤ 30 Tage, verpasst oder AVV fehlt</small></div>
        <div className="vm-stat"><span>Kündigungstermine nächste {state.settings.lead.kuendigung} Tage</span><b>{alerts.filter(a => a.art === 'kuendigung' && a.tage >= 0).length}</b><small>Vorlauf in Erinnerungen anpassbar</small></div>
        <div className="vm-stat"><span>Vertragsvolumen p. a.</span><b>{chf(vs.reduce((s, v) => s + (v.wert || 0), 0))}</b><small>Summe aller aktiven Verträge</small></div>
      </div>
      {freigegeben.length > 0 && <Card title="Vom Rechtsdienst freigegeben – bereit zur Übernahme">
        <table className="llv-table"><tbody>{freigegeben.map(p => <tr key={p.id}><td><Ampel v="gruen" label={false} /></td><td><b>{p.titel}</b><div className="vm-small vm-muted">{p.lieferant} · {p.typ}</div></td><td className="vm-small vm-muted">Freigegeben {fd(p.entscheidDatum)} · Standard v{p.standardVersion}</td><td style={{ textAlign: 'right' }}><Btn kind="secondary" icon="fas fa-arrow-right-to-bracket" onClick={() => {
          setState(s => ({ ...s, pruefungen: s.pruefungen.map(x => x.id === p.id ? { ...x, uebernommen: true } : x), entwuerfe: s.entwuerfe.map(e => e.id === p.entwurfId ? { ...e, status: 'Aktiv' } : e), lieferanten: s.lieferanten.map(l => l.id !== p.lieferantId ? l : { ...l, vertraege: [...l.vertraege, { id: uid('V'), typ: p.typ, titel: p.titel, beginn: p.felder?.beginn || iso(TODAY), ende: p.felder?.ende || '', kuendigungsfrist: +(p.felder?.kuendigungsfrist || 3), autoVerl: 12, review: iso(addM(TODAY, 12)), wert: +(p.felder?.betrag || 0), gerichtsstand: 'Vaduz', recht: 'FL', status: 'Aktiv', ablage: 'Verträge/' + p.lieferant.split(' ')[0] + '/' + p.titel.replace(/\W+/g, '_') + '.pdf', anmerkung: 'Aus Prüfung ' + p.id }] }) }));
          toast({ title: 'Vertrag übernommen', text: p.titel + ' ist nun in der Vertragsübersicht. Outlook-Termine wurden erstellt.' });
        }}>Übernehmen</Btn></td></tr>)}</tbody></table>
      </Card>}
      <Card title={nur ? 'Handlungsbedarf' : 'Alle Verträge und Hinweise'} actions={<a className="vm-small" onClick={() => go('einstellungen')}><i className="fas fa-sliders"></i> Vorlaufzeiten</a>} pad={false}>
        <div className="vm-chips" style={{ padding: '10px 20px' }}>{['alle', 'kuendigung', 'review', 'ende', 'fehlend', 'erledigt'].map(k => <button key={k} className={'vm-chip' + (f === k ? ' is-on' : '')} onClick={() => setF(k)}>{k === 'alle' ? 'Offen' : k === 'erledigt' ? 'Erledigt / zurückgestellt' : ART_LABEL[k]}<span>{counts[k] || 0}</span></button>)}<label className="llv-check" style={{ marginLeft: 'auto' }}><input type="checkbox" checked={nur} onChange={e => { setNur(e.target.checked); if (!e.target.checked) setF('alle'); }} />Nur mit Handlungsbedarf</label></div>
        <AlertTable alerts={shown} erledigt={f === 'erledigt'} />
      </Card>
    </div>
  </>;
}

function rating(l) { const v = Object.values(l.kpi).concat(Object.values(l.risiko)).map(x => x.wert); if (!v.length) return null; return { m: v.filter(x => x === 'Mangelhaft').length, t: v.filter(x => x === 'Top').length }; }

function LieferantenListe() {
  const { state, go, rolle } = useApp();
  const alerts = useAlerts();
  const [q, setQ] = useState(''); const [kl, setKl] = useState(''); const [land, setLand] = useState(''); const [nur, setNur] = useState(false);
  const rows = state.lieferanten.filter(l => (!q || (l.name + l.ort).toLowerCase().includes(q.toLowerCase())) && (!kl || l.klasse === kl) && (!land || l.land === land) && (!nur || alerts.some(a => a.lieferant.id === l.id)));
  return <>
    <PageHead title="Lieferanten" sub={rows.length + ' von ' + state.lieferanten.length + ' Lieferanten'} actions={rolle === 'Lieferantenmanager' && <Btn icon="fas fa-file-arrow-up" onClick={() => go('erfassen')}>Vertrag erfassen</Btn>} />
    <div className="llv-content vm-stack">
      <div className="vm-filters">
        <div className="llv-input-icon" style={{ width: 260 }}><Input placeholder="Lieferant oder Ort suchen" value={q} onChange={e => setQ(e.target.value)} /><i className="fas fa-search"></i></div>
        <Select value={kl} onChange={e => setKl(e.target.value)} options={[{ v: '', l: 'Alle Klassen' }, { v: 'A', l: 'A – strategisch' }, { v: 'B', l: 'B – Standard' }, { v: 'C', l: 'C – unkritisch' }]} />
        <Select value={land} onChange={e => setLand(e.target.value)} options={[{ v: '', l: 'Alle Länder' }, 'FL', 'CH', 'AT', 'DE']} />
        <label className="llv-check"><input type="checkbox" checked={nur} onChange={e => setNur(e.target.checked)} />Nur mit Handlungsbedarf</label>
      </div>
      <Card pad={false}><table className="llv-table vm-table"><thead><tr><th>Lieferant</th><th>Klasse</th><th>Anwendungen</th><th>Verträge</th><th className="num">Volumen p. a.</th><th>Nächster Kündigungstermin</th><th>Beurteilung</th><th>Hinweise</th></tr></thead><tbody>
        {rows.map(l => {
          const kts = l.vertraege.map(kuendTermin).filter(d => d && days(d) >= 0).sort((a, b) => a - b);
          const r = rating(l); const n = alerts.filter(a => a.lieferant.id === l.id);
          return <tr key={l.id} className="vm-click" onClick={() => go('lieferant', { id: l.id })}>
            <td><div className="vm-strong">{l.name}</div><div className="vm-small vm-muted">{l.ort} ({l.land})</div></td>
            <td><Tag c={l.klasse === 'A' ? 'blue' : 'grey'}>{l.klasse}</Tag></td>
            <td className="vm-small">{l.apps.map(a => a.name + ' (' + a.level + ')').join(', ') || <span className="vm-muted">–</span>}</td>
            <td>{l.vertraege.length}</td>
            <td className="num">{chf(l.vertraege.reduce((s, v) => s + (v.wert || 0), 0))}</td>
            <td>{kts[0] ? <>{fd(kts[0])} <span className="vm-small vm-muted">({relDays(days(kts[0]))})</span></> : <span className="vm-muted">–</span>}</td>
            <td>{r ? <span className="vm-small">{r.m > 0 ? <b style={{ color: 'var(--color-red-500)' }}>{r.m} mangelhaft</b> : <span style={{ color: 'var(--color-green-500)' }}>ohne Mängel</span>}</span> : <span className="vm-small vm-muted">nicht erfasst</span>}</td>
            <td>{n.length ? <div className="vm-row" style={{ gap: 5 }}><Ampel v={n.some(a => a.schwere === 'rot') ? 'rot' : n.some(a => a.schwere === 'gelb') ? 'gelb' : 'grau'} label={false} /><span>{n.length}</span></div> : <span className="vm-muted">–</span>}</td>
          </tr>;
        })}
      </tbody></table></Card>
    </div>
  </>;
}

function VertraegeListe() {
  const { state, go, rolle } = useApp();
  const [q, setQ] = useState(''); const [typ, setTyp] = useState(''); const [frist, setFrist] = useState('');
  const all = state.lieferanten.flatMap(l => l.vertraege.map(v => ({ ...v, l })));
  const rows = all.filter(v => (!q || (v.titel + v.l.name).toLowerCase().includes(q.toLowerCase())) && (!typ || v.typ === typ) && (!frist || (kuendTermin(v) && days(kuendTermin(v)) >= 0 && days(kuendTermin(v)) <= +frist)))
    .sort((a, b) => (kuendTermin(a) || 9e15) - (kuendTermin(b) || 9e15));
  return <>
    <PageHead title="Verträge" sub={rows.length + ' Verträge'} actions={rolle === 'Lieferantenmanager' && <Btn icon="fas fa-file-arrow-up" onClick={() => go('erfassen')}>Vertrag erfassen</Btn>} />
    <div className="llv-content vm-stack">
      <div className="vm-filters">
        <div className="llv-input-icon" style={{ width: 260 }}><Input placeholder="Vertrag oder Lieferant suchen" value={q} onChange={e => setQ(e.target.value)} /><i className="fas fa-search"></i></div>
        <Select value={typ} onChange={e => setTyp(e.target.value)} options={[{ v: '', l: 'Alle Vertragsarten' }, ...D.VERTRAGSARTEN]} />
        <Select value={frist} onChange={e => setFrist(e.target.value)} options={[{ v: '', l: 'Kündigungstermin: alle' }, { v: '90', l: 'innert 90 Tagen' }, { v: '180', l: 'innert 180 Tagen' }, { v: '365', l: 'innert 12 Monaten' }]} />
      </div>
      <Card pad={false}><table className="llv-table vm-table"><thead><tr><th>Vertrag</th><th>Art</th><th>Laufzeit</th><th>Kündigungstermin</th><th>Review</th><th className="num">Wert p. a.</th><th>Recht</th><th>Ablage</th></tr></thead><tbody>
        {rows.map(v => { const kt = kuendTermin(v); const t = kt && days(kt); return <tr key={v.id} className="vm-click" onClick={() => go('lieferant', { id: v.l.id })}>
          <td><div className="vm-strong">{v.titel}</div><div className="vm-small vm-muted">{v.l.name}</div></td>
          <td className="vm-small">{v.typ}</td>
          <td className="vm-small vm-nowrap">{fd(v.beginn)} – {v.ende ? fd(v.ende) : 'unbefristet'}{v.autoVerl ? <div className="vm-muted">+{v.autoVerl} Mt. autom.</div> : null}</td>
          <td className="vm-nowrap">{kt ? <><span style={{ color: t < 0 ? 'var(--color-gray-200)' : t <= 90 ? 'var(--color-red-500)' : null, fontWeight: t >= 0 && t <= 90 ? 700 : 400 }}>{fd(kt)}</span><div className="vm-small vm-muted">{v.kuendigungsfrist} Mt. Frist</div></> : <span className="vm-muted">–</span>}</td>
          <td className="vm-nowrap">{v.review ? fd(v.review) : <span className="vm-muted">fehlt</span>}</td>
          <td className="num">{chf(v.wert)}</td>
          <td>{v.recht} / {v.gerichtsstand}</td>
          <td>{v.ablage ? <a onClick={e => e.stopPropagation()} title={v.ablage}><i className="fas fa-file-pdf"></i> PDF</a> : <span className="vm-muted">fehlt</span>}</td>
        </tr>; })}
      </tbody></table></Card>
    </div>
  </>;
}

function BewertungsBlock({ gruppen, data, onChange, readOnly }) {
  const col = (w) => w === 'Top' ? 'green' : w === 'Mangelhaft' ? 'red' : w === 'OK' ? 'blue' : 'grey';
  return <table className="llv-table vm-kpi"><thead><tr><th>Kriterium</th><th style={{ width: 170 }}>Beurteilung</th><th>Begründung</th></tr></thead><tbody>
    {gruppen.map(g => <React.Fragment key={g.gruppe || 'x'}>
      {g.gruppe && <tr className="vm-kpi__grp"><td colSpan="3">{g.gruppe}</td></tr>}
      {g.items.map(([key, label, typ]) => { const v = data[key] || { wert: '', begr: '' }; return <tr key={key}>
        <td>{label}</td>
        <td>{readOnly ? (v.wert ? <Tag c={col(v.wert)}>{v.wert}</Tag> : <span className="vm-muted">–</span>) : <Select value={v.wert} onChange={e => onChange(key, { ...v, wert: e.target.value })} options={[{ v: '', l: 'Bitte wählen …' }, ...(typ === 'kadenz' ? D.KADENZ : D.BEWERTUNG)]} />}</td>
        <td>{readOnly ? v.begr : <Input value={v.begr} placeholder="Begründung" onChange={e => onChange(key, { ...v, wert: v.wert, begr: e.target.value })} />}</td>
      </tr>; })}
    </React.Fragment>)}
  </tbody></table>;
}

function VertragDialog({ v, onSave, onClose }) {
  const [f, setF] = useState(v);
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return <Dialog title={v.id ? 'Vertrag bearbeiten' : 'Vertrag hinzufügen'} onClose={onClose} width={680} footer={<><Btn kind="secondary" onClick={onClose}>Abbrechen</Btn><Btn onClick={() => onSave({ ...f, kuendigungsfrist: +f.kuendigungsfrist, autoVerl: +f.autoVerl, wert: +f.wert })}>Speichern</Btn></>}>
    <div className="vm-grid2">
      <Field label="Vertragsart"><Select value={f.typ} onChange={s('typ')} options={D.VERTRAGSARTEN} /></Field>
      <Field label="Bezeichnung"><Input value={f.titel} onChange={s('titel')} /></Field>
      <Field label="Beginn"><Input type="date" value={f.beginn} onChange={s('beginn')} /></Field>
      <Field label="Ende (leer = unbefristet)"><Input type="date" value={f.ende} onChange={s('ende')} /></Field>
      <Field label="Kündigungsfrist (Monate)"><Input type="number" value={f.kuendigungsfrist} onChange={s('kuendigungsfrist')} /></Field>
      <Field label="Automatische Verlängerung (Monate)"><Input type="number" value={f.autoVerl} onChange={s('autoVerl')} /></Field>
      <Field label="Review-Datum"><Input type="date" value={f.review} onChange={s('review')} /></Field>
      <Field label="Wert p. a. (CHF)"><Input type="number" value={f.wert} onChange={s('wert')} /></Field>
      <Field label="Anwendbares Recht"><Select value={f.recht} onChange={s('recht')} options={['FL', 'CH', 'AT', 'DE', 'anderes']} /></Field>
      <Field label="Gerichtsstand"><Input value={f.gerichtsstand} onChange={s('gerichtsstand')} /></Field>
      <Field label="Link zur Ablage" full><Input value={f.ablage} onChange={s('ablage')} placeholder="SharePoint-Pfad" /></Field>
      <Field label="Anmerkung" full><Input value={f.anmerkung} onChange={s('anmerkung')} /></Field>
    </div>
  </Dialog>;
}

function LieferantDetail({ id }) {
  const { state, setState, go, toast, rolle } = useApp();
  const l = state.lieferanten.find(x => x.id === id);
  const alerts = useAlerts().filter(a => a.lieferant.id === id);
  const [open, setOpen] = useState({ vertraege: true });
  const tog = k => setOpen(o => ({ ...o, [k]: !o[k] }));
  const allOpen = ['vertraege', 'rollen', 'kpi', 'risiko', 'massnahmen', 'protokoll', 'preise'].every(k => open[k]);
  const [edit, setEdit] = useState(null);
  const [stamm, setStamm] = useState(null);
  const canEdit = rolle === 'Lieferantenmanager';
  if (!l) return null;
  const upd = (fn) => setState(s => ({ ...s, lieferanten: s.lieferanten.map(x => x.id === id ? fn(x) : x) }));
  const tabs = [['vertraege', 'Verträge (' + l.vertraege.length + ')'], ['rollen', 'Rollen und Anwendungen'], ['kpi', 'Leistungsmonitoring (KPI)'], ['risiko', 'Risikobewertung'], ['massnahmen', 'Zusammenfassung und Massnahmen']];
  return <>
    <PageHead inline right={rolle === 'Lieferantenmanager' && <Btn icon="fas fa-file-arrow-up" onClick={() => go('erfassen', { lieferantId: l.id })}>Vertrag erfassen</Btn>} crumbs={[{ l: 'Lieferanten', to: 'lieferanten' }, { l: l.name }]} title={l.name} sub={<span className="vm-row" style={{ gap: 15 }}><span>{l.name.endsWith(l.rechtsform) ? '' : l.rechtsform + ' · '}{l.ort} ({l.land})</span><span><i className="far fa-user"></i> {l.kontakt}</span><a href={'mailto:' + l.mail}><i className="far fa-envelope"></i> {l.mail}</a>{(l.telefone || []).filter(t => t.nr).map((t, i) => <a key={i} href={'tel:' + t.nr.replace(/\s/g, '')} title={t.art}><i className="fas fa-phone"></i> {t.nr}</a>)}</span>}
      actions={<>{canEdit && <Btn kind="secondary" icon="fas fa-pen" onClick={() => setStamm({ name: l.name, rechtsform: l.rechtsform, ort: l.ort, land: l.land, kontakt: l.kontakt, mail: l.mail, telefone: (l.telefone && l.telefone.length ? l.telefone : [{ art: 'Zentrale', nr: '' }]).map(t => ({ ...t })) })}>Stammdaten</Btn>}{canEdit ? <Select value={l.klasse} onChange={e => upd(x => ({ ...x, klasse: e.target.value }))} options={Object.entries(D.KLASSEN).map(([v, t]) => ({ v, l: 'Bedeutung: ' + t }))} /> : <Tag c="blue">{D.KLASSEN[l.klasse]}</Tag>}
        {rolle === 'Beschaffung' && <Btn icon="fas fa-file-pen" onClick={() => go('entwurf-neu', { lieferantId: l.id })}>Vertragsentwurf erstellen</Btn>}</>} />
    {stamm && <Dialog title="Stammdaten bearbeiten" onClose={() => setStamm(null)} footer={<><Btn kind="secondary" onClick={() => setStamm(null)}>Abbrechen</Btn><Btn icon="fas fa-check" disabled={!stamm.name.trim()} onClick={() => { upd(x => ({ ...x, ...stamm, telefone: stamm.telefone.filter(t => t.nr.trim()) })); setStamm(null); toast({ title: 'Stammdaten gespeichert' }); }}>Speichern</Btn></>}>
      <div className="vm-stack" style={{ gap: 14 }}>
        <div className="vm-small vm-muted"><i className="fas fa-circle-info"></i> Übernommen aus dem Kreditorenstamm bzw. beim Erfassen aus dem Vertrags-PDF extrahiert. Änderungen hier gelten nur im Vertragsmanagement.</div>
        <Field label="Firmenname"><Input value={stamm.name} onChange={e => setStamm({ ...stamm, name: e.target.value })} /></Field>
        <div className="vm-grid2"><Field label="Rechtsform"><Select value={stamm.rechtsform} onChange={e => setStamm({ ...stamm, rechtsform: e.target.value })} options={['AG', 'GmbH', 'Anstalt', 'Stiftung', 'Einzelunternehmen', 'KG', 'Andere']} /></Field><Field label="Land"><Select value={stamm.land} onChange={e => setStamm({ ...stamm, land: e.target.value })} options={['FL', 'CH', 'AT', 'DE']} /></Field></div>
        <Field label="Ort"><Input value={stamm.ort} onChange={e => setStamm({ ...stamm, ort: e.target.value })} /></Field>
        <div className="vm-grid2"><Field label="Kontaktperson"><Input value={stamm.kontakt} onChange={e => setStamm({ ...stamm, kontakt: e.target.value })} /></Field><Field label="E-Mail"><Input type="email" value={stamm.mail} onChange={e => setStamm({ ...stamm, mail: e.target.value })} /></Field></div>
        <Field label="Telefon"><div className="vm-stack" style={{ gap: 8 }}>{stamm.telefone.map((t, i) => { const set = p => setStamm({ ...stamm, telefone: stamm.telefone.map((x, j) => j === i ? { ...x, ...p } : x) }); return <div key={i} className="vm-row" style={{ gap: 8, flexWrap: 'nowrap' }}><div style={{ width: 150, flexShrink: 0 }}><Select value={t.art} onChange={e => set({ art: e.target.value })} options={['Zentrale', 'Direkt', 'Mobile', 'Support / Hotline', 'Pikett']} /></div><Input type="tel" style={{ flex: 1, minWidth: 0 }} value={t.nr} placeholder="+423 …" onChange={e => set({ nr: e.target.value })} /><button className="llv-btn llv-btn--icon" title="Entfernen" onClick={() => setStamm({ ...stamm, telefone: stamm.telefone.filter((x, j) => j !== i) })}><i className="far fa-trash-can"></i></button></div>; })}<div><Btn kind="secondary" icon="fas fa-plus" onClick={() => setStamm({ ...stamm, telefone: [...stamm.telefone, { art: 'Direkt', nr: '' }] })}>Nummer hinzufügen</Btn></div></div></Field>
      </div>
    </Dialog>}
    <div className="llv-content vm-stack">
      <AlertBanner alerts={alerts} />
      <div className="vm-row" style={{ justifyContent: 'flex-end' }}><a className="vm-small" onClick={() => setOpen(allOpen ? {} : { vertraege: true, rollen: true, kpi: true, risiko: true, massnahmen: true, protokoll: true, preise: true })}><i className={'fas fa-' + (allOpen ? 'compress' : 'expand')}></i> {allOpen ? 'Alle zuklappen' : 'Alle aufklappen'}</a></div>
      {<Card open={!!open.vertraege} onToggle={() => tog('vertraege')} title={'Verträge (' + l.vertraege.length + ')'} actions={canEdit && <><Btn kind="secondary" icon="fas fa-plus" onClick={() => setEdit({ typ: 'Einzelvertrag', titel: '', beginn: '', ende: '', kuendigungsfrist: 3, autoVerl: 0, review: '', wert: 0, recht: 'FL', gerichtsstand: 'Vaduz', ablage: '', anmerkung: '', status: 'Aktiv' })}>Manuell erfassen</Btn></>} pad={false}>
        <table className="llv-table vm-table"><thead><tr><th>Vertragsart</th><th>Bezeichnung</th><th>Laufzeit</th><th>Kündigungsfrist</th><th>Review-Datum</th><th className="num">Wert p. a.</th><th>Ablage</th><th>Anmerkung</th>{canEdit && <th></th>}</tr></thead><tbody>
          {l.vertraege.map(v => <tr key={v.id}>
            <td>{v.typ}</td><td className="vm-strong">{v.titel}</td>
            <td className="vm-nowrap vm-small">{fd(v.beginn)} – {v.ende ? fd(v.ende) : 'unbefristet'}{v.autoVerl ? <div className="vm-muted">verlängert sich um {v.autoVerl} Mt.</div> : null}</td>
            <td className="vm-nowrap">{v.kuendigungsfrist ? v.kuendigungsfrist + ' Monate' : '–'}{kuendTermin(v) && <div className="vm-small vm-muted">Termin {fd(kuendTermin(v))}</div>}</td>
            <td>{v.review ? fd(v.review) : <span style={{ color: 'var(--color-red-500)' }}>fehlt</span>}</td>
            <td className="num">{chf(v.wert)}</td>
            <td>{v.ablage ? <a title={v.ablage}><i className="fas fa-file-pdf"></i> Öffnen</a> : <span style={{ color: 'var(--color-red-500)' }}>fehlt</span>}</td>
            <td className="vm-small">{v.anmerkung}</td>
            {canEdit && <td><button className="llv-btn llv-btn--icon" onClick={() => setEdit(v)}><i className="fas fa-pen"></i></button></td>}
          </tr>)}
        </tbody></table>
      </Card>}
      {<Card open={!!open.preise} onToggle={() => tog('preise')} title="Preis- und Volumenentwicklung" pad={false}><PreisHistorie l={l} upd={upd} canEdit={canEdit} /></Card>}
      {<Card open={!!open.rollen} onToggle={() => tog('rollen')} title={<>{'Rollen und Verantwortlichkeiten je Anwendung (' + l.apps.length + ')'}<NeuTag l={l} b="rollen" /></>} actions={canEdit && <Btn kind="secondary" icon="fas fa-plus" onClick={() => upd(x => ({ ...x, apps: [...x.apps, { name: 'Neue Anwendung', level: 'L2', betrieb: '', fach: '', kontakt: x.kontakt, anm: '' }] }))}>Anwendung</Btn>} pad={false}>
        <table className="llv-table vm-table"><thead><tr><th>Anwendung</th><th>App-Level</th><th>Betriebsverantwortlich</th><th>Fachverantwortlich</th><th>Lieferantenkontakt</th><th>Anmerkung</th></tr></thead><tbody>
          {l.apps.length === 0 && <tr><td colSpan="6" className="vm-muted">Keine Anwendungen zugeordnet.</td></tr>}
          {l.apps.map((a, i) => { const set = (k) => (e) => upd(x => ({ ...x, apps: x.apps.map((y, j) => j === i ? { ...y, [k]: e.target.value } : y) })); return <tr key={i}>
            {canEdit ? <><td><Input value={a.name} onChange={set('name')} /></td><td><Select value={a.level} onChange={set('level')} options={Object.entries(D.LEVELS).map(([v, t]) => ({ v, l: t }))} /></td><td><Input value={a.betrieb} onChange={set('betrieb')} placeholder="offen" className={'llv-input' + (!a.betrieb ? ' is-error' : '')} /></td><td><Input value={a.fach} onChange={set('fach')} /></td><td><Input value={a.kontakt} onChange={set('kontakt')} /></td><td><Input value={a.anm} onChange={set('anm')} /></td></>
              : <><td>{a.name}</td><td>{D.LEVELS[a.level]}</td><td>{a.betrieb || '–'}</td><td>{a.fach}</td><td>{a.kontakt}</td><td>{a.anm}</td></>}
          </tr>; })}
        </tbody></table>
      </Card>}
      {<Card open={!!open.kpi} onToggle={() => tog('kpi')} title="Leistungsmonitoring (KPI)" pad={false}><BewertungsBlock gruppen={D.KPI} data={l.kpi} readOnly={!canEdit} onChange={(k, v) => upd(x => ({ ...x, kpi: { ...x.kpi, [k]: v } }))} /></Card>}
      {<Card open={!!open.risiko} onToggle={() => tog('risiko')} title={<>Risikobewertung der Unternehmung<NeuTag l={l} b="risiko" /></>} pad={false}><BewertungsBlock gruppen={[{ items: D.RISIKO }]} data={l.risiko} readOnly={!canEdit} onChange={(k, v) => upd(x => ({ ...x, risiko: { ...x.risiko, [k]: v } }))} /></Card>}
      {<Card open={!!open.massnahmen} onToggle={() => tog('massnahmen')} title="Zusammenfassung der Beurteilung und Massnahmenplan">
        <MassnahmenEditor l={l} upd={upd} canEdit={canEdit} />
      </Card>}
      {<Card open={!!open.protokoll} onToggle={() => tog('protokoll')} title={<>{'Änderungsprotokoll (' + (l.protokoll || []).length + ')'}<NeuTag l={l} /></>} pad={false}>
        {(l.protokoll || []).length === 0 ? <div className="vm-empty">Noch keine Änderungen aus Vertragsimporten.</div> : <table className="llv-table vm-table"><thead><tr><th>Datum</th><th>Bereich</th><th>Änderung</th><th>Quelle</th><th>Durch</th></tr></thead><tbody>
          {l.protokoll.map((p, i) => <tr key={i}><td className="vm-nowrap">{fd(pd(p.am))}</td><td><Tag c="blue">{BEREICH_LABEL[p.bereich]}</Tag></td><td>{p.text}</td><td className="vm-small"><i className="fas fa-file-pdf"></i> {p.quelle}</td><td className="vm-small vm-muted">{p.von}</td></tr>)}
        </tbody></table>}
      </Card>}
    </div>
    {edit && <VertragDialog v={edit} onClose={() => setEdit(null)} onSave={(v) => { upd(x => ({ ...x, vertraege: v.id ? x.vertraege.map(y => y.id === v.id ? v : y) : [...x.vertraege, { ...v, id: uid('V') }] })); setEdit(null); toast({ title: 'Vertrag gespeichert', text: 'Outlook-Termine für Kündigungstermin und Review wurden aktualisiert.' }); }} />}
  </>;
}

function MassnahmenEditor({ l, upd, canEdit }) {
  const { runAI } = useApp();
  const gen = async () => {
    const mangel = [...D.KPI.flatMap(g => g.items), ...D.RISIKO].filter(([k]) => (l.kpi[k] || l.risiko[k] || {}).wert === 'Mangelhaft').map(([k, t]) => t + ((l.kpi[k] || l.risiko[k]).begr ? ' (' + (l.kpi[k] || l.risiko[k]).begr + ')' : ''));
    const fallback = 'Gesamtbeurteilung: ' + (mangel.length ? mangel.length + ' Kriterien sind mangelhaft beurteilt (' + mangel.join('; ') + '). ' : 'Keine Mängel. ') + 'Massnahmen: Jahresgespräch terminieren und Mängel mit Fristen adressieren.';
    const txt = await runAI({ title: 'Massnahmenplan wird erstellt', steps: ['Beurteilungen und Begründungen lesen', 'Verträge und Fristen berücksichtigen', 'Massnahmen mit Verantwortlichkeiten formulieren'], minMs: 4200, preview: mangel.join('. '),
      task: () => askClaude('Lieferant: ' + l.name + ' (Klasse ' + l.klasse + '). Mangelhafte Kriterien: ' + (mangel.join('; ') || 'keine') + '. Verträge: ' + l.vertraege.map(v => v.typ + ' bis ' + (v.ende || 'unbefristet')).join(', ') + '. Bisherige Notiz: ' + (l.massnahmen || '-') + '\nSchreibe eine Zusammenfassung der Beurteilung (2 Sätze) und einen Massnahmenplan (3–4 nummerierte Punkte mit Termin im Format TT.MM.JJJJ, ab heute 06.11.2026). Formelles Schweizer Hochdeutsch (ss statt ß), keine Ausrufezeichen, kein Markdown ausser Nummerierung.', 'Du bist Lieferantenmanager der Liechtensteinischen Landesverwaltung.', 800),
      fallback: () => fallback });
    upd(x => ({ ...x, massnahmen: txt.trim() }));
  };
  return canEdit ? <div className="vm-stack" style={{ gap: 10 }}><div><Btn kind="secondary" icon="fas fa-wand-magic-sparkles" onClick={gen}>Aus Beurteilung erstellen (KI)</Btn></div><textarea className="llv-input vm-textarea" rows="8" value={l.massnahmen} placeholder="Zusammenfassung und Massnahmen erfassen oder per KI erstellen lassen" onChange={e => upd(x => ({ ...x, massnahmen: e.target.value }))}></textarea></div> : <p style={{ whiteSpace: 'pre-wrap' }}>{l.massnahmen || '–'}</p>;
}

// ---------- Vertrag erfassen (PDF → KI) ----------
const EXTRACT_FIELDS = [['lieferant', 'Lieferant'], ['typ', 'Vertragsart'], ['titel', 'Bezeichnung'], ['beginn', 'Beginn', 'date'], ['ende', 'Ende', 'date'], ['kuendigungsfrist', 'Kündigungsfrist (Monate)', 'number'], ['autoVerl', 'Automatische Verlängerung (Monate)', 'number'], ['wert', 'Wert p. a. (CHF)', 'number'], ['recht', 'Anwendbares Recht'], ['gerichtsstand', 'Gerichtsstand'], ['anwendung', 'Anwendung'], ['appLevel', 'App-Level'], ['kontakt', 'Lieferantenkontakt'], ['sla', 'Service Level']];
const FALLBACK_EXTRACT = { lieferant: { v: 'Medicus Soft AG', c: 98, q: 'Medicus Soft AG, Rosenbergstrasse 22, 9000 St. Gallen' }, typ: { v: 'Wartung/Support (SLA)', c: 95, q: 'SUPPORT- UND WARTUNGSVERTRAG' }, titel: { v: 'Wartung Terminplanung Impfzentrum', c: 88, q: 'Applikation «Terminplanung Impfzentrum»' }, beginn: { v: '2027-01-01', c: 99, q: 'beginnt am 1. Januar 2027' }, ende: { v: '2028-12-31', c: 99, q: 'gilt bis 31. Dezember 2028' }, kuendigungsfrist: { v: 6, c: 96, q: 'Frist von 6 Monaten' }, autoVerl: { v: 12, c: 94, q: 'verlängert sich danach stillschweigend um jeweils 12 Monate' }, wert: { v: 28800, c: 97, q: "CHF 28'800.– pro Jahr" }, recht: { v: 'FL', c: 99, q: 'liechtensteinisches Recht' }, gerichtsstand: { v: 'Vaduz', c: 99, q: 'Gerichtsstand ist Vaduz' }, anwendung: { v: 'Terminplanung Impfzentrum', c: 90, q: 'Applikation «Terminplanung Impfzentrum»' }, appLevel: { v: 'L2', c: 62, q: 'Betrieb durch den Lieferanten, Minimalbetreuung' }, kontakt: { v: 'Andrea Baumann', c: 97, q: 'Ansprechpartnerin Lieferant: Andrea Baumann' }, sla: { v: '99.5 % / P1 Reaktion 2 h', c: 91, q: 'Verfügbarkeit 99.5 % pro Monat; Priorität 1: Reaktion innert 2 Stunden' } };

async function pdfToText(file) {
  if (!window.pdfjsLib) throw new Error('pdf.js fehlt');
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let t = ''; for (let i = 1; i <= Math.min(pdf.numPages, 15); i++) { const p = await pdf.getPage(i); const c = await p.getTextContent(); t += c.items.map(x => x.str).join(' ') + '\n'; }
  return t;
}

const BEREICH_LABEL = { stamm: 'Stammdaten', rollen: 'Rollen und Anwendungen', risiko: 'Risikobewertung', klasse: 'Bedeutung' };
function supplierImpacts(l, v) {
  if (!l) return [];
  const out = [], hasAVV = l.vertraege.some(x => x.typ === 'AVV') || v('typ') === 'AVV';
  const kontakt = String(v('kontakt') || '').trim();
  if (kontakt && kontakt !== l.kontakt) out.push({ id: 'kontakt', bereich: 'stamm', label: 'Kontaktperson', alt: l.kontakt || '–', neu: kontakt });
  const rf = (String(v('lieferant')).match(/\b(AG|GmbH|Anstalt|Stiftung|KG)\b/) || [])[1];
  if (rf && rf !== l.rechtsform) out.push({ id: 'rechtsform', bereich: 'risiko', label: 'Gesellschaftsform (Stammdaten und Risikobewertung)', alt: l.rechtsform, neu: rf, hint: 'Änderung der Gesellschaftsform – Risikobewertung prüfen.' });
  const app = String(v('anwendung') || '').trim(), lvl = v('appLevel') || 'L2';
  const ex = app && l.apps.find(a => a.name.toLowerCase() === app.toLowerCase());
  if (app && !ex) out.push({ id: 'app', bereich: 'rollen', label: 'Neue Anwendung', alt: '–', neu: app + ' (' + lvl + ')', hint: 'Betriebs- und Fachverantwortung danach ergänzen.' });
  if (ex && ex.level !== lvl) out.push({ id: 'level', bereich: 'rollen', label: 'App-Level «' + ex.name + '»', alt: ex.level, neu: lvl });
  if ((lvl === 'L3' || lvl === 'L4') && l.klasse !== 'A') out.push({ id: 'klasse', bereich: 'klasse', label: 'Bedeutung des Lieferanten', alt: 'Klasse ' + l.klasse, neu: 'Klasse A', hint: 'L3/L4-Anwendungen gelten als strategisch.' });
  if ((lvl === 'L3' || lvl === 'L4') && !hasAVV) out.push({ id: 'avv', bereich: 'info', label: 'Neue Erinnerung', alt: '', neu: 'AVV fehlt für ' + lvl + '-Anwendung', info: true });
  return out;
}
function applyImpacts(l, imps, v, quelle) {
  let x = { ...l }; const log = [];
  imps.forEach(i => {
    if (i.info) return;
    if (i.id === 'kontakt') x.kontakt = i.neu;
    if (i.id === 'rechtsform') { x.rechtsform = i.neu; x.risiko = { ...x.risiko, rechtsform: { ...(x.risiko.rechtsform || {}), begr: i.neu + ' (gemäss Vertrag ' + quelle + ') – Bewertung prüfen' } }; }
    if (i.id === 'app') x.apps = [...x.apps, { name: v('anwendung'), level: v('appLevel') || 'L2', betrieb: '', fach: '', kontakt: v('kontakt'), anm: 'Aus KI-Erfassung' }];
    if (i.id === 'level') x.apps = x.apps.map(a => a.name.toLowerCase() === String(v('anwendung')).toLowerCase() ? { ...a, level: v('appLevel') } : a);
    if (i.id === 'klasse') x.klasse = 'A';
    log.push({ am: iso(TODAY), von: 'Daniel Meier', quelle, bereich: i.bereich, text: i.label + ': ' + i.alt + ' → ' + i.neu });
  });
  x.protokoll = [...log, ...(x.protokoll || [])];
  return x;
}

function Erfassen({ lieferantId }) {
  const { state, setState, go, toast, runAI } = useApp();
  const [file, setFile] = useState(null); const [res, setRes] = useState(null); const [drag, setDrag] = useState(false); const [src, setSrc] = useState('');
  const inp = useRef();
  const start = async (f, text) => {
    setFile(f);
    let raw = text;
    const out = await runAI({ title: 'Vertrag wird analysiert', sub: f.name, minMs: 6500, preview: text || 'Seite 1 wird gelesen. Parteien werden identifiziert. Laufzeitklauseln werden gesucht. Kündigungsbestimmungen werden ausgewertet. Vergütung wird erkannt.',
      steps: ['Dokument in SharePoint ablegen', 'Text erkennen (OCR)', 'Vertragsdaten extrahieren', 'Mit Lieferantenstamm abgleichen', 'Fristen und Erinnerungen berechnen'],
      task: async () => {
        if (!raw) raw = await pdfToText(f);
        const txt = await askClaude('Extrahiere aus folgendem Vertrag die Felder als JSON-Objekt. Für jedes Feld: {"v": Wert, "c": Konfidenz 0-100, "q": kurzes wörtliches Zitat aus dem Vertrag als Beleg}. Felder: lieferant, typ (genau einer von: ' + D.VERTRAGSARTEN.join(', ') + '), titel (kurze Bezeichnung), beginn (YYYY-MM-DD), ende (YYYY-MM-DD oder leer), kuendigungsfrist (Monate, Zahl), autoVerl (Monate automatische Verlängerung, 0 wenn keine), wert (CHF pro Jahr, Zahl), recht (FL, CH, AT, DE oder anderes), gerichtsstand, anwendung, appLevel (L0 SaaS kundenbetreut, L1 OnPrem kundenbetreut, L2 minimalbetreut, L3 individualbetreut, L4 voll betreut – schätzen), kontakt, sla (kurz). Nur JSON ausgeben.\n\nVERTRAG:\n' + raw.slice(0, 12000), 'Du extrahierst Vertragsdaten für die Liechtensteinische Landesverwaltung.', 1500);
        return parseJSON(txt);
      }, fallback: () => FALLBACK_EXTRACT });
    setSrc(raw || ''); setRes(out);
  };
  const match = res && state.lieferanten.find(l => res.lieferant && l.name.toLowerCase().split(' ')[0] === String(res.lieferant.v).toLowerCase().split(' ')[0]);
  const target = lieferantId || (match && match.id) || '';
  const [ziel, setZiel] = useState('');
  useEffect(() => { setZiel(target); }, [res]);
  const [skip, setSkip] = useState({});
  const zielL = state.lieferanten.find(l => l.id === ziel);
  const impacts = res && zielL ? supplierImpacts(zielL, k => res[k] ? res[k].v : '') : [];
  const set = (k) => (e) => setRes({ ...res, [k]: { ...res[k], v: e.target.value, c: 100, edited: true } });
  const save = () => {
    const v = (k) => res[k] ? res[k].v : '';
    const ende = v('ende'), kf = +v('kuendigungsfrist') || 0;
    const reviewD = ende && kf ? iso(addM(addM(pd(ende), -kf), -3)) : iso(addM(TODAY, 12));
    const path = 'Verträge/' + String(v('lieferant')).split(' ')[0] + '/' + file.name;
    const vertrag = { id: uid('V'), typ: D.VERTRAGSARTEN.includes(v('typ')) ? v('typ') : 'Einzelvertrag', titel: v('titel'), beginn: v('beginn'), ende, kuendigungsfrist: kf, autoVerl: +v('autoVerl') || 0, review: reviewD, wert: +v('wert') || 0, recht: v('recht'), gerichtsstand: v('gerichtsstand'), status: 'Aktiv', ablage: path, anmerkung: v('sla') ? 'SLA: ' + v('sla') : '' };
    let lid = ziel;
    setState(s => {
      let ls = s.lieferanten;
      if (!lid) { lid = uid('L'); ls = [...ls, { id: lid, name: v('lieferant'), ort: '', land: v('recht') || 'CH', rechtsform: /GmbH/.test(v('lieferant')) ? 'GmbH' : 'AG', klasse: 'B', kontakt: v('kontakt'), mail: '', tel: '', vertraege: [], apps: [], kpi: {}, risiko: {}, massnahmen: '' }]; }
      const isNew = !ziel;
      return { ...s, lieferanten: ls.map(l => { if (l.id !== lid) return l; const imps = isNew ? supplierImpacts({ ...l, kontakt: v('kontakt'), rechtsform: l.rechtsform, klasse: l.klasse }, v).filter(i => i.id === 'app') : impacts.filter(i => !skip[i.id]); return applyImpacts({ ...l, vertraege: [...l.vertraege, vertrag] }, imps, v, file.name); }) };
    });
    const nImp = impacts.filter(i => !i.info && !skip[i.id]).length;
    if (nImp) setTimeout(() => toast({ title: nImp + ' Änderung' + (nImp > 1 ? 'en' : '') + ' am Lieferanten übernommen', text: 'Im Änderungsprotokoll des Lieferanten ersichtlich.', icon: 'fas fa-clock-rotate-left' }), 1200);
    toast({ title: 'Vertrag erfasst', text: 'Abgelegt unter SharePoint › ' + path.replace(/\//g, ' › ') });
    setTimeout(() => toast({ title: 'Outlook-Termine erstellt', text: 'Review ' + fd(reviewD) + (ende && kf ? ', Kündigungstermin ' + fd(addM(pd(ende), -kf)) : '') + (ende ? ', Vertragsende ' + fd(ende) : ''), icon: 'fas fa-calendar-check' }), 600);
    setTimeout(() => go('lieferant', { id: lid }), 50);
  };
  const conf = (c) => c >= 90 ? 'green' : c >= 75 ? 'yellow' : 'red';
  return <>
    <PageHead crumbs={[{ l: 'Verträge', to: 'vertraege' }, { l: 'Vertrag erfassen' }]} title="Vertrag erfassen" sub="PDF hochladen – die KI liest die Vertragsdaten aus, Sie prüfen und bestätigen." />
    <div className="llv-content vm-stack">
      {!res && <Card>
        <div className={'vm-drop' + (drag ? ' is-drag' : '')} onDragOver={e => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) start(f); }} onClick={() => inp.current.click()}>
          <i className="fas fa-file-pdf"></i>
          <div className="vm-drop__t">Vertrag als PDF hierher ziehen oder <a>Datei auswählen</a></div>
          <div className="vm-muted vm-small">Das Dokument wird automatisch in der SharePoint-Bibliothek «Lieferantenmanagement › Verträge» des jeweiligen Lieferanten abgelegt.</div>
          <input ref={inp} type="file" accept="application/pdf" hidden onChange={e => e.target.files[0] && start(e.target.files[0])} />
        </div>
        <div className="vm-row" style={{ justifyContent: 'center', marginTop: 15 }}><span className="vm-muted">Kein PDF zur Hand?</span><Btn kind="secondary" icon="fas fa-file-lines" onClick={() => start({ name: D.BEISPIEL_PDF.name }, D.BEISPIEL_PDF.text)}>Beispielvertrag verwenden</Btn></div>
      </Card>}
      {res && <div className="vm-split">
        <Card title="Erkannte Vertragsdaten" actions={<span className="vm-small vm-muted"><i className="fas fa-wand-magic-sparkles"></i> KI-Vorschlag – bitte prüfen</span>}>
          <div className="vm-field" style={{ marginBottom: 15 }}><span className="vm-field__label">Zuordnung Lieferant</span>
            <Select value={ziel} onChange={e => setZiel(e.target.value)} options={[{ v: '', l: 'Neuen Lieferanten anlegen: ' + (res.lieferant ? res.lieferant.v : '') }, ...state.lieferanten.map(l => ({ v: l.id, l: l.name + (match && match.id === l.id ? '  (KI-Abgleich: Treffer)' : '') }))]} />
          </div>
          <table className="llv-table vm-extract"><tbody>{EXTRACT_FIELDS.map(([k, label, type]) => { const f = res[k] || { v: '', c: 0, q: '' }; return <tr key={k}>
            <td className="vm-extract__l">{label}</td>
            <td>{k === 'typ' ? <Select value={f.v} onChange={set(k)} options={D.VERTRAGSARTEN} /> : k === 'appLevel' ? <Select value={f.v} onChange={set(k)} options={Object.entries(D.LEVELS).map(([v, t]) => ({ v, l: t }))} /> : <Input type={type || 'text'} value={f.v ?? ''} onChange={set(k)} />}
              {f.q && !f.edited && <div className="vm-quote">«{f.q}»</div>}</td>
            <td style={{ width: 95, textAlign: 'right' }}>{f.edited ? <Tag c="grey">geändert</Tag> : <Tag c={conf(f.c)}>{f.c} %</Tag>}</td>
          </tr>; })}</tbody></table>
        </Card>
        <div className="vm-stack">
          <Card title="Dokument">
            <div className="vm-doc-file"><i className="fas fa-file-pdf"></i><div><b>{file.name}</b><div className="vm-small vm-muted"><i className="fas fa-circle-check" style={{ color: 'var(--color-green-500)' }}></i> In SharePoint abgelegt</div></div></div>
            {src && <pre className="vm-src">{src.slice(0, 2500)}</pre>}
          </Card>
          {zielL && <Card title={'Auswirkungen auf ' + zielL.name}>
            {impacts.length === 0 ? <div className="vm-muted vm-small"><i className="fas fa-circle-check" style={{ color: 'var(--color-green-500)' }}></i> Keine Abweichungen zu den bestehenden Lieferantendaten.</div> : <>
              <div className="vm-small vm-muted" style={{ marginBottom: 10 }}>Der Vertrag weicht von den gespeicherten Daten ab. Wählen Sie, was übernommen werden soll.</div>
              <div className="vm-stack" style={{ gap: 10 }}>{impacts.map(i => <label key={i.id} className="llv-check" style={{ alignItems: 'flex-start' }}>
                {i.info ? <i className="fas fa-bell" style={{ color: 'var(--color-red-500)', width: 16, marginTop: 3 }}></i> : <input type="checkbox" checked={!skip[i.id]} onChange={e => setSkip({ ...skip, [i.id]: !e.target.checked })} />}
                <span><span className="vm-row" style={{ gap: 6 }}><Tag c={i.info ? 'red' : 'blue'}>{i.info ? 'Erinnerung' : BEREICH_LABEL[i.bereich]}</Tag><b>{i.label}</b></span>
                  <div className="vm-small">{i.alt && <><s className="vm-muted">{i.alt}</s> → </>}<b>{i.neu}</b></div>
                  {i.hint && <div className="vm-small vm-muted">{i.hint}</div>}</span>
              </label>)}</div></>}
          </Card>}
          <Card title="Nach dem Speichern">
            <ul className="vm-list">
              <li><i className="far fa-calendar-check"></i>Outlook-Termine für Review, Kündigungstermin und Vertragsende</li>
              <li><i className="far fa-envelope"></i>E-Mail-Erinnerung {state.settings.lead.kuendigung} Tage vor dem Kündigungstermin</li>
              <li><i className="fas fa-triangle-exclamation"></i>Prüfung auf fehlende Daten (z. B. AVV bei L3/L4)</li>
            </ul>
            <div className="vm-row" style={{ justifyContent: 'flex-end', marginTop: 15 }}><Btn kind="secondary" onClick={() => { setRes(null); setFile(null); }}>Verwerfen</Btn><Btn icon="fas fa-check" onClick={save}>Bestätigen und speichern</Btn></div>
          </Card>
        </div>
      </div>}
    </div>
  </>;
}

function Einstellungen() {
  const { state, setState, toast } = useApp();
  const st = state.settings;
  const set = (fn) => setState(s => ({ ...s, settings: fn(s.settings) }));
  const rows = [['kuendigung', 'Kündigungsfrist läuft ab', 'Vor dem letzten möglichen Kündigungstermin'], ['review', 'Review-Datum fällig', 'Vor dem Review-Datum des Vertrags'], ['ende', 'Vertrag läuft aus', 'Vor dem Vertragsende (ohne automatische Verlängerung)']];
  return <>
    <PageHead title="Erinnerungen" sub="Vorlaufzeiten und Kanäle für Fristen und fehlende Daten" />
    <div className="llv-content vm-stack" style={{ maxWidth: 980 }}>
      <Card title="Vorlaufzeiten">
        <table className="llv-table"><thead><tr><th style={{ width: 40 }}>Aktiv</th><th>Erinnerung</th><th style={{ width: 200 }}>Vorlauf</th></tr></thead><tbody>
          {rows.map(([k, t, s]) => <tr key={k}><td><label className="llv-check"><input type="checkbox" checked={st.aktiv[k]} onChange={e => set(x => ({ ...x, aktiv: { ...x.aktiv, [k]: e.target.checked } }))} /></label></td><td><b>{t}</b><div className="vm-small vm-muted">{s}</div></td>
            <td><Select value={st.lead[k]} onChange={e => set(x => ({ ...x, lead: { ...x.lead, [k]: +e.target.value } }))} options={[30, 60, 90, 120, 180].map(n => ({ v: n, l: n + ' Tage vorher' }))} /></td></tr>)}
          <tr><td><label className="llv-check"><input type="checkbox" checked={st.aktiv.fehlend} onChange={e => set(x => ({ ...x, aktiv: { ...x.aktiv, fehlend: e.target.checked } }))} /></label></td><td><b>Fehlende Daten</b><div className="vm-small vm-muted">AVV fehlt bei L3/L4-Anwendung, Ablage oder Review-Datum fehlt, Beurteilung nicht erfasst</div></td><td className="vm-muted">laufend</td></tr>
        </tbody></table>
      </Card>
      <div className="vm-grid2">
        <Card title="Kanäle">
          <div className="vm-stack" style={{ gap: 10 }}>
            <label className="llv-check"><input type="checkbox" checked={st.kanal.mail} onChange={e => set(x => ({ ...x, kanal: { ...x.kanal, mail: e.target.checked } }))} /><span><b>Outlook E-Mail</b> – einzeln bei Erreichen des Vorlaufs</span></label>
            <label className="llv-check"><input type="checkbox" checked={st.kanal.kalender} onChange={e => set(x => ({ ...x, kanal: { ...x.kanal, kalender: e.target.checked } }))} /><span><b>Outlook-Kalendereintrag</b> – für jeden Termin beim Speichern</span></label>
            <Field label="Empfänger"><Select value={st.empfaenger} onChange={e => set(x => ({ ...x, empfaenger: e.target.value }))} options={['Lieferantenmanager und Fachverantwortliche', 'Nur Lieferantenmanager', 'Lieferantenmanager, Fach- und Betriebsverantwortliche']} /></Field>
            <Field label="Sammel-E-Mail"><Select value={st.zusammenfassung} onChange={e => set(x => ({ ...x, zusammenfassung: e.target.value }))} options={['Keine', 'Wöchentlich (Montag 07.30 Uhr)', 'Monatlich (1. Arbeitstag)']} /></Field>
            <div className="vm-small vm-muted">Versand über das Postfach vertragsmanagement@llv.li (Microsoft Graph).</div>
          </div>
        </Card>
        <Card title="Vorschau E-Mail">
          <div className="vm-mail">
            <div className="vm-mail__h"><div><span>Von</span>vertragsmanagement@llv.li</div><div><span>Betreff</span>Kündigungsfrist läuft ab: Hosting Bürgerportal</div></div>
            <p>Guten Tag</p>
            <p>Der letzte mögliche Kündigungstermin für den Vertrag <b>«Hosting Bürgerportal»</b> mit <b>Alpina Cloud Services GmbH</b> ist der <b>30.09.2026</b>. Ohne Kündigung verlängert sich der Vertrag um 36 Monate.</p>
            <p><a>Vertrag im Vertragsmanagement öffnen</a></p>
            <p className="vm-muted vm-small">Diese Nachricht wurde automatisch erstellt.</p>
          </div>
        </Card>
      </div>
      <div className="vm-row" style={{ justifyContent: 'flex-end' }}><Btn onClick={() => toast({ title: 'Einstellungen gespeichert' })}>Speichern</Btn></div>
    </div>
  </>;
}

Object.assign(window, { LMHome, LieferantenListe, LieferantDetail, VertraegeListe, Erfassen, Einstellungen, useAlerts });
