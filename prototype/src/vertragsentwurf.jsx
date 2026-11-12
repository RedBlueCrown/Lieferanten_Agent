// ---------- Modul 2: Vertragsentwurf ----------
const TYP_ICON = { 'Rahmenvertrag': 'fas fa-layer-group', 'Einzelvertrag': 'fas fa-file-contract', 'AVV': 'fas fa-user-shield', 'SaaS-Vertrag': 'fas fa-cloud', 'Wartung/Support (SLA)': 'fas fa-screwdriver-wrench', 'Beratung/Dienstleistung': 'fas fa-user-tie', 'NDA': 'fas fa-user-secret' };
const STATUS_TAG = { 'Entwurf': 'grey', 'In Prüfung': 'yellow', 'Nachverhandlung': 'red', 'Freigegeben': 'green', 'Aktiv': 'blue' };
const hasSLA = (t) => t === 'SaaS-Vertrag' || t === 'Wartung/Support (SLA)';

function BHome() {
  const { state, go } = useApp();
  const zurueck = state.entwuerfe.filter(e => e.status === 'Nachverhandlung');
  return <>
    <PageHead title="Guten Tag, Daniel Meier" sub={'Beschaffung · ' + fd(TODAY)} actions={<Btn icon="fas fa-plus" onClick={() => go('entwurf-neu')}>Neuer Vertragsentwurf</Btn>} />
    <div className="llv-content vm-stack">
      <div className="vm-typegrid">{D.VERTRAGSARTEN.map(t => <button key={t} className="vm-typecard" onClick={() => go('entwurf-neu', { typ: t })}><i className={TYP_ICON[t]}></i><b>{t}</b><span>{D.STANDARD_KLAUSELN[t].length + 1} Bausteine · Standard v{D.STANDARD_META[t].version}</span></button>)}</div>
      {zurueck.length > 0 && <div className="llv-notif llv-notif--error"><div className="llv-notif__icon"><i className="fas fa-rotate-left"></i></div><div className="llv-notif__body"><div><b>Vom Rechtsdienst zurückgewiesen:</b> {zurueck.map(e => <a key={e.id} onClick={() => go('entwurf', { id: e.id })} style={{ marginLeft: 8 }}>{e.titel}</a>)}</div></div></div>}
      <Card title="Meine Vertragsentwürfe" pad={false}><EntwurfTabelle /></Card>
      <Card title="Lieferantenpapier zur Prüfung" pad={false}>
        <table className="llv-table vm-table"><thead><tr><th>Vertrag</th><th>Art</th><th>Eingereicht</th><th>Status</th></tr></thead><tbody>
          {state.pruefungen.filter(p => p.quelle === 'Lieferantenpapier').map(p => <tr key={p.id}><td><b>{p.titel}</b><div className="vm-small vm-muted">{p.lieferant}</div></td><td>{p.typ}</td><td>{fd(p.eingang)}</td><td><Tag c={STATUS_TAG[p.status]}>{p.status}</Tag></td></tr>)}
        </tbody></table>
      </Card>
    </div>
  </>;
}

function EntwurfTabelle() {
  const { state, go } = useApp();
  if (!state.entwuerfe.length) return <div className="vm-empty"><i className="far fa-file"></i>Noch keine Entwürfe. Wählen Sie oben eine Vertragsart.</div>;
  return <table className="llv-table vm-table"><thead><tr><th>Entwurf</th><th>Art</th><th>Erstellt</th><th>Status</th></tr></thead><tbody>
    {state.entwuerfe.map(e => <tr key={e.id} className="vm-click" onClick={() => go('entwurf', { id: e.id })}><td><b>{e.titel}</b><div className="vm-small vm-muted">{e.lieferant}</div></td><td>{e.typ}</td><td>{fd(e.erstellt)}</td><td><Tag c={STATUS_TAG[e.status]}>{e.status}</Tag></td></tr>)}
  </tbody></table>;
}

