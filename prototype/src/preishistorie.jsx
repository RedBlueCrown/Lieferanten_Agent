// ---------- Preis- und Volumenentwicklung je Lieferant ----------
const PH_NOTES = ['Neuverhandlung Rahmenvertrag', 'Teuerungsausgleich begrenzt', 'Mengenrabatt vereinbart', 'Mehrjahresbindung gegen Rabatt', 'Lizenzmodell umgestellt', ''];
function defaultHistorie(l) {
  const total = l.vertraege.reduce((s, v) => s + (v.wert || 0), 0);
  if (!total) return [];
  const h = [...l.id].reduce((s, c) => s + c.charCodeAt(0), 0);
  const g = 0.02 + (h % 5) * 0.012, rate = 140 + (h % 6) * 10;
  return [2021, 2022, 2023, 2024, 2025, 2026].map((y, i) => {
    const verh = Math.round(total / Math.pow(1 + g, 2026 - y) / 100) * 100;
    const rab = 0.02 + ((h + y) % 4) * 0.025;
    return { jahr: y, angebot: Math.round(verh * (1 + rab) / 100) * 100, verhandelt: verh, stundensatz: Math.round(rate * Math.pow(1.018, i)), bemerkung: (h + y) % 3 === 0 ? PH_NOTES[(h + y) % PH_NOTES.length] : '' };
  });
}
const pct = (a, b) => b ? ((a - b) / b) * 100 : null;
const fp = (p, d = 1) => p == null ? '–' : (p > 0 ? '+' : p < 0 ? '−' : '±') + Math.abs(p).toFixed(d).replace('.', ',') + ' %';
const fa = (p, d = 1) => p == null ? '–' : Math.abs(p).toFixed(d).replace('.', ',') + ' %';
const kchf = n => n >= 1e6 ? (n / 1e6).toFixed(2).replace('.', ',') + ' Mio.' : Math.round(n / 1000) + "k";

