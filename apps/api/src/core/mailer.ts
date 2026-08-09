import { getConfig } from './config.js';

/**
 * Outbound mail.
 *
 * Development uses the `console` driver, which prints the message (including the
 * verification link) to the server log so flows can be completed without an SMTP
 * server. `smtp` is the production driver; wiring a real transport is a single
 * `sendViaSmtp` implementation and is intentionally left unimplemented rather
 * than faked, so nothing silently "succeeds" without delivering.
 */

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  async send(message: MailMessage): Promise<void> {
    const config = getConfig();
    // eslint-disable-next-line no-console -- this driver's entire purpose is to print
    console.log(
      [
        '',
        '──────────── EMAIL (console driver) ────────────',
        `From:    ${config.MAIL_FROM}`,
        `To:      ${message.to}`,
        `Subject: ${message.subject}`,
        '',
        message.text,
        '────────────────────────────────────────────────',
        '',
      ].join('\n'),
    );
  }
}

class SmtpMailer implements Mailer {
  async send(_message: MailMessage): Promise<void> {
    throw new Error(
      'MAIL_DRIVER=smtp is configured but no SMTP transport is implemented. ' +
        'Add one in src/core/mailer.ts before enabling it, or use MAIL_DRIVER=console.',
    );
  }
}

let mailer: Mailer | null = null;

export function getMailer(): Mailer {
  if (!mailer) {
    mailer = getConfig().MAIL_DRIVER === 'smtp' ? new SmtpMailer() : new ConsoleMailer();
  }
  return mailer;
}

/** Test seam: swap in a recording mailer. */
export function setMailer(custom: Mailer | null): void {
  mailer = custom;
}

// --- message templates -----------------------------------------------------

export function verificationEmail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Confirm your email address',
    text: [
      'Welcome!',
      '',
      'Confirm your email address to finish setting up your account:',
      link,
      '',
      'This link expires in 24 hours. If you did not create an account, ignore this message.',
    ].join('\n'),
  };
}

export function passwordResetEmail(to: string, link: string): MailMessage {
  return {
    to,
    subject: 'Reset your password',
    text: [
      'We received a request to reset your password.',
      '',
      'Use this link to choose a new one:',
      link,
      '',
      'This link expires in 60 minutes and can be used once.',
      'If you did not request a reset, you can safely ignore this message — your password has not changed.',
    ].join('\n'),
  };
}

export function passwordChangedEmail(to: string): MailMessage {
  return {
    to,
    subject: 'Your password was changed',
    text: [
      'Your account password was just changed and every other session was signed out.',
      '',
      'If this was not you, reset your password immediately.',
    ].join('\n'),
  };
}
