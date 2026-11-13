import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Dialog as BDialog } from '@base-ui/react/dialog';
import clsx from 'clsx';
import { AMPEL_LABEL, CASE_STATUS_LABEL, CASE_TRACK, type Ampel, type CaseStatus } from '@vm/domain';
import { IconAlert, IconCheck, IconX } from './icons';

export function AmpelIcon({ ampel, size = 14 }: { ampel: Ampel | 'grau'; size?: number }) {
  if (ampel === 'gruen') return <IconCheck size={size} strokeWidth={2.4} />;
  if (ampel === 'gelb') return <IconAlert size={size} strokeWidth={2.2} />;
  if (ampel === 'rot') return <IconX size={size} strokeWidth={2.4} />;
  return null;
}

export function AmpelStatus({ ampel, label }: { ampel: Ampel; label?: string }) {
  return (
    <span className={`status status--${ampel}`}>
      <AmpelIcon ampel={ampel} size={13} />
      {label ?? AMPEL_LABEL[ampel]}
    </span>
  );
}

export function Status({ tone = 'neutral', children }: { tone?: 'rot' | 'gelb' | 'gruen' | 'neutral' | 'accent' | 'ai'; children: ReactNode }) {
  return (
    <span className={`status status--${tone}`}>
      {(tone === 'rot' || tone === 'gelb' || tone === 'gruen') && <AmpelIcon ampel={tone} size={13} />}
      {children}
    </span>
  );
}

export function PageHead({ title, lead, crumbs, actions }: { title: ReactNode; lead?: ReactNode; crumbs?: { label: string; to?: string }[]; actions?: ReactNode }) {
  return (
    <div className="pagehead">
      <div className="pagehead__text">
        {crumbs && (
          <nav className="crumbs" aria-label="Pfad">
            {crumbs.map((c, i) => (
              <span key={i}>
                {i > 0 && <span aria-hidden> / </span>}
                {c.to ? <Link to={c.to}>{c.label}</Link> : c.label}
              </span>
            ))}
          </nav>
        )}
        <h1>{title}</h1>
        {lead && <p className="pagehead__lead">{lead}</p>}
      </div>
      {actions && <div className="row">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, pad = true, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; pad?: boolean; className?: string }) {
  return (
    <section className={clsx('panel', className)}>
      {(title || actions) && (
        <div className="panel__head">
          {typeof title === 'string' ? <h2 style={{ fontSize: 'var(--text-lg)' }}>{title}</h2> : title}
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {pad ? <div className="panel__body">{children}</div> : children}
    </section>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <span className="empty__title">{title}</span>
      {children && <p>{children}</p>}
      {action}
    </div>
  );
}

export function Skeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="stack-sm" style={{ padding: 'var(--space-lg)' }} aria-busy="true" aria-label="Lädt">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ height: 18, width: `${92 - i * 9}%` }} />
      ))}
    </div>
  );
}

export function ErrorBox({ error, retry }: { error: unknown; retry?: () => void }) {
  return (
    <div className="error-box row-between" role="alert">
      <span>{error instanceof Error ? error.message : 'Etwas ist schiefgelaufen.'}</span>
      {retry && (
        <button type="button" className="btn btn--secondary btn--sm" onClick={retry}>
          Erneut versuchen
        </button>
      )}
    </div>
  );
}

/** Loading, error, empty and full in one place. */
export function Loadable<T>({ q, empty, children, rows }: { q: { data?: T; isLoading: boolean; error: unknown; refetch: () => void }; empty?: (d: T) => ReactNode | null; children: (d: T) => ReactNode; rows?: number }) {
  if (q.isLoading) return <Skeleton rows={rows} />;
  if (q.error) return <ErrorBox error={q.error} retry={q.refetch} />;
  if (q.data === undefined) return null;
  const e = empty?.(q.data);
  if (e) return <>{e}</>;
  return <>{children(q.data)}</>;
}

