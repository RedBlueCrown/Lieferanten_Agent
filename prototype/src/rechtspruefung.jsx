// ---------- Modul 3: Rechtliche Prüfung ----------
const AMPEL_TXT = { gruen: 'Akzeptabel', gelb: 'Verhandeln', rot: 'Nicht akzeptabel' };

function JHome() {
  const { state, go } = useApp();
  const [up, setUp] = useState(false);
  const offen = state.pruefungen.filter(p => p.status === 'In Prüfung').sort((a, b) => a.frist.localeCompare(b.frist));
  const erledigt = state.pruefungen.filter(p => p.status !== 'In Prüfung');
  return <>
    <PageHead title="Guten Tag, Daniel Meier" sub={'Rechtsdienst · ' + fd(TODAY)} actions={<Btn icon="fas fa-file-arrow-up" onClick={() => setUp(true)}>Vertrag zur Prüfung hochladen</Btn>} />
    <div className="llv-content vm-stack">
      <Card title={'Prüfungen offen (' + offen.length + ')'} pad={false}><PruefTabelle rows={offen} /></Card>
      {erledigt.length > 0 && <Card title="Zuletzt entschieden" pad={false}><PruefTabelle rows={erledigt} /></Card>}
      <Card title="Prüfstandards" actions={<a onClick={() => go('standards')}>Alle anzeigen</a>}>
        <div className="vm-doclist">{D.VERTRAGSARTEN.slice(0, 4).map(t => <a key={t} className="vm-docrow" onClick={() => go('standards', { typ: t })}><i className="fas fa-file-word"></i><span><b>Prüfstandard {t}.docx</b><small>v{D.STANDARD_META[t].version} · {fd(D.STANDARD_META[t].geaendert)} · {D.STANDARD_META[t].von}</small></span></a>)}</div>
      </Card>
    </div>
    {up && <UploadPruefung onClose={() => setUp(false)} />}
  </>;
}

function PruefTabelle({ rows }) {
  const { go } = useApp();
  if (!rows.length) return <div className="vm-empty"><i className="fas fa-circle-check"></i>Keine offenen Prüfungen.</div>;
  return <table className="llv-table vm-table"><thead><tr><th>Vertrag</th><th>Art</th><th>Quelle</th><th>Eingereicht von</th><th>Frist</th><th>Status</th></tr></thead><tbody>
    {rows.map(p => { const t = days(pd(p.frist)); return <tr key={p.id} className="vm-click" onClick={() => go('pruefung', { id: p.id })}>
      <td><b>{p.titel}</b><div className="vm-small vm-muted">{p.lieferant}</div></td><td>{p.typ}</td>
      <td>{p.quelle === 'LLV-Entwurf' ? <Tag c="blue">LLV-Entwurf</Tag> : <Tag c="grey">Lieferantenpapier</Tag>}</td>
      <td className="vm-small">{p.von}</td>
      <td className="vm-nowrap">{p.status === 'In Prüfung' ? <><b style={{ color: t <= 3 ? 'var(--color-red-500)' : null }}>{fd(p.frist)}</b><div className="vm-small vm-muted">{relDays(t)}</div></> : <span className="vm-muted">–</span>}</td>
      <td><Tag c={STATUS_TAG[p.status]}>{p.status}</Tag></td>
    </tr>; })}
  </tbody></table>;
}

