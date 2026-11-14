// PUB-04 Contact (App Flow 4.1): phone, email, address and the contact form. Errors per field;
// success: "Asante, tutawasiliana nawe".
import {
  CheckCircleOutlined,
  EnvironmentOutlined,
  MailOutlined,
  PhoneOutlined,
} from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/vote/Button';
import { PublicForm } from './PublicForm';
import { Container, PageIntro } from './PublicParts';
import { usePageTitle, usePublicText } from './publicText';

export default function ContactPage() {
  const { t } = usePublicText();
  usePageTitle('meta.contact');
  const [sent, setSent] = useState(false);
  const [round, setRound] = useState(0);
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent) successRef.current?.focus();
  }, [sent]);

  return (
    <Container className="py-12 lg:py-16">
      <PageIntro title={t('contact.title')} lead={t('contact.lead')} />
      <div className="mt-10 grid gap-10 lg:grid-cols-3">
        <section className="lg:col-span-1">
          <h2 className="text-h3 font-semibold">{t('contact.detailsTitle')}</h2>
          <dl className="mt-4 flex flex-col gap-4">
            {(
              [
                [PhoneOutlined, 'contact.phoneLabel', 'contact.phone'],
                [MailOutlined, 'contact.emailLabel', 'contact.email'],
                [EnvironmentOutlined, 'contact.addressLabel', 'contact.address'],
              ] as const
            ).map(([Icon, label, value]) => (
              <div key={label} className="flex gap-3">
                <span className="vk-icon-tile">
                  <Icon aria-hidden />
                </span>
                <div>
                  <dt className="text-body-sm text-text-secondary">{t(label)}</dt>
                  <dd className="select-text text-body font-medium">{t(value)}</dd>
                </div>
              </div>
            ))}
          </dl>
        </section>
        <section className="rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8 lg:col-span-2">
          <h2 className="text-h3 font-semibold">{t('contact.formTitle')}</h2>
          <div className="mt-6">
            {sent ? (
              <div
                ref={successRef}
                tabIndex={-1}
                role="status"
                className="flex flex-col items-start gap-4 outline-none"
              >
                <p className="flex items-center gap-2 text-h4 font-semibold text-success-fg">
                  <CheckCircleOutlined aria-hidden />
                  {t('contact.success')}
                </p>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSent(false);
                    setRound((n) => n + 1);
                  }}
                >
                  {t('contact.another')}
                </Button>
              </div>
            ) : (
              <PublicForm
                key={round}
                kind="contact"
                submitLabel="contact.send"
                onSent={() => setSent(true)}
              />
            )}
          </div>
        </section>
      </div>
    </Container>
  );
}
