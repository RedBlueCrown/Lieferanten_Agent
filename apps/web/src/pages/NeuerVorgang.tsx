import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import clsx from 'clsx';
import { addMonths, CONTRACT_TYPES, dateCH, type ReviewStandard } from '@vm/domain';
import { api, ApiError } from '../lib/api';
import { useStage } from '../agent/store';
import { IconFile, IconSpark, IconUpload } from '../components/icons';
import { DateInput, Field, PageHead, Panel } from '../components/ui';

type Mode = 'llv_entwurf' | 'lieferantenpapier';

const HINTS = { termMonths: 36, noticeMonths: 6, availability: 99.5 };

export function NeuerVorgang() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const openStage = useStage((s) => s.open);
  const [mode, setMode] = useState<Mode>(params.get('art') === 'lieferantenpapier' ? 'lieferantenpapier' : 'llv_entwurf');
  const [type, setType] = useState<string>('SaaS-Vertrag');
  const [supplierId, setSupplierId] = useState<string>('');
  const [newSupplier, setNewSupplier] = useState('');
  const [title, setTitle] = useState('');
  const [subject, setSubject] = useState('');
  const [start, setStart] = useState(() => `${new Date().getFullYear() + 1}-01-01`);
  const [term, setTerm] = useState(36);
  const [notice, setNotice] = useState(6);
  const [amount, setAmount] = useState<string>('');
  const [availability, setAvailability] = useState(99.5);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const standards = useQuery({ queryKey: ['standards'], queryFn: () => api.get<ReviewStandard[]>('/api/v1/standards') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get<{ id: string; name: string; class: string }[]>('/api/v1/suppliers') });
  const std = useMemo(() => standards.data?.find((s) => s.contractType === type), [standards.data, type]);
  const sla = type === 'SaaS-Vertrag' || type === 'Wartung/Support (SLA)';
  const supplierName = supplierId ? (suppliers.data?.find((s) => s.id === supplierId)?.name ?? '') : newSupplier.trim();

  const validate = () => {
    const e: Record<string, string> = {};
    if (!supplierName) e.supplier = 'Bitte einen Lieferanten wählen oder eingeben.';
    if (title.trim().length < 3) e.title = 'Bitte eine Bezeichnung mit mindestens 3 Zeichen.';
    if (mode === 'llv_entwurf') {
      if (subject.trim().length < 10) e.subject = 'Beschreiben Sie in einem Satz, was der Lieferant leistet.';
      const a = Number(amount);
      if (!amount || Number.isNaN(a)) e.amount = 'Bitte den Betrag pro Jahr angeben.';
      else if (a < 500) e.amount = 'Der Betrag wirkt unplausibel tief. Bitte prüfen (CHF pro Jahr, ohne MWST).';
      if (term < 1 || term > 120) e.term = 'Zwischen 1 und 120 Monaten.';
    } else if (!file) e.file = 'Bitte das Vertragspapier des Lieferanten hochladen (PDF oder Word).';
    setErrors(e);
    const first = Object.keys(e)[0];
    if (first) document.getElementById(`f-${first}`)?.focus();
    return !first;
  };

  const submit = async () => {
    if (!validate()) return;
    setBusy(true);
    try {
      const c = await api.post<{ id: string }>('/api/v1/cases', {
        source: mode,
        type,
        title: title.trim(),
        supplierId: supplierId || null,
        supplierName,
        fields: mode === 'llv_entwurf' ? { subject: subject.trim(), start, termMonths: term, noticeMonths: notice, amount: Number(amount), ...(sla ? { availability } : {}) } : {},
      });
      if (mode === 'llv_entwurf') {
        const { jobId } = await api.post<{ jobId: string }>(`/api/v1/cases/${c.id}/draft`);
        openStage({ jobId, kind: 'entwurf', title: `Entwurf: ${title.trim()}`, resultPath: `/vorgaenge/${c.id}`, resultLabel: 'Entwurf ansehen' });
        navigate(`/vorgaenge/${c.id}`);
      } else {
        await api.upload(`/api/v1/cases/${c.id}/documents?kind=lieferantenpapier`, file!);
        toast.success('Beim Rechtsdienst eingereicht', { description: `${supplierName}: ${title.trim()}` });
        navigate(`/vorgaenge/${c.id}`);
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Der Vorgang konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead crumbs={[{ label: 'Meine Vorgänge', to: '/' }, { label: 'Neuer Vertrag' }]} title="Neuer Vertrag" lead="Wählen Sie, womit Sie starten. Der Rechtsdienst prüft danach nur, was vom Standard abweicht." />

      <div className="choices" role="group" aria-label="Ausgangslage">
        <button type="button" className="choice" aria-pressed={mode === 'llv_entwurf'} onClick={() => setMode('llv_entwurf')}>
          <span className="row">
            <IconSpark size={18} />
            <span className="choice__title">Mit LLV-Vorlage erstellen</span>
          </span>
          <span className="choice__text">Der Entwurfs-Agent stellt den Vertrag aus den Textbausteinen des Rechtsdienstes zusammen und formuliert den Gegenstand.</span>
        </button>
        <button type="button" className="choice" aria-pressed={mode === 'lieferantenpapier'} onClick={() => setMode('lieferantenpapier')}>
          <span className="row">
            <IconFile size={18} />
            <span className="choice__title">Vertrag des Lieferanten prüfen lassen</span>
          </span>
          <span className="choice__text">Sie laden das Papier des Lieferanten hoch, der Rechtsdienst prüft es mit dem Prüf-Agenten gegen den Standard.</span>
        </button>
      </div>

      <Panel title="Vertragsart und Lieferant">
        <div className="stack">
          <div className="choices">
            {CONTRACT_TYPES.map((t) => {
              const s = standards.data?.find((x) => x.contractType === t);
              return (
                <button key={t} type="button" className="choice" aria-pressed={type === t} onClick={() => setType(t)}>
                  <span className="choice__title">{t}</span>
                  <span className="choice__text">{s ? `Prüfstandard Version ${s.version}, ${s.criteria.length} Kriterien` : 'Kein Prüfstandard hinterlegt'}</span>
                </button>
              );
            })}
          </div>
          <div className="form-grid">
            <Field label="Lieferant" error={errors.supplier} hint="Bestehenden Lieferanten wählen oder unten einen neuen eingeben.">
              <select id="f-supplier" className="select" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">Neuer Lieferant</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Klasse {s.class})
                  </option>
                ))}
              </select>
            </Field>
            {!supplierId && (
              <Field label="Name des neuen Lieferanten">
                <input className="input" value={newSupplier} onChange={(e) => setNewSupplier(e.target.value)} placeholder="Firma AG" autoComplete="organization" />
              </Field>
            )}
            <Field label="Bezeichnung" error={errors.title}>
              <input id="f-title" className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Zum Beispiel: Datenplattform Statistik 2027" aria-invalid={!!errors.title} />
            </Field>
          </div>
        </div>
      </Panel>

      {mode === 'llv_entwurf' ? (
        <Panel title="Eckdaten" actions={std && <span className="muted small">Grenzwerte aus Prüfstandard {type}, Version {std.version}</span>}>
          <div className="stack">
            <Field label="Was leistet der Lieferant?" error={errors.subject} hint="Ein bis zwei Sätze. Der Entwurfs-Agent formuliert daraus die Klausel «Vertragsgegenstand».">
              <textarea id="f-subject" className="textarea" value={subject} onChange={(e) => setSubject(e.target.value)} aria-invalid={!!errors.subject} placeholder="Betrieb und Weiterentwicklung der Datenplattform des Amts für Statistik inklusive Support" />
            </Field>
            <div className="form-grid">
              <Field label="Vertragsbeginn" hint={`Ende: ${dateCH(addMonths(start, term))}`}>
                <DateInput value={start} onChange={(iso) => iso && setStart(iso)} />
              </Field>
              <Field label="Feste Laufzeit (Monate)" error={errors.term} hint={term > HINTS.termMonths ? `Über dem Standard von höchstens ${HINTS.termMonths} Monaten: Abweichung.` : `Standard: höchstens ${HINTS.termMonths}`}>
                <input id="f-term" className="input" type="number" inputMode="numeric" min={1} max={120} value={term} onChange={(e) => setTerm(Number(e.target.value))} />
              </Field>
              <Field label="Kündigungsfrist (Monate)" hint={notice > HINTS.noticeMonths ? 'Über dem Standard von 6 Monaten: Abweichung.' : 'Standard: höchstens 6'}>
                <input className="input" type="number" inputMode="numeric" min={0} max={24} value={notice} onChange={(e) => setNotice(Number(e.target.value))} />
              </Field>
              <Field label="Betrag pro Jahr (CHF, ohne MWST)" error={errors.amount}>
                <input id="f-amount" className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))} placeholder="84000" aria-invalid={!!errors.amount} />
              </Field>
              {sla && (
                <Field label="Verfügbarkeit pro Monat (%)" hint={availability < HINTS.availability ? 'Unter dem Standard von 99,5 %: Abweichung.' : 'Standard: mindestens 99,5 %'}>
                  <input className="input" type="number" step="0.1" min={90} max={100} value={availability} onChange={(e) => setAvailability(Number(e.target.value))} />
                </Field>
              )}
            </div>
          </div>
        </Panel>
      ) : (
        <Panel title="Vertragspapier des Lieferanten">
          <label className={clsx('dropzone', file && 'has-file')} id="f-file" tabIndex={-1}>
            <IconUpload size={22} />
            <span>{file ? file.name : 'PDF oder Word-Dokument wählen oder hierher ziehen'}</span>
            <input type="file" accept=".pdf,.docx" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </label>
          {errors.file && <p className="field__error">{errors.file}</p>}
        </Panel>
      )}

      <div className="row-between">
        <button type="button" className="btn btn--secondary" onClick={() => navigate('/')}>
          Abbrechen
        </button>
        <button type="button" className={clsx('btn', mode === 'llv_entwurf' ? 'btn--ai' : 'btn--primary')} disabled={busy} onClick={submit}>
          {mode === 'llv_entwurf' ? (
            <>
              <IconSpark size={16} /> {busy ? 'Startet …' : 'Entwurf erstellen lassen'}
            </>
          ) : busy ? (
            'Wird eingereicht …'
          ) : (
            'Beim Rechtsdienst einreichen'
          )}
        </button>
      </div>
    </>
  );
}