function Entwuerfe() {
  const { go } = useApp();
  return <><PageHead title="Vertragsentwürfe" actions={<Btn icon="fas fa-plus" onClick={() => go('entwurf-neu')}>Neuer Vertragsentwurf</Btn>} /><div className="llv-content"><Card pad={false}><EntwurfTabelle /></Card></div></>;
}

function fillText(k, f) {
  let t = D.KLAUSELN[k].muster.replace('[Laufzeit]', f.laufzeit + ' Monaten').replace('[Frist]', f.kuendigungsfrist).replace('[Betrag]', 'CHF ' + String(f.betrag || 0).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2019') + (f.modell === 'Aufwand' ? ' (Kostendach)' : ' pro Jahr'));
  let abw = null;
  if (k === 'sla_verf' && f.verfuegbarkeit && +f.verfuegbarkeit !== 99.5) { t = t.replace('99.5 %', f.verfuegbarkeit + ' %'); if (+f.verfuegbarkeit < 99.5) abw = 'Verfügbarkeit unter Standard (99.5 %)'; }
  if (k === 'sla_reakt' && f.p1 && +f.p1 !== 1) { t = t.replace('Reaktion innert 1 Stunde', 'Reaktion innert ' + f.p1 + ' Stunden'); if (+f.p1 > 1) abw = 'P1-Reaktionszeit über Standard (1 h)'; }
  if (k === 'kuendigung' && +f.kuendigungsfrist > 6) abw = 'Kündigungsfrist über 6 Monate';
  if (k === 'laufzeit' && +f.laufzeit > 36) abw = 'Feste Laufzeit über 3 Jahre';
  if (k === 'stundensatz' && (+f.senior > 180 || +f.junior > 130)) { t = t.replace('180', f.senior).replace('130', f.junior); abw = 'Stundensätze über LLV-Ansätzen'; }
  if (k === 'konvstrafe' && f.strafe && +f.strafe !== 20000) { t = t.replace('20\u2019000', String(f.strafe).replace(/\B(?=(\d{3})+(?!\d))/g, '\u2019')); if (+f.strafe < 20000) abw = 'Konventionalstrafe unter Standard'; }
  return { text: t, abw };
}

function EntwurfNeu({ typ: typ0, lieferantId }) {
  const { state, setState, go, runAI, toast } = useApp();
  const [step, setStep] = useState(typ0 ? 1 : 0);
  const lf = state.lieferanten.find(l => l.id === lieferantId);
  const [f, setF] = useState({ typ: typ0 || '', lieferantId: lieferantId || '', neuerLieferant: '', amt: 'Amt für Informatik', titel: '', beschreibung: '', beginn: '2027-01-01', laufzeit: 36, kuendigungsfrist: 6, betrag: '', modell: 'Pauschal', verfuegbarkeit: 99.5, p1: 1, senior: 180, junior: 130, strafe: 20000 });
  const s = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const lname = f.lieferantId ? state.lieferanten.find(l => l.id === f.lieferantId)?.name : f.neuerLieferant;
  const steps = ['Vertragsart', 'Parteien und Gegenstand', 'Konditionen', 'Zusammenfassung'];
  const ok = [!!f.typ, !!(lname && f.titel && f.beschreibung), true, true][step];
  const create = async () => {
    const meta = D.STANDARD_META[f.typ];
    const fallback = 'Gegenstand dieses Vertrags ist ' + f.beschreibung.trim().replace(/\.$/, '') + '. Der Lieferant erbringt die Leistungen für die Liechtensteinische Landesverwaltung, ' + f.amt + ', fachgerecht und nach dem aktuellen Stand der Technik. Die Einzelheiten ergeben sich aus der Leistungsbeschreibung in Anhang 1.';
    const gegenstand = await runAI({ title: 'Vertragsentwurf wird erstellt', sub: f.typ + ' · ' + lname, minMs: 5800, preview: D.STANDARD_KLAUSELN[f.typ].map(k => D.KLAUSELN[k].titel + ': ' + D.KLAUSELN[k].muster.split('.')[0] + '.').join(' '),
      steps: ['Prüfstandard «' + f.typ + '» v' + meta.version + ' aus SharePoint laden', 'Textbausteine auswählen (' + D.STANDARD_KLAUSELN[f.typ].length + ')', 'Platzhalter mit Ihren Angaben befüllen', 'Vertragsgegenstand formulieren', 'Vorprüfung gegen Standard'],
      task: () => askClaude('Formuliere die Klausel «Vertragsgegenstand» für einen ' + f.typ + ' zwischen der Liechtensteinischen Landesverwaltung (' + f.amt + ') und ' + lname + '. Bezeichnung: ' + f.titel + '. Angaben der Beschaffung: ' + f.beschreibung + '\n3–4 Sätze, formelle Vertragssprache, Schweizer Hochdeutsch (ss statt ß), verweise für Details auf «Anhang 1 (Leistungsbeschreibung)». Nur den Klauseltext ausgeben, ohne Überschrift.', 'Du bist Vertragsjurist der Liechtensteinischen Landesverwaltung.', 600),
      fallback: () => fallback });
    const klauseln = [{ id: 'gegenstand', titel: 'Vertragsgegenstand', text: gegenstand.trim(), quelle: 'KI', abw: null },
      ...D.STANDARD_KLAUSELN[f.typ].map(k => { const r = fillText(k, f); return { id: k, titel: D.KLAUSELN[k].titel, text: r.text, original: r.text, quelle: r.abw ? 'Abweichung' : 'Textbaustein', abw: r.abw }; })];
    const id = uid('E');
    setState(st => ({ ...st, entwuerfe: [{ id, typ: f.typ, titel: f.titel, lieferant: lname, lieferantId: f.lieferantId, amt: f.amt, felder: { beginn: f.beginn, ende: iso(addM(addM(pd(f.beginn), +f.laufzeit), 0)), kuendigungsfrist: f.kuendigungsfrist, betrag: f.betrag, laufzeit: f.laufzeit }, klauseln, status: 'Entwurf', erstellt: iso(TODAY), standardVersion: meta.version }, ...st.entwuerfe] }));
    go('entwurf', { id });
    const n = klauseln.filter(k => k.abw).length;
    toast(n ? { kind: 'warn', icon: 'fas fa-triangle-exclamation', title: 'Entwurf erstellt – ' + n + ' Abweichung(en) vom Standard', text: 'Abweichungen sind markiert und werden vom Rechtsdienst geprüft.' } : { title: 'Entwurf erstellt', text: 'Alle Bausteine entsprechen dem Standard.' });
  };
  return <>
    <PageHead crumbs={[{ l: 'Entwürfe', to: 'entwuerfe' }, { l: 'Neuer Vertragsentwurf' }]} title="Neuer Vertragsentwurf" />
    <div className="llv-content vm-stack" style={{ maxWidth: 1000 }}>
      <ol className="vm-steps">{steps.map((t, i) => <li key={t} className={i === step ? 'is-active' : i < step ? 'is-done' : ''} onClick={() => i < step && setStep(i)}><span>{i < step ? <i className="fas fa-check"></i> : i + 1}</span>{t}</li>)}</ol>
      <Card>
        {step === 0 && <div className="vm-typegrid">{D.VERTRAGSARTEN.map(t => <button key={t} className={'vm-typecard' + (f.typ === t ? ' is-on' : '')} onClick={() => setF({ ...f, typ: t })}><i className={TYP_ICON[t]}></i><b>{t}</b><span>{D.STANDARD_KLAUSELN[t].map(k => D.KLAUSELN[k].titel).slice(0, 4).join(', ')} …</span></button>)}</div>}
        {step === 1 && <div className="vm-grid2">
          <Field label="Lieferant"><Select value={f.lieferantId} onChange={s('lieferantId')} options={[{ v: '', l: 'Neuer Lieferant …' }, ...state.lieferanten.map(l => ({ v: l.id, l: l.name }))]} /></Field>
          {!f.lieferantId ? <Field label="Name neuer Lieferant"><Input value={f.neuerLieferant} onChange={s('neuerLieferant')} placeholder="Firma, Rechtsform" /></Field> : <Field label="Lieferantenkontakt"><Input disabled value={state.lieferanten.find(l => l.id === f.lieferantId)?.kontakt || ''} /></Field>}
          <Field label="Auftraggebende Stelle"><Select value={f.amt} onChange={s('amt')} options={['Amt für Informatik', 'Steuerverwaltung', 'Amt für Gesundheit', 'Amt für Personal', 'Amt für Statistik', 'Landesarchiv', 'Motorfahrzeugkontrolle']} /></Field>
          <Field label="Bezeichnung des Vertrags"><Input value={f.titel} onChange={s('titel')} placeholder="z. B. Betrieb Terminplattform" /></Field>
          <Field label="Was soll der Lieferant leisten?" full hint="In Stichworten genügt – die KI formuliert daraus die Klausel «Vertragsgegenstand»."><textarea className="llv-input vm-textarea" rows="4" value={f.beschreibung} onChange={s('beschreibung')} placeholder="z. B. Bereitstellung einer Online-Terminbuchung für das Impfzentrum inkl. SMS-Erinnerung, Betrieb in CH, Support werktags"></textarea></Field>
        </div>}
        {step === 2 && <div className="vm-stack">
          <div className="vm-grid3">
            <Field label="Vertragsbeginn"><Input type="date" value={f.beginn} onChange={s('beginn')} /></Field>
            <Field label="Feste Laufzeit (Monate)" hint="Standard: max. 36"><Input type="number" value={f.laufzeit} onChange={s('laufzeit')} /></Field>
            <Field label="Kündigungsfrist (Monate)" hint="Standard: max. 6"><Input type="number" value={f.kuendigungsfrist} onChange={s('kuendigungsfrist')} /></Field>
            {f.typ !== 'NDA' && f.typ !== 'AVV' && <><Field label="Vergütungsmodell"><Select value={f.modell} onChange={s('modell')} options={['Pauschal', 'Aufwand']} /></Field>
            <Field label={f.modell === 'Aufwand' ? 'Kostendach (CHF)' : 'Betrag pro Jahr (CHF)'}><Input type="number" value={f.betrag} onChange={s('betrag')} /></Field></>}
          </div>
          {hasSLA(f.typ) && <><h3 style={{ margin: '10px 0 0' }}>Service Level</h3><div className="vm-grid3">
            <Field label="Verfügbarkeit pro Monat (%)" hint="Standard: ≥ 99.5"><Input type="number" step="0.1" value={f.verfuegbarkeit} onChange={s('verfuegbarkeit')} /></Field>
            {f.typ === 'Wartung/Support (SLA)' && <Field label="Reaktionszeit P1 (Stunden)" hint="Standard: ≤ 1"><Input type="number" value={f.p1} onChange={s('p1')} /></Field>}
          </div></>}
          {f.typ === 'Beratung/Dienstleistung' && <><h3 style={{ margin: '10px 0 0' }}>Stundensätze</h3><div className="vm-grid3">
            <Field label="Senior (CHF/h)" hint="LLV-Ansatz: max. 180"><Input type="number" value={f.senior} onChange={s('senior')} /></Field>
            <Field label="Junior (CHF/h)" hint="LLV-Ansatz: max. 130"><Input type="number" value={f.junior} onChange={s('junior')} /></Field>
          </div><div className="vm-small vm-muted"><i className="fas fa-circle-info"></i> Beratungsverträge enthalten keine SLA-Bausteine; stattdessen Stundensätze, Schlüsselpersonen und Abnahme.</div></>}
          {f.typ === 'NDA' && <div className="vm-grid3"><Field label="Konventionalstrafe (CHF)" hint="Standard: 20'000"><Input type="number" value={f.strafe} onChange={s('strafe')} /></Field></div>}
        </div>}
        {step === 3 && <div className="vm-grid2">
          <div><h3>Angaben</h3><dl className="vm-dl"><dt>Vertragsart</dt><dd>{f.typ}</dd><dt>Lieferant</dt><dd>{lname}</dd><dt>Stelle</dt><dd>{f.amt}</dd><dt>Bezeichnung</dt><dd>{f.titel}</dd><dt>Beginn / Laufzeit</dt><dd>{fd(f.beginn)} · {f.laufzeit} Monate</dd><dt>Kündigungsfrist</dt><dd>{f.kuendigungsfrist} Monate</dd>{f.betrag && <><dt>Vergütung</dt><dd>{chf(f.betrag)} ({f.modell})</dd></>}</dl></div>
          <div><h3>Diese Bausteine werden verwendet</h3><ol className="vm-ol"><li>Vertragsgegenstand <Tag c="blue">KI</Tag></li>{D.STANDARD_KLAUSELN[f.typ].map(k => { const r = fillText(k, f); return <li key={k}>{D.KLAUSELN[k].titel}{r.abw && <span className="vm-abw"><i className="fas fa-triangle-exclamation"></i>{r.abw}</span>}</li>; })}</ol>
            <div className="vm-small vm-muted">Quelle: Prüfstandard {f.typ}.docx, Version {D.STANDARD_META[f.typ].version} ({fd(D.STANDARD_META[f.typ].geaendert)})</div></div>
        </div>}
        <div className="vm-row" style={{ justifyContent: 'space-between', marginTop: 25 }}>
          <Btn kind="secondary" onClick={() => step ? setStep(step - 1) : go('home')}>{step ? 'Zurück' : 'Abbrechen'}</Btn>
          {step < 3 ? <Btn disabled={!ok} onClick={() => setStep(step + 1)}>Weiter</Btn> : <Btn icon="fas fa-wand-magic-sparkles" onClick={create}>Entwurf erstellen</Btn>}
        </div>
      </Card>
    </div>
  </>;
}

function AutoTA({ value, onChange, readOnly }) {
  const r = useRef();
  useEffect(() => { if (r.current) { r.current.style.height = 'auto'; r.current.style.height = r.current.scrollHeight + 'px'; } }, [value]);
  return <textarea ref={r} className="vm-clause__ta" value={value} readOnly={readOnly} onChange={onChange} rows="1"></textarea>;
}

function EntwurfEditor({ id }) {
  const { state, setState, go, toast, runAI } = useApp();
  const e = state.entwuerfe.find(x => x.id === id);
  const [lib, setLib] = useState(false);
  if (!e) return null;
  const pr = state.pruefungen.find(p => p.entwurfId === id);
  const ro = e.status !== 'Entwurf';
  const upd = (fn) => setState(s => ({ ...s, entwuerfe: s.entwuerfe.map(x => x.id === id ? fn(x) : x) }));
  const setK = (i, patch) => upd(x => ({ ...x, klauseln: x.klauseln.map((k, j) => j === i ? { ...k, ...patch } : k) }));
  const move = (i, d) => upd(x => { const a = [...x.klauseln]; const [m] = a.splice(i, 1); a.splice(i + d, 0, m); return { ...x, klauseln: a }; });
  const umformulieren = async (i) => {
    const k = e.klauseln[i];
    const t = await runAI({ title: 'Klausel wird umformuliert', sub: k.titel, minMs: 3800, preview: k.text, steps: ['Klausel und Kontext lesen', 'Präziser und verständlicher formulieren', 'Mit Prüfstandard abgleichen'],
      task: () => askClaude('Formuliere folgende Vertragsklausel «' + k.titel + '» präziser und verständlicher, ohne den rechtlichen Gehalt zu ändern. Schweizer Hochdeutsch (ss statt ß). Nur den neuen Klauseltext ausgeben.\n\n' + k.text, 'Du bist Vertragsjurist der Liechtensteinischen Landesverwaltung.', 600), fallback: () => k.text });
    setK(i, { text: t.trim(), quelle: k.quelle === 'Abweichung' ? 'Abweichung' : 'KI' });
  };
  const senden = () => {
    const pid = uid('P');
    setState(s => ({ ...s, entwuerfe: s.entwuerfe.map(x => x.id === id ? { ...x, status: 'In Prüfung' } : x), pruefungen: [{ id: pid, entwurfId: id, lieferantId: e.lieferantId, lieferant: e.lieferant, typ: e.typ, titel: e.titel, eingang: iso(TODAY), frist: iso(new Date(TODAY.getTime() + 7 * 86400000)), von: 'Beschaffung, D. Meier', quelle: 'LLV-Entwurf', status: 'In Prüfung', felder: e.felder, klauseln: e.klauseln.map((k, i) => ({ titel: '§ ' + (i + 1) + ' ' + k.titel, text: k.text, key: k.id, geaendert: k.quelle !== 'Textbaustein' })) }, ...s.pruefungen.filter(p => p.entwurfId !== id)] }));
    toast({ title: 'An den Rechtsdienst gesendet', text: 'Der Rechtsdienst wurde per E-Mail informiert. Prüffrist: 7 Tage.', icon: 'fas fa-paper-plane' });
  };
  const abwN = e.klauseln.filter(k => k.abw).length, manN = e.klauseln.filter(k => k.quelle === 'Manuell').length;
  const included = new Set(e.klauseln.map(k => k.id));
  const QTAG = { Textbaustein: ['grey', 'Textbaustein v' + e.standardVersion], KI: ['blue', 'KI-formuliert'], Manuell: ['yellow', 'Manuell geändert'], Abweichung: ['red', 'Abweichung'] };
  const ergebnis = pr && pr.ergebnis;
  return <>
    <PageHead crumbs={[{ l: 'Entwürfe', to: 'entwuerfe' }, { l: e.titel }]} title={e.titel} sub={<span className="vm-row" style={{ gap: 10 }}><Tag c={STATUS_TAG[e.status]}>{e.status}</Tag><span>{e.typ} · {e.lieferant}</span></span>}
      actions={<>
        <Btn kind="secondary" icon="far fa-file-word" onClick={() => toast({ title: 'Word-Dokument erstellt', text: 'SharePoint › Beschaffung › Entwürfe › ' + e.titel.replace(/\W+/g, '_') + '.docx', icon: 'far fa-file-word' })}>Als Word speichern</Btn>
        {e.status === 'Entwurf' && <Btn icon="fas fa-paper-plane" onClick={senden}>Zur rechtlichen Prüfung senden</Btn>}
        {e.status === 'Nachverhandlung' && <Btn icon="fas fa-pen" onClick={() => upd(x => ({ ...x, status: 'Entwurf' }))}>Überarbeiten</Btn>}
      </>} />
    <div className="llv-content">
      <div className="vm-editor">
        <div className="vm-paper">
          <div className="vm-paper__head"><div className="vm-small vm-muted">{e.typ.toUpperCase()}</div><h2 style={{ fontSize: 20, color: 'var(--color-gray-900)' }}>{e.titel}</h2><p>zwischen der <b>Liechtensteinischen Landesverwaltung</b>, {e.amt}, Vaduz<br />und <b>{e.lieferant}</b></p></div>
          {e.klauseln.map((k, i) => { const fb = ergebnis && ergebnis.find(r => r.key === k.id); return <div key={k.id + i} className={'vm-clause' + (k.abw ? ' is-abw' : '')}>
            <div className="vm-clause__h"><b>§ {i + 1} {k.titel}</b><Tag c={QTAG[k.quelle][0]}>{QTAG[k.quelle][1]}</Tag>
              {!ro && <span className="vm-clause__tools"><button className="llv-btn llv-btn--icon" title="Mit KI umformulieren" onClick={() => umformulieren(i)}><i className="fas fa-wand-magic-sparkles"></i></button>{k.original && k.text !== k.original && <button className="llv-btn llv-btn--icon" title="Textbaustein wiederherstellen" onClick={() => setK(i, { text: k.original, quelle: k.abw ? 'Abweichung' : 'Textbaustein' })}><i className="fas fa-rotate-left"></i></button>}<button className="llv-btn llv-btn--icon" disabled={i === 0} onClick={() => move(i, -1)}><i className="fas fa-arrow-up"></i></button><button className="llv-btn llv-btn--icon" disabled={i === e.klauseln.length - 1} onClick={() => move(i, 1)}><i className="fas fa-arrow-down"></i></button><button className="llv-btn llv-btn--icon" title="Entfernen" onClick={() => upd(x => ({ ...x, klauseln: x.klauseln.filter((_, j) => j !== i) }))}><i className="far fa-trash-can"></i></button></span>}
            </div>
            <AutoTA value={k.text} readOnly={ro} onChange={ev => setK(i, { text: ev.target.value, quelle: k.quelle === 'Abweichung' ? 'Abweichung' : k.id === 'gegenstand' ? 'KI' : 'Manuell' })} />
            {k.abw && <div className="vm-abw"><i className="fas fa-triangle-exclamation"></i>{k.abw}</div>}
            {fb && <div className={'vm-feedback vm-feedback--' + fb.ampel}><Ampel v={fb.ampel} /><span>{fb.kommentar || fb.begruendung}</span></div>}
          </div>; })}
          {!ro && <div className="vm-row" style={{ justifyContent: 'center', marginTop: 10 }}><Btn kind="secondary" icon="fas fa-plus" onClick={() => setLib(true)}>Baustein einfügen</Btn></div>}
        </div>
        <aside className="vm-stack vm-editor__side">
          <Card title="Vorprüfung">
            <div className="vm-stack" style={{ gap: 8 }}>
              <div className="vm-row"><Ampel v={abwN ? 'rot' : 'gruen'} label={false} /><span>{abwN ? abwN + ' Abweichung(en) vom Standard' : 'Keine Abweichungen vom Standard'}</span></div>
              <div className="vm-row"><Ampel v={manN ? 'gelb' : 'gruen'} label={false} /><span>{manN ? manN + ' manuell geänderte Klausel(n)' : 'Keine manuellen Änderungen'}</span></div>
              <div className="vm-small vm-muted">Der Rechtsdienst prüft geänderte Klauseln und Abweichungen. Unveränderte Textbausteine gelten als vorgeprüft.</div>
            </div>
          </Card>
          {pr && <Card title="Rechtliche Prüfung"><div className="vm-stack" style={{ gap: 8 }}><div className="vm-row"><Tag c={STATUS_TAG[pr.status]}>{pr.status}</Tag><span className="vm-small vm-muted">{pr.entscheidDatum ? 'Entscheid ' + fd(pr.entscheidDatum) : 'Frist ' + fd(pr.frist)}</span></div>{pr.entscheidText && <p style={{ margin: 0 }}>{pr.entscheidText}</p>}</div></Card>}
          <Card title="Angaben"><dl className="vm-dl"><dt>Beginn</dt><dd>{fd(e.felder.beginn)}</dd><dt>Laufzeit</dt><dd>{e.felder.laufzeit} Monate</dd><dt>Kündigungsfrist</dt><dd>{e.felder.kuendigungsfrist} Monate</dd><dt>Vergütung</dt><dd>{chf(e.felder.betrag)}</dd><dt>Standard</dt><dd>v{e.standardVersion}</dd></dl></Card>
        </aside>
      </div>
    </div>
    {lib && <Dialog title="Baustein einfügen" onClose={() => setLib(false)} width={720}>
      <div className="vm-small vm-muted" style={{ marginBottom: 10 }}>Aus allen Prüfstandards. Bereits enthaltene Bausteine sind ausgegraut.</div>
      <div className="vm-libgrid">{Object.entries(D.KLAUSELN).map(([k, c]) => <button key={k} disabled={included.has(k)} className="vm-libitem" onClick={() => { const r = fillText(k, { ...e.felder }); upd(x => ({ ...x, klauseln: [...x.klauseln, { id: k, titel: c.titel, text: r.text, original: r.text, quelle: 'Textbaustein', abw: null }] })); setLib(false); }}><b>{c.titel}</b><span>{c.muster.slice(0, 110)} …</span></button>)}</div>
    </Dialog>}
  </>;
}

Object.assign(window, { BHome, Entwuerfe, EntwurfNeu, EntwurfEditor, STATUS_TAG, TYP_ICON });
