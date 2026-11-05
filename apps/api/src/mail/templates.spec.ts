import { invitationEmail, passwordResetEmail } from './templates.js';

const link = 'https://vote.example.tz/app/invite/abc';

describe('email templates', () => {
  it('writes the invitation in Swahili by default and English on request', () => {
    const base = { to: 'a@example.test', fullName: 'Asha', organizationName: 'Chama', link };
    const sw = invitationEmail({ ...base, language: 'sw' });
    const en = invitationEmail({ ...base, language: 'en' });
    expect(sw.subject).toBe('Akaunti yako ya Vote-Kidigit kwa Chama');
    expect(sw.text).toContain('Habari Asha,');
    expect(sw.text).toContain('saa 48');
    expect(en.subject).toBe('Your Vote-Kidigit account for Chama');
    expect(en.text).toContain('48 hours');
    for (const mail of [sw, en]) {
      expect(mail.text).toContain(link);
      expect(mail.html).toContain(`<a href="${link}">`);
      expect(mail.text).not.toContain('!');
    }
  });

  it('names Vote-Kidigit when a platform administrator is invited', () => {
    const mail = invitationEmail({
      to: 'a@example.test',
      fullName: 'Juma',
      organizationName: null,
      link,
      language: 'en',
    });
    expect(mail.subject).toBe('Your Vote-Kidigit account for Vote-Kidigit');
  });

  it('writes the reset email with its 60-minute validity', () => {
    const sw = passwordResetEmail({ to: 'a@example.test', fullName: 'Asha', link, language: 'sw' });
    const en = passwordResetEmail({ to: 'a@example.test', fullName: 'Asha', link, language: 'en' });
    expect(sw.text).toContain('dakika 60');
    expect(en.text).toContain('60 minutes');
  });

  it('escapes names in the HTML version', () => {
    const mail = invitationEmail({
      to: 'a@example.test',
      fullName: '<script>x</script>',
      organizationName: 'A & B',
      link,
      language: 'sw',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&#60;script&#62;');
    expect(mail.html).toContain('A &#38; B');
  });
});