function PHChart({ rows, metric }) {
  const W = 720, H = 230, P = { l: 56, r: 16, t: 22, b: 30 };
  const iw = W - P.l - P.r, ih = H - P.t - P.b;
  const vals = rows.map(r => metric === 'volumen' ? r.angebot : r.stundensatz);
  const lo = metric === 'volumen' ? 0 : Math.floor(Math.min(...vals) * 0.9 / 10) * 10;
  const hi = Math.max(...vals) * 1.08;
  const y = v => P.t + ih - ((v - lo) / (hi - lo)) * ih;
  const bw = iw / rows.length, x = i => P.l + bw * i + bw / 2;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(t => lo + (hi - lo) * t);
  return <svg viewBox={'0 0 ' + W + ' ' + H} style={{ width: '100%', height: 'auto', display: 'block' }} role="img" aria-label="Entwicklung">
    {ticks.map((t, i) => <g key={i}><line x1={P.l} x2={W - P.r} y1={y(t)} y2={y(t)} stroke="var(--color-gray-50)" /><text x={P.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--color-gray-300)">{metric === 'volumen' ? kchf(t) : Math.round(t)}</text></g>)}
    {metric === 'volumen' ? rows.map((r, i) => { const w = Math.min(46, bw * 0.55); return <g key={r.jahr}>
      <rect x={x(i) - w / 2} y={y(r.angebot)} width={w} height={y(r.verhandelt) - y(r.angebot)} fill="var(--color-green-50)" stroke="var(--color-green-500)" strokeDasharray="3 2" />
      <rect x={x(i) - w / 2} y={y(r.verhandelt)} width={w} height={y(0) - y(r.verhandelt)} fill="var(--color-primary-500)" />
      <text x={x(i)} y={y(r.angebot) - 6} textAnchor="middle" fontSize="11" fill="var(--color-gray-500)">{kchf(r.verhandelt)}</text>
      <text x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-gray-500)">{r.jahr}</text>
    </g>; }) : <>
      <polyline fill="none" stroke="var(--color-primary-500)" strokeWidth="2" points={rows.map((r, i) => x(i) + ',' + y(r.stundensatz)).join(' ')} />
      {rows.map((r, i) => <g key={r.jahr}><circle cx={x(i)} cy={y(r.stundensatz)} r="4" fill="#fff" stroke="var(--color-primary-500)" strokeWidth="2" /><text x={x(i)} y={y(r.stundensatz) - 10} textAnchor="middle" fontSize="11" fill="var(--color-gray-500)">{r.stundensatz}</text><text x={x(i)} y={H - 10} textAnchor="middle" fontSize="12" fill="var(--color-gray-500)">{r.jahr}</text></g>)}
    </>}
  </svg>;
}

function PreisHistorie({ l, upd, canEdit }) {
  const { toast } = useApp();
  const rows = [...(l.historie || defaultHistorie(l))].sort((a, b) => a.jahr - b.jahr);
  const [metric, setMetric] = useState('volumen');
  const [edit, setEdit] = useState(null);
  if (!rows.length && !canEdit) return <div className="vm-empty">Keine Preis- oder Volumendaten erfasst.</div>;
  const last = rows[rows.length - 1], prev = rows[rows.length - 2], first = rows[0];
  const spar = rows.reduce((s, r) => s + (r.angebot - r.verhandelt), 0);
  const cagr = rows.length > 1 ? (Math.pow(last.verhandelt / first.verhandelt, 1 / (last.jahr - first.jahr)) - 1) * 100 : null;
  const save = () => {
    const e = { ...edit, jahr: +edit.jahr, angebot: +edit.angebot || 0, verhandelt: +edit.verhandelt || 0, stundensatz: +edit.stundensatz || 0 };
    upd(x => ({ ...x, historie: [...(x.historie || defaultHistorie(x)).filter(r => r.jahr !== (edit._orig ?? e.jahr) && r.jahr !== e.jahr), (({ _orig, ...r }) => r)(e)] }));
    setEdit(null); toast({ title: 'Jahr ' + e.jahr + ' gespeichert' });
  };
  const del = j => upd(x => ({ ...x, historie: (x.historie || defaultHistorie(x)).filter(r => r.jahr !== j) }));
  const F = (k, label, type = 'number') => <Field label={label}><Input type={type} value={edit[k]} onChange={e => setEdit({ ...edit, [k]: e.target.value })} /></Field>;
  return <>
    {rows.length > 0 && <>
      <div className="vm-stats" style={{ padding: '15px 20px 0' }}>
        <div className="vm-stat"><span>Volumen {last.jahr}</span><b>{chf(last.verhandelt)}</b><small>{prev ? fp(pct(last.verhandelt, prev.verhandelt)) + ' ggü. ' + prev.jahr : ''}</small></div>
        <div className="vm-stat"><span>Ø Wachstum p. a.</span><b>{fp(cagr)}</b><small>{first.jahr}–{last.jahr}</small></div>
        <div className="vm-stat"><span>Verhandlungserfolg kumuliert</span><b style={{ color: 'var(--color-green-500)' }}>{chf(spar)}</b><small>{fa(pct(rows.reduce((s, r) => s + r.verhandelt, 0), rows.reduce((s, r) => s + r.angebot, 0)))} unter Angebot</small></div>
        <div className="vm-stat"><span>Stundensatz {last.jahr}</span><b>{chf(last.stundensatz)}</b><small>{fp(pct(last.stundensatz, first.stundensatz))} seit {first.jahr}</small></div>
      </div>
      <div style={{ padding: '15px 20px 5px' }}>
        <div className="vm-row" style={{ justifyContent: 'space-between', marginBottom: 10 }}>
          <div className="vm-chips">{[['volumen', 'Volumen p. a.'], ['satz', 'Stundensatz']].map(([k, t]) => <button key={k} className={'vm-chip' + (metric === k ? ' is-on' : '')} style={{ whiteSpace: 'nowrap' }} onClick={() => setMetric(k)}>{t}</button>)}</div>
          {metric === 'volumen' && <div className="vm-row vm-small vm-muted" style={{ gap: 15 }}><span className="vm-row" style={{ gap: 5 }}><i style={{ width: 12, height: 12, background: 'var(--color-primary-500)', display: 'inline-block' }}></i>Verhandelt</span><span className="vm-row" style={{ gap: 5 }}><i style={{ width: 12, height: 12, background: 'var(--color-green-50)', border: '1px dashed var(--color-green-500)', display: 'inline-block' }}></i>Einsparung ggü. Angebot</span></div>}
        </div>
        <PHChart rows={rows} metric={metric} />
      </div>
    </>}
    <table className="llv-table vm-table"><thead><tr><th>Jahr</th><th className="num">Angebot</th><th className="num">Verhandelt</th><th className="num">Verhandlungserfolg</th><th className="num">Δ Vorjahr</th><th className="num">Stundensatz</th><th>Bemerkung</th>{canEdit && <th></th>}</tr></thead><tbody>
      {[...rows].reverse().map(r => { const p = rows.find(x => x.jahr === r.jahr - 1); const s = r.angebot - r.verhandelt; return <tr key={r.jahr}>
        <td><b>{r.jahr}</b></td><td className="num vm-muted">{chf(r.angebot)}</td><td className="num"><b>{chf(r.verhandelt)}</b></td>
        <td className="num" style={{ color: s > 0 ? 'var(--color-green-500)' : undefined }}>{s > 0 ? chf(s) + ' (−' + fa(pct(r.verhandelt, r.angebot)) + ')' : '–'}</td>
        <td className="num">{p ? fp(pct(r.verhandelt, p.verhandelt)) : '–'}</td><td className="num">{r.stundensatz ? chf(r.stundensatz) : '–'}</td><td className="vm-small">{r.bemerkung}</td>
        {canEdit && <td className="vm-nowrap" style={{ textAlign: 'right' }}><button className="llv-btn llv-btn--icon" title="Bearbeiten" onClick={() => setEdit({ ...r, _orig: r.jahr })}><i className="far fa-pen-to-square"></i></button><button className="llv-btn llv-btn--icon" title="Löschen" onClick={() => del(r.jahr)}><i className="far fa-trash-can"></i></button></td>}
      </tr>; })}
      {!rows.length && <tr><td colSpan="8" className="vm-muted">Noch keine Jahre erfasst.</td></tr>}
    </tbody></table>
    {canEdit && <div style={{ padding: '10px 20px 20px' }}><Btn kind="secondary" icon="fas fa-plus" onClick={() => setEdit({ jahr: (last ? last.jahr + 1 : new Date().getFullYear()), angebot: '', verhandelt: '', stundensatz: last ? last.stundensatz : '', bemerkung: '' })}>Jahr hinzufügen</Btn></div>}
    {edit && <Dialog title={edit._orig ? 'Jahr ' + edit._orig + ' bearbeiten' : 'Jahr hinzufügen'} onClose={() => setEdit(null)} footer={<><Btn kind="secondary" onClick={() => setEdit(null)}>Abbrechen</Btn><Btn icon="fas fa-check" disabled={!edit.jahr || !edit.verhandelt} onClick={save}>Speichern</Btn></>}>
      <div className="vm-stack" style={{ gap: 14 }}>
        <div className="vm-grid2">{F('jahr', 'Jahr')}{F('stundensatz', 'Stundensatz (CHF)')}</div>
        <div className="vm-grid2">{F('angebot', 'Angebot (CHF p. a.)')}{F('verhandelt', 'Verhandelt (CHF p. a.)')}</div>
        {+edit.angebot > +edit.verhandelt && +edit.verhandelt > 0 && <div className="vm-small" style={{ color: 'var(--color-green-500)' }}><i className="fas fa-arrow-trend-down"></i> Verhandlungserfolg: {chf(edit.angebot - edit.verhandelt)} ({fa(pct(+edit.verhandelt, +edit.angebot))} unter Angebot)</div>}
        {F('bemerkung', 'Bemerkung', 'text')}
      </div>
    </Dialog>}
  </>;
}
Object.assign(window, { PreisHistorie, defaultHistorie });
