// PUB-02 Features (App Flow 4.1): one section per PRD module (PRD 5.1–5.13), the ballot
// screenshot, and Request a demo.
import {
  BarChartOutlined,
  CalendarOutlined,
  FileProtectOutlined,
  IdcardOutlined,
  MessageOutlined,
  MobileOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { Container, CtaBand, FeatureTile, PageIntro, PhoneMock } from './PublicParts';
import { type PublicKey, usePageTitle, usePublicText } from './publicText';

const FEATURES = [
  [TeamOutlined, 'features.orgTitle', 'features.orgText'],
  [SafetyCertificateOutlined, 'features.staffTitle', 'features.staffText'],
  [CalendarOutlined, 'features.eventsTitle', 'features.eventsText'],
  [UnorderedListOutlined, 'features.rulesTitle', 'features.rulesText'],
  [IdcardOutlined, 'features.votersTitle', 'features.votersText'],
  [MessageOutlined, 'features.smsTitle', 'features.smsText'],
  [MobileOutlined, 'features.channelsTitle', 'features.channelsText'],
  [BarChartOutlined, 'features.resultsTitle', 'features.resultsText'],
  [FileProtectOutlined, 'features.reportsTitle', 'features.reportsText'],
] as const satisfies readonly (readonly [unknown, PublicKey, PublicKey])[];

export default function FeaturesPage() {
  const { t } = usePublicText();
  usePageTitle('meta.features');
  return (
    <>
      <Container className="py-12 lg:py-16">
        <PageIntro title={t('features.title')} lead={t('features.lead')} />
        <div className="mt-12 grid gap-10 md:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(([icon, title, text]) => (
            <FeatureTile key={title} icon={icon} title={t(title)} text={t(text)} level={2} />
          ))}
        </div>
      </Container>
      <section className="border-t border-border bg-surface py-16">
        <Container>
          <figure className="flex flex-col items-center gap-4">
            <PhoneMock />
            <figcaption className="text-body-sm text-text-secondary">
              {t('features.shotCaption')}
            </figcaption>
          </figure>
        </Container>
      </section>
      <CtaBand />
    </>
  );
}
