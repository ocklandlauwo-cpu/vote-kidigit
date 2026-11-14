// PUB-03 Pricing (App Flow 4.1): "Contact us for pricing" in V1 (no billing), what every
// election includes, Request a demo.
import { CheckOutlined } from '@ant-design/icons';
import { Link } from 'react-router';
import { Container, PageIntro } from './PublicParts';
import { usePageTitle, usePublicText } from './publicText';

const INCLUDED = [
  'pricing.included1',
  'pricing.included2',
  'pricing.included3',
  'pricing.included4',
] as const;

export default function PricingPage() {
  const { t } = usePublicText();
  usePageTitle('meta.pricing');
  return (
    <Container className="py-12 lg:py-16">
      <PageIntro title={t('pricing.title')} lead={t('pricing.lead')} />
      <section className="mt-10 max-w-160 rounded-lg border border-border bg-surface p-6 shadow-sm md:p-8">
        <h2 className="text-h2 font-semibold">{t('pricing.headline')}</h2>
        <h3 className="mt-6 text-label font-semibold text-text-secondary">
          {t('pricing.includedTitle')}
        </h3>
        <ul className="mt-3 flex flex-col gap-3">
          {INCLUDED.map((key) => (
            <li key={key} className="flex items-start gap-3 text-body">
              <CheckOutlined aria-hidden className="mt-1 text-success-fg" />
              {t(key)}
            </li>
          ))}
        </ul>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link to="/demo" className="vk-btn vk-btn--primary">
            {t('nav.demo')}
          </Link>
          <Link to="/contact" className="vk-btn vk-btn--secondary">
            {t('pricing.contact')}
          </Link>
        </div>
      </section>
    </Container>
  );
}
