// PUB-05 Request a demo (App Flow 4.1): name, organization, phone, email, expected voters,
// preferred date. Validation errors per field; success screen with the next steps.
import { CheckCircleOutlined } from '@ant-design/icons';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { PublicForm } from './PublicForm';
import { Container, PageIntro } from './PublicParts';
import { usePageTitle, usePublicText } from './publicText';

const NEXT = ['demo.next1', 'demo.next2', 'demo.next3'] as const;

export default function DemoPage() {
  const { t } = usePublicText();
  usePageTitle('meta.demo');
  const [sent, setSent] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    if (sent) headingRef.current?.focus();
  }, [sent]);

  if (sent) {
    return (
      <Container className="py-12 lg:py-16">
        <div className="max-w-160" role="status">
          <CheckCircleOutlined aria-hidden className="text-h1 text-success-fg" />
          <h1 ref={headingRef} tabIndex={-1} className="mt-4 text-h1 font-semibold outline-none">
            {t('demo.successTitle')}
          </h1>
          <p className="mt-4 text-body-lg text-text-secondary">{t('demo.successLead')}</p>
          <ol className="mt-6 flex flex-col gap-4">
            {NEXT.map((key, index) => (
              <li key={key} className="flex items-start gap-3">
                <span className="vk-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="pt-1 text-body">{t(key)}</span>
              </li>
            ))}
          </ol>
          <Link to="/" className="vk-btn vk-btn--secondary mt-8">
            {t('demo.backHome')}
          </Link>
        </div>
      </Container>
    );
  }

  return (
    <Container className="py-12 lg:py-16">
      <PageIntro title={t('demo.title')} lead={t('demo.lead')} />
      <section className="mt-10 max-w-160 rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8">
        <PublicForm kind="demo" submitLabel="demo.submit" onSent={() => setSent(true)} />
      </section>
    </Container>
  );
}
