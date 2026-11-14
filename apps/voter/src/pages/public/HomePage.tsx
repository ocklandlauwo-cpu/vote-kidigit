// PUB-01 Home (App Flow 4.1, Design System 10.11): hero with the ballot screenshot, how it works
// in 3 steps, channels, trust strip, call to action. Actions: Request a demo, Sign in, Vote.
import {
  DesktopOutlined,
  FilePdfOutlined,
  HistoryOutlined,
  LockOutlined,
  MobileOutlined,
  PhoneOutlined,
  ShopOutlined,
} from '@ant-design/icons';
import { Link } from 'react-router';
import { Container, CtaBand, FeatureTile, PhoneMock } from './PublicParts';
import { usePageTitle, usePublicText } from './publicText';

const STEPS = [
  ['home.step1Title', 'home.step1Text'],
  ['home.step2Title', 'home.step2Text'],
  ['home.step3Title', 'home.step3Text'],
] as const;

export default function HomePage() {
  const { t } = usePublicText();
  usePageTitle('meta.home');
  return (
    <>
      <section className="py-12 lg:py-20">
        <Container className="flex items-center justify-between gap-12">
          <div className="max-w-160">
            <p className="vk-overline">{t('home.overline')}</p>
            <h1 className="mt-3 text-h1 font-semibold md:text-display">{t('home.title')}</h1>
            <p className="mt-4 text-body-lg text-text-secondary">{t('home.lead')}</p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to="/demo" className="vk-btn vk-btn--primary">
                {t('nav.demo')}
              </Link>
              <a href="#how-it-works" className="vk-btn vk-btn--secondary">
                {t('home.howItWorks')}
              </a>
            </div>
          </div>
          <div className="hidden justify-center lg:flex">
            <PhoneMock />
          </div>
        </Container>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-border bg-surface py-16">
        <Container>
          <h2 className="text-h2 font-semibold">{t('home.stepsTitle')}</h2>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map(([title, text], index) => (
              <li key={title} className="flex flex-col gap-3">
                <span className="vk-step-number" aria-hidden="true">
                  {index + 1}
                </span>
                <h3 className="text-h3 font-semibold">{t(title)}</h3>
                <p className="text-body text-text-secondary">{t(text)}</p>
              </li>
            ))}
          </ol>
        </Container>
      </section>

      <section className="py-16">
        <Container>
          <h2 className="text-h2 font-semibold">{t('home.channelsTitle')}</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-3">
            <FeatureTile
              icon={DesktopOutlined}
              title={t('home.webTitle')}
              text={t('home.webText')}
            />
            <FeatureTile
              icon={MobileOutlined}
              title={t('home.ussdTitle')}
              text={t('home.ussdText')}
            />
            <FeatureTile
              icon={ShopOutlined}
              title={t('home.kioskTitle')}
              text={t('home.kioskText')}
            />
          </div>
        </Container>
      </section>

      <section className="border-t border-border bg-surface py-16">
        <Container>
          <h2 className="text-h2 font-semibold">{t('home.trustTitle')}</h2>
          <div className="mt-8 grid gap-8 md:grid-cols-2 lg:grid-cols-4">
            <FeatureTile
              icon={LockOutlined}
              title={t('home.secretTitle')}
              text={t('home.secretText')}
            />
            <FeatureTile
              icon={HistoryOutlined}
              title={t('home.auditTitle')}
              text={t('home.auditText')}
            />
            <FeatureTile
              icon={FilePdfOutlined}
              title={t('home.pdfTitle')}
              text={t('home.pdfText')}
            />
            <FeatureTile
              icon={PhoneOutlined}
              title={t('home.phoneTitle')}
              text={t('home.phoneText')}
            />
          </div>
        </Container>
      </section>

      <section className="py-16">
        <Container className="flex flex-col items-start gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-h3 font-semibold">{t('home.voterTitle')}</h2>
            <p className="mt-1 text-body text-text-secondary">{t('home.voterText')}</p>
          </div>
          <Link to="/vote" className="vk-btn vk-btn--secondary">
            {t('nav.vote')}
          </Link>
        </Container>
      </section>

      <CtaBand />
    </>
  );
}