function UploadPruefung({ onClose }) {
  const { state, setState, go, runAI } = useApp();
  const [typ, setTyp] = useState('SaaS-Vertrag'); const [lid, setLid] = useState(state.lieferanten[0].id); const [text, setText] = useState(''); const [file, setFile] = useState(null);
  const start = async () => {
    const l = state.lieferanten.find(x => x.id === lid);
    let raw = text;
    const kl = await runAI({ title: 'Vertrag wird gelesen', sub: file ? file.name : 'Eingefügter Text', minMs: 4500, preview: raw, steps: ['In SharePoint ablegen', 'Text erkennen', 'Klauseln gliedern'],
      task: async () => { if (!raw && file) raw = await pdfToText(file); const t = await askClaude('Gliedere den folgenden Vertrag in seine Klauseln. Ausgabe als JSON-Array [{"titel": "Nummer und Überschrift", "text": "wörtlicher Klauseltext"}]. Nur JSON.\n\n' + raw.slice(0, 14000), 'Du strukturierst Verträge.', 4000); return parseJSON(t); },
      fallback: () => (raw || '').split(/\n(?=\s*(?:§\s*\d+|\d+\.))/).filter(x => x.trim()).map(x => { const [h, ...r] = x.trim().split(/:\s|\n/); return { titel: h.slice(0, 60), text: r.join(' ') || h }; }) });
    const id = uid('P');
    setState(s => ({ ...s, pruefungen: [{ id, lieferantId: lid, lieferant: l.name, typ, titel: (file ? file.name.replace(/\.pdf$/i, '') : typ + ' ' + l.name), eingang: iso(TODAY), frist: iso(new Date(TODAY.getTime() + 7 * 86400000)), von: 'Rechtsdienst, D. Meier', quelle: 'Lieferantenpapier', status: 'In Prüfung', klauseln: kl }, ...s.pruefungen] }));
    onClose(); go('pruefung', { id, auto: 1 });
  };
  return <Dialog title="Vertrag zur Prüfung hochladen" onClose={onClose} width={640} footer={<><Btn kind="secondary" onClick={onClose}>Abbrechen</Btn><Btn icon="fas fa-wand-magic-sparkles" disabled={!text && !file} onClick={start}>Einlesen und prüfen</Btn></>}>
    <div className="vm-grid2">
      <Field label="Vertragsart (bestimmt den Prüfstandard)"><Select value={typ} onChange={e => setTyp(e.target.value)} options={D.VERTRAGSARTEN} /></Field>
      <Field label="Lieferant"><Select value={lid} onChange={e => setLid(e.target.value)} options={state.lieferanten.map(l => ({ v: l.id, l: l.name }))} /></Field>
      <Field label="PDF" full><input type="file" accept="application/pdf" onChange={e => setFile(e.target.files[0])} /></Field>
      <Field label="oder Vertragstext einfügen" full><textarea className="llv-input vm-textarea" rows="6" value={text} onChange={e => setText(e.target.value)} placeholder="§ 1 Gegenstand: …"></textarea></Field>
    </div>
  </Dialog>;
}

function fallbackReview(p) {
  if (D.FALLBACK_REVIEW[p.id]) return D.FALLBACK_REVIEW[p.id];
  return D.STANDARD_KLAUSELN[p.typ].map(k => {
    const c = p.klauseln.find(x => x.key === k) || p.klauseln.find(x => x.titel.toLowerCase().includes(D.KLAUSELN[k].titel.split(' ')[0].toLowerCase()));
    if (!c) return { klausel: k, fundstelle: '–', ampel: 'rot', begruendung: 'Klausel fehlt im Vertrag.', vorschlag: D.KLAUSELN[k].muster };
    if (c.geaendert === false || (c.key && c.text === D.KLAUSELN[k].muster)) return { klausel: k, fundstelle: c.titel, ampel: 'gruen', begruendung: 'Entspricht dem Textbaustein des Standards.', vorschlag: '' };
    return { klausel: k, fundstelle: c.titel, ampel: 'gelb', begruendung: 'Vom Textbaustein abweichend formuliert – Abweichung prüfen.', vorschlag: D.KLAUSELN[k].muster };
  });
}

