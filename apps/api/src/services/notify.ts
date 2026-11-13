/**
 * Notifications. Always stored in the database and shown in the app; with
 * MAIL_PROVIDER=acs also sent by e-mail through Azure Communication Services.
 * Addressed to a person (oid) or to everyone with a role ("role:rechtsdienst").
 */
import type { Role } from '@vm/domain';
import { config } from '../config';
import type { Db } from '../db';
import { newId } from '../util';

type EmailClient = import('@azure/communication-email').EmailClient;

export class Notifier {
  private client?: EmailClient;

  constructor(private readonly db: Db) {}

  private async mail(to: string[], subject: string, body: string, link?: string) {
    if (config.mail.provider !== 'acs' || !config.mail.acsEndpoint || !to.length) return;
    if (!this.client) {
      const { EmailClient } = await import('@azure/communication-email');
      const { DefaultAzureCredential } = await import('@azure/identity');
      this.client = new EmailClient(config.mail.acsEndpoint, new DefaultAzureCredential());
    }
    const url = link ? `${config.publicBaseUrl}${link}` : config.publicBaseUrl;
    const poller = await this.client.beginSend({
      senderAddress: config.mail.sender,
      recipients: { to: to.map((address) => ({ address })) },
      content: { subject, plainText: `${body}\n\n${url}`, html: `<p>${body}</p><p><a href="${url}">In der Anwendung öffnen</a></p>` },
    });
    await poller.pollUntilDone();
  }

  /** Returns false when a notification with the same dedupe key exists. */
  async send(opts: { to: { oid: string } | { role: Role }; subject: string; body: string; link?: string; dedupeKey?: string }): Promise<boolean> {
    const target = 'oid' in opts.to ? opts.to.oid : `role:${opts.to.role}`;
    const rows = await this.db.query(
      `insert into notifications (id, user_oid, subject, body, link, dedupe_key, sent_via) values ($1,$2,$3,$4,$5,$6,$7)
       on conflict (dedupe_key) do nothing returning id`,
      [newId('N'), target, opts.subject, opts.body, opts.link ?? null, opts.dedupeKey ?? null, config.mail.provider],
    );
    if (!rows.length) return false;
    const recipients =
      'oid' in opts.to
        ? await this.db.query<{ email: string }>('select email from users where oid=$1 and email is not null', [opts.to.oid])
        : await this.db.query<{ email: string }>(`select email from users where roles ? $1 and email is not null`, [opts.to.role]);
    this.mail(recipients.map((r) => r.email), opts.subject, opts.body, opts.link).catch((e) => console.error('E-Mail fehlgeschlagen', e));
    return true;
  }

  async forUser(oid: string, roles: Role[]) {
    const targets = [oid, ...roles.map((r) => `role:${r}`)];
    return this.db.query(`select * from notifications where user_oid = any($1) order by created_at desc limit 50`, [targets]);
  }

  async markRead(oid: string, roles: Role[], id?: string) {
    const targets = [oid, ...roles.map((r) => `role:${r}`)];
    if (id) await this.db.query('update notifications set read_at=now() where id=$1 and user_oid = any($2)', [id, targets]);
    else await this.db.query('update notifications set read_at=now() where read_at is null and user_oid = any($1)', [targets]);
  }
}