export function Modal({ open, onOpenChange, title, children, footer, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <BDialog.Root open={open} onOpenChange={onOpenChange}>
      <BDialog.Portal>
        <BDialog.Backdrop className="backdrop" />
        <BDialog.Popup className={clsx('dialog', wide && 'dialog--wide')}>
          <div className="row-between">
            <BDialog.Title render={<h2 />} style={{ fontSize: 'var(--text-xl)' }}>
              {title}
            </BDialog.Title>
            <BDialog.Close className="iconbtn" aria-label="Schliessen">
              <IconX size={18} />
            </BDialog.Close>
          </div>
          {children}
          {footer && <div className="dialog__foot">{footer}</div>}
        </BDialog.Popup>
      </BDialog.Portal>
    </BDialog.Root>
  );
}

export function Field({ label, hint, error, children }: { label: string; hint?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      {children}
      {error ? <span className="field__error">{error}</span> : <span className="field__hint">{hint}</span>}
    </label>
  );
}

export function Figure({ label, value, note, tone }: { label: string; value: ReactNode; note?: ReactNode; tone?: 'rot' }) {
  return (
    <div className="figure">
      <span className="figure__label">{label}</span>
      <span className="figure__value num" style={tone === 'rot' ? { color: 'var(--color-red)' } : undefined}>
        {value}
      </span>
      {note && <span className="figure__note">{note}</span>}
    </div>
  );
}

const TONE: Record<CaseStatus, 'neutral' | 'accent' | 'gelb' | 'gruen' | 'rot'> = {
  entwurf: 'neutral',
  in_pruefung: 'accent',
  nachverhandlung: 'gelb',
  freigegeben: 'gruen',
  unterzeichnet: 'accent',
  aktiv: 'gruen',
  verworfen: 'neutral',
};

export function CaseStatusBadge({ status }: { status: CaseStatus }) {
  return <Status tone={TONE[status]}>{CASE_STATUS_LABEL[status]}</Status>;
}

/** Progress of a case, like parcel tracking. */
export function CaseTrack({ status }: { status: CaseStatus }) {
  const current = status === 'nachverhandlung' ? 1 : CASE_TRACK.indexOf(status);
  return (
    <ol className="track" aria-label="Fortschritt">
      {CASE_TRACK.map((s, i) => {
        const state = i < current || status === 'aktiv' ? 'done' : i === current ? 'now' : 'next';
        return (
          <li key={s} className={`track__step is-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
            <span className="track__dot">{state === 'done' ? <IconCheck size={12} strokeWidth={3} /> : i + 1}</span>
            <span className="track__label">{i === 1 && status === 'nachverhandlung' ? 'Nachverhandlung' : CASE_STATUS_LABEL[s]}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Date in the Swiss format (TT.MM.JJJJ) regardless of the browser language;
 * the value stays ISO (JJJJ-MM-TT).
 */
export function DateInput({ value, onChange, disabled, id, invalid }: { value: string; onChange: (iso: string) => void; disabled?: boolean; id?: string; invalid?: boolean }) {
  const toCh = (iso: string) => (/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}` : '');
  const [text, setText] = useState(toCh(value));
  const [bad, setBad] = useState(false);
  useEffect(() => setText(toCh(value)), [value]);
  const parse = (t: string): string | null => {
    const m = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(t.trim());
    if (!m) return /^\d{4}-\d{2}-\d{2}$/.test(t.trim()) ? t.trim() : null;
    const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    const d = new Date(iso + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  };
  return (
    <input
      id={id}
      className="input num"
      inputMode="numeric"
      placeholder="TT.MM.JJJJ"
      value={text}
      disabled={disabled}
      aria-invalid={bad || invalid}
      onChange={(e) => {
        setText(e.target.value);
        const iso = parse(e.target.value);
        if (iso) {
          setBad(false);
          onChange(iso);
        } else if (!e.target.value.trim()) onChange('');
      }}
      onBlur={() => {
        const iso = parse(text);
        setBad(!!text.trim() && !iso);
        if (iso) setText(toCh(iso));
      }}
    />
  );
}