function PruefungDetail({ id, auto }) {
  const { state, setState, go, runAI, toast } = useApp();
  const p = state.pruefungen.find(x => x.id === id);
  const [hl, setHl] = useState(null);
  const [dlg, setDlg] = useState(null);
  const started = useRef(false);
  const meta = p && D.STANDARD_META[p.typ];
  const upd = (fn) => setState(s => ({ ...s, pruefungen: s.pruefungen.map(x => x.id === id ? fn(x) : x) }));
  const run = async () => {
    const rules = D.STANDARD_KLAUSELN[p.typ].map(k => { const c = D.KLAUSELN[k]; return 'ID ' + k + ' – ' + c.titel + '\n  Akzeptabel: ' + c.ok + '\n  Verhandelbar: ' + c.verh + '\n  Nicht akzeptabel: ' + c.nicht; }).join('\n');
    const vertrag = p.klauseln.map(k => k.titel + ': ' + k.text).join('\n');
    const res = await runAI({ title: 'Vertrag wird rechtlich geprüft', sub: p.titel, minMs: 7000, preview: p.klauseln.map(k => k.titel + ': ' + k.text).join(' '),
      steps: ['Prüfstandard «' + p.typ + '» v' + meta.version + ' laden', 'Klauseln des Vertrags zuordnen', 'Jede Klausel gegen den Standard bewerten', 'Fehlende Klauseln erkennen', 'Begründungen und Gegenvorschläge formulieren'],
      task: async () => {
        const t = await askClaude('PRÜFSTANDARD (' + p.typ + '):\n' + rules + '\n\nVERTRAG:\n' + vertrag + '\n\nBewerte für JEDE ID des Prüfstandards die passende Vertragsklausel. Ausgabe als JSON-Array mit Objekten {"klausel": ID, "fundstelle": Titel der Vertragsklausel oder "–" wenn fehlend, "ampel": "gruen"|"gelb"|"rot", "begruendung": 1–2 Sätze mit konkretem Bezug zum Standard, "vorschlag": Gegenvorschlag als Vertragstext (leer bei gruen)}. Fehlende Klausel = rot. Schweizer Hochdeutsch (ss statt ß). Nur JSON.', 'Du bist Jurist im Rechtsdienst der Liechtensteinischen Landesverwaltung und prüfst Verträge streng nach dem vorgegebenen Prüfstandard.', 4000);
        const arr = parseJSON(t); if (!Array.isArray(arr) || !arr.length) throw new Error('leer'); return arr;
      }, fallback: () => fallbackReview(p) });
    upd(x => ({ ...x, ergebnis: res.map(r => ({ ...r, key: r.klausel, kiAmpel: r.ampel, kommentar: '' })), standardVersion: meta.version, geprueftAm: iso(TODAY) }));
  };
  useEffect(() => { if (p && !p.ergebnis && p.status === 'In Prüfung' && auto && !started.current) { started.current = true; run(); } }, [id]);
  if (!p) return null;
  const erg = p.ergebnis || [];
  const setR = (i, patch) => upd(x => ({ ...x, ergebnis: x.ergebnis.map((r, j) => j === i ? { ...r, ...patch } : r) }));
  const cnt = { gruen: 0, gelb: 0, rot: 0 }; erg.forEach(r => cnt[r.ampel] = (cnt[r.ampel] || 0) + 1);
  const ro = p.status !== 'In Prüfung';
  const entscheid = (status, text) => {
    setState(s => ({ ...s, pruefungen: s.pruefungen.map(x => x.id === id ? { ...x, status, entscheidDatum: iso(TODAY), entscheidText: text } : x), entwuerfe: s.entwuerfe.map(e => e.id === p.entwurfId ? { ...e, status } : e) }));
    setDlg(null);
    toast(status === 'Freigegeben' ? { title: 'Vertrag freigegeben', text: 'Beschaffung und Lieferantenmanagement wurden per E-Mail informiert.' } : { kind: 'warn', icon: 'fas fa-rotate-left', title: 'Zur Nachverhandlung zurückgegeben', text: 'Die Verhandlungspunkte wurden der Beschaffung übermittelt.' });
  };
  const punkte = erg.filter(r => r.ampel !== 'gruen');
  return <>
    <PageHead crumbs={[{ l: 'Prüfungen', to: 'pruefungen' }, { l: p.titel }]} title={p.titel} sub={<span className="vm-row" style={{ gap: 10 }}><Tag c={STATUS_TAG[p.status]}>{p.status}</Tag><span>{p.typ} · {p.lieferant} · {p.quelle}</span><span className="vm-muted">Frist {fd(p.frist)}</span></span>}
      actions={!ro && erg.length > 0 && <><Btn kind="secondary" icon="fas fa-rotate-left" onClick={() => setDlg('nach')}>Nachverhandlung</Btn><Btn icon="fas fa-check" onClick={() => setDlg('frei')}>Freigeben</Btn></>} />
    <div className="llv-content vm-stack">
      {!erg.length && <Card><div className="vm-start"><div className="vm-ai__orb vm-ai__orb--static"><i className="fas fa-scale-balanced"></i></div><div><h2>Bereit zur Prüfung</h2><p className="vm-muted" style={{ margin: 0 }}>{p.klauseln.length} Klauseln werden gegen den <b>Prüfstandard {p.typ} v{meta.version}</b> ({D.STANDARD_KLAUSELN[p.typ].length} Kriterien) geprüft.</p></div><Btn icon="fas fa-wand-magic-sparkles" onClick={run}>KI-Prüfung starten</Btn></div></Card>}
      {erg.length > 0 && <div className="vm-summary">
        <div className="vm-summary__c"><Ampel v="gruen" label={false} /><b>{cnt.gruen}</b><span>Akzeptabel</span></div>
        <div className="vm-summary__c"><Ampel v="gelb" label={false} /><b>{cnt.gelb}</b><span>Verhandeln</span></div>
        <div className="vm-summary__c"><Ampel v="rot" label={false} /><b>{cnt.rot}</b><span>Nicht akzeptabel</span></div>
        <div className="vm-summary__meta"><i className="fas fa-file-word"></i> Geprüft gegen Prüfstandard {p.typ} v{p.standardVersion}<br /><span className="vm-muted">KI-Vorschlag – Ihre Anpassungen sind massgebend.</span>{!ro && <><br /><a onClick={run}><i className="fas fa-rotate"></i> Erneut prüfen</a></>}</div>
      </div>}
      {erg.length > 0 && <div className="vm-review">
        <div className="vm-paper vm-paper--src">
          <div className="vm-small vm-muted" style={{ marginBottom: 10 }}>VERTRAGSTEXT</div>
          {p.klauseln.map((k, i) => { const r = erg.find(x => x.fundstelle === k.titel); return <div key={i} className={'vm-srcclause' + (hl === k.titel ? ' is-hl' : '')} onMouseEnter={() => setHl(k.titel)} onMouseLeave={() => setHl(null)}>
            <div className="vm-row" style={{ gap: 8 }}>{r && <Ampel v={r.ampel} label={false} />}<b>{k.titel}</b></div><p>{k.text}</p></div>; })}
        </div>
        <div className="vm-stack" style={{ gap: 10 }}>
          {erg.map((r, i) => { const c = D.KLAUSELN[r.klausel] || { titel: r.klausel }; return <div key={i} className={'vm-finding vm-finding--' + r.ampel + (hl && hl === r.fundstelle ? ' is-hl' : '')} onMouseEnter={() => setHl(r.fundstelle)} onMouseLeave={() => setHl(null)}>
            <div className="vm-finding__h"><b>{c.titel}</b><span className="vm-small vm-muted">{r.fundstelle}</span>
              <span className="vm-seg">{['gruen', 'gelb', 'rot'].map(a => <button key={a} disabled={ro} className={r.ampel === a ? 'is-on is-' + a : ''} onClick={() => setR(i, { ampel: a })} title={AMPEL_TXT[a]}><span className="vm-ampel__dot"></span>{AMPEL_TXT[a]}</button>)}</span>
            </div>
            <p>{r.begruendung}{r.kiAmpel && r.kiAmpel !== r.ampel && <span className="vm-small vm-muted"> (KI: {AMPEL_TXT[r.kiAmpel]}, durch Jurist angepasst)</span>}</p>
            {r.vorschlag && r.ampel !== 'gruen' && <div className="vm-vorschlag"><div className="vm-small vm-muted"><i className="fas fa-pen-nib"></i> Gegenvorschlag</div><div>{r.vorschlag}</div></div>}
            {(!ro || r.kommentar) && <Input disabled={ro} value={r.kommentar} placeholder="Kommentar für die Beschaffung (optional)" onChange={e => setR(i, { kommentar: e.target.value })} />}
          </div>; })}
        </div>
      </div>}
    </div>
    {dlg && <Dialog title={dlg === 'frei' ? 'Vertrag freigeben' : 'Zur Nachverhandlung zurückgeben'} onClose={() => setDlg(null)} width={620}
      footer={<><Btn kind="secondary" onClick={() => setDlg(null)}>Abbrechen</Btn>{dlg === 'frei' ? <Btn onClick={() => entscheid('Freigegeben', cnt.rot || cnt.gelb ? 'Freigegeben trotz ' + (cnt.rot + cnt.gelb) + ' Abweichung(en) gemäss Kommentar.' : 'Entspricht dem Prüfstandard.')}>Freigeben</Btn> : <Btn onClick={() => entscheid('Nachverhandlung', punkte.length + ' Verhandlungspunkte übermittelt.')}>Zurückgeben</Btn>}</>}>
      {dlg === 'frei' ? <>{cnt.rot > 0 && <div className="llv-notif llv-notif--warn" style={{ marginBottom: 15 }}><div className="llv-notif__icon"><i className="fas fa-triangle-exclamation"></i></div><div className="llv-notif__body">Es sind noch {cnt.rot} Punkte als «Nicht akzeptabel» bewertet. Möchten Sie den Vertrag dennoch freigeben?</div></div>}<p>Nach der Freigabe kann das Lieferantenmanagement den Vertrag in die Vertragsübersicht übernehmen.</p></>
        : <><p>Folgende Verhandlungspunkte werden der Beschaffung übermittelt:</p><ol className="vm-ol">{punkte.map((r, i) => <li key={i}><Ampel v={r.ampel} label={false} /> <b>{(D.KLAUSELN[r.klausel] || {}).titel}</b> – {r.kommentar || r.begruendung}</li>)}</ol></>}
    </Dialog>}
  </>;
}

