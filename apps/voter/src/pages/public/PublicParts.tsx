// Building blocks of the public pages (Design System 10.11): page heading, feature tile, CTA
// band, and the static ballot screenshot in a phone frame.
import { CheckCircleFilled } from '@ant-design/icons';
import type { ComponentType, ReactNode } from 'react';
import { Link } from 'react-router';
import { LogoMark } from '../../components/LogoMark';
import { usePublicText } from './publicText';

/** Top of an inner page: h1 and lead. */
export function PageIntro({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="max-w-160">
      <h1 className="text-h1 font-semibold md:text-display">{title}</h1>
      <p className="mt-4 text-body-lg text-text-secondary">{lead}</p>
    </div>
  );
}

export function Container({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`mx-auto max-w-300 px-4 md:px-6 ${className}`}>{children}</div>;
}

/** Feature tile: 40 px icon tile, title, text (feature grid, trust strip). */
export function FeatureTile({
  icon: Icon,
  title,
  text,
  level = 3,
}: {
  icon: ComponentType<{ 'aria-hidden'?: boolean }>;
  title: string;
  text: string;
  level?: 2 | 3;
}) {
  const Heading = level === 2 ? 'h2' : 'h3';
  return (
    <div className="flex gap-4">
      <span className="vk-icon-tile">
        <Icon aria-hidden />
      </span>
      <div>
        <Heading className="text-h4 font-semibold">{title}</Heading>
        <p className="mt-1 text-body-sm text-text-secondary">{text}</p>
      </div>
    </div>
  );
}

/** Closing band: question and "Request a demo". */
export function CtaBand() {
  const { t } = usePublicText();
  return (
    <section className="vk-cta-band">
      <Container className="flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between">
        <h2 className="text-h2 font-semibold">{t('home.ctaTitle')}</h2>
        <Link to="/demo" className="vk-btn vk-btn--on-primary">
          {t('nav.demo')}
        </Link>
      </Container>
    </section>
  );
}

const CONTESTERS = [
  'mock.contester1',
  'mock.contester2',
  'mock.contester3',
  'mock.contester4',
] as const;

const initials = (name: string) =>
  name
    .split(' ')
    .map((part) => part[0])
    .join('')
    .slice(0, 2);

/**
 * The voter ballot (VTR-WEB-04) as a static picture: one image to assistive technology, with a
 * description; nothing in it can be focused or pressed.
 */
export function PhoneMock() {
  const { t } = usePublicText();
  return (
    <div role="img" aria-label={t('mock.label')} className="vk-phone">
      <div className="vk-phone__screen" aria-hidden="true">
        <div className="vk-phone__header">
          <LogoMark size={24} />
          <div className="min-w-0">
            <p className="truncate text-caption text-text-secondary">{t('mock.organization')}</p>
            <p className="truncate text-body-sm font-semibold">{t('mock.event')}</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 p-3">
          <div>
            <p className="text-caption text-text-secondary">{t('mock.progress')}</p>
            <div className="vk-progress mt-1">
              <span style={{ width: '33%' }} />
            </div>
          </div>
          <div>
            <p className="text-h4 font-semibold">{t('mock.category')}</p>
            <p className="text-caption text-text-secondary">{t('mock.rule')}</p>
          </div>
          <div className="vk-phone__grid">
            {CONTESTERS.map((key, index) => {
              const name = t(key);
              return (
                <div key={key} className="vk-phone__card" data-selected={index === 0}>
                  <span className="vk-phone__avatar">{initials(name)}</span>
                  <span className="flex items-center gap-1">
                    {index === 0 && <CheckCircleFilled className="text-primary" />}
                    {name}
                  </span>
                </div>
              );
            })}
          </div>
          <div className="vk-phone__button">{t('mock.next')}</div>
        </div>
      </div>
    </div>
  );
}