function Pruefungen() {
  const { state } = useApp();
  const [f, setF] = useState('offen');
  const rows = state.pruefungen.filter(p => f === 'alle' || (f === 'offen' ? p.status === 'In Prüfung' : p.status !== 'In Prüfung'));
  return <><PageHead title="Prüfungen" /><div className="llv-content vm-stack">
    <div className="vm-chips">{[['offen', 'Offen'], ['erledigt', 'Entschieden'], ['alle', 'Alle']].map(([k, l]) => <button key={k} className={'vm-chip' + (f === k ? ' is-on' : '')} onClick={() => setF(k)}>{l}</button>)}</div>
    <Card pad={false}><PruefTabelle rows={rows} /></Card></div></>;
}

// ---------- Prüfstandards / Textbausteine (Word-Dokumente in SharePoint) ----------
function StandardDocs({ typ: typ0, mode = 'standard' }) {
  const { toast, rolle } = useApp();
  const [typ, setTyp] = useState(typ0 || 'SaaS-Vertrag');
  const meta = D.STANDARD_META[typ];
  const isB = mode === 'bausteine';
  return <>
    <PageHead title={isB ? 'Textbausteine' : 'Prüfstandards'} sub={isB ? 'Die Musterformulierungen aus den Prüfstandards des Rechtsdienstes – je Vertragsart ein Word-Dokument.' : 'Ein Word-Dokument je Vertragsart in SharePoint. Die App liest jeweils die aktuelle Version.'} />
    <div className="llv-content">
      <div className="vm-stdlayout">
        <div className="vm-stack" style={{ gap: 15 }}>
          <Card pad={false}><div className="vm-doclist" style={{ padding: 10 }}>{D.VERTRAGSARTEN.map(t => <a key={t} className={'vm-docrow' + (t === typ ? ' is-on' : '')} onClick={() => setTyp(t)}><i className="fas fa-file-word"></i><span><b>{t}</b><small>v{D.STANDARD_META[t].version} · {fd(D.STANDARD_META[t].geaendert)}</small></span></a>)}</div></Card>
          {!isB && <Card title="So pflegen Sie den Standard"><ol className="vm-ol vm-small">
            <li>Dokument in Word öffnen und wie gewohnt bearbeiten (Änderungen nachverfolgen möglich).</li>
            <li>Je Klausel eine <b>Überschrift 1</b>, darunter die Absätze <b>Akzeptabel</b>, <b>Verhandelbar</b>, <b>Nicht akzeptabel</b> und <b>Musterformulierung</b>.</li>
            <li>Speichern – SharePoint erstellt eine neue Version. Neue Prüfungen und Entwürfe verwenden sie sofort.</li>
          </ol><div style={{ marginTop: 10 }}><a onClick={() => toast({ title: 'Vorlage heruntergeladen', text: 'Vorlage_Pruefstandard.dotx', icon: 'far fa-file-word' })}><i className="fas fa-download"></i> Vorlage für neue Vertragsart</a></div></Card>}
        </div>
        <div className="vm-stack" style={{ gap: 15 }}>
          <div className="vm-docbar"><SPPath path={'Rechtsdienst/Prüfstandards/Prüfstandard ' + typ.replace('/', '-') + '.docx'} /><span className="vm-row">
            <span className="vm-small vm-muted">Version {meta.version} · geändert {fd(meta.geaendert)} von {meta.von}</span>
            {rolle === 'Jurist' && !isB ? <Btn icon="far fa-file-word" onClick={() => toast({ title: 'Word wird geöffnet', text: 'Prüfstandard ' + typ + '.docx – Bearbeitung in Word für das Web', icon: 'far fa-file-word' })}>In Word bearbeiten</Btn> : <Btn kind="secondary" icon="far fa-comment" onClick={() => toast({ title: 'Änderungswunsch gesendet', text: 'Der Rechtsdienst wurde per E-Mail informiert.', icon: 'far fa-envelope' })}>Änderung beantragen</Btn>}
          </span></div>
          <div className="vm-word">
            <div className="vm-word__title">Prüfstandard {typ}</div>
            <div className="vm-word__meta">Liechtensteinische Landesverwaltung · Rechtsdienst · Version {meta.version}</div>
            {D.STANDARD_KLAUSELN[typ].map((k, i) => { const c = D.KLAUSELN[k]; return <div key={k} className="vm-word__sec">
              <h3 className="vm-word__h1">{i + 1}. {c.titel}</h3>
              {!isB && <><div className="vm-word__p"><span className="vm-word__lbl vm-word__lbl--g">Akzeptabel</span>{c.ok}</div>
                <div className="vm-word__p"><span className="vm-word__lbl vm-word__lbl--y">Verhandelbar</span>{c.verh}</div>
                <div className="vm-word__p"><span className="vm-word__lbl vm-word__lbl--r">Nicht akzeptabel</span>{c.nicht}</div></>}
              <div className="vm-word__p vm-word__muster"><span className="vm-word__lbl">Musterformulierung</span>{c.muster}</div>
            </div>; })}
          </div>
        </div>
      </div>
    </div>
  </>;
}

Object.assign(window, { JHome, Pruefungen, PruefungDetail, StandardDocs });
