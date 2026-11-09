// Development-only component gallery (Implementation Plan step 5) at /app/dev/components.
// Shows every design token and every component variant as it is built, in the theme in effect;
// use the toggle to check both. Not in production builds (see router.tsx). English labels only:
// this page is a developer tool, not product UI.
import { tokens } from '@vote-kidigit/shared';
import { Flex, Typography } from 'antd';
import type { CSSProperties, ReactNode } from 'react';
import { Logo, type LogoLockup } from '../components/Logo';
import { LogoMark } from '../components/LogoMark';
import { ThemeToggle } from '../components/ThemeToggle';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';
import { LanguageSwitch } from '../layout/LanguageSwitch';
import { GalleryComponents } from './GalleryComponents';

const swatch: CSSProperties = {
  width: 'var(--vk-space-16)',
  height: 'var(--vk-space-10)',
  borderRadius: 'var(--vk-radius-sm)',
  border: '1px solid var(--vk-border)',
};

const caption: CSSProperties = {
  fontSize: 'var(--vk-font-caption-size)',
  lineHeight: 'var(--vk-font-caption-line)',
  color: 'var(--vk-text-secondary)',
  fontFamily: 'var(--vk-font-mono)',
};

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginBottom: 'var(--vk-space-8)' }}>
      <Typography.Title level={2}>{title}</Typography.Title>
      {children}
    </section>
  );
}

function Swatch({ background, label }: { background: string; label: string }) {
  return (
    <Flex vertical gap="small">
      <div style={{ ...swatch, background }} />
      <span style={caption}>{label}</span>
    </Flex>
  );
}

const LOCKUPS: LogoLockup[] = ['horizontal-large', 'horizontal-small', 'mark', 'stacked'];

/** Spacing steps from smallest to largest ('0-5' would otherwise sort after the integer keys). */
const spaceSteps = Object.entries(tokens.space)
  .sort(([, a], [, b]) => a - b)
  .map(([step]) => step);

/** Design System 3.2: info and neutral have no solid variant. */
function tonePartsOf(tone: tokens.Tone): readonly ('fg' | 'bg' | 'border' | 'solid')[] {
  return tone === 'info' || tone === 'neutral'
    ? ['fg', 'bg', 'border']
    : ['fg', 'bg', 'border', 'solid'];
}

export default function ComponentGallery() {
  const theme = useEffectiveTheme();

  return (
    <main style={{ padding: 'var(--vk-space-6)', maxWidth: 1440 }}>
      <Flex justify="space-between" align="center">
        <Typography.Title level={1}>Component gallery</Typography.Title>
        <Flex align="center" gap="small">
          <span style={caption}>theme: {theme}</span>
          <ThemeToggle />
          <LanguageSwitch />
        </Flex>
      </Flex>

      <Section title="Logo">
        <Flex wrap gap="large" align="end">
          {[20, 28, 40, 64].map((size) => (
            <Flex key={size} vertical gap="small" align="center">
              <LogoMark size={size} />
              <span style={caption}>{size}</span>
            </Flex>
          ))}
        </Flex>
        <Flex wrap gap="large" align="center" style={{ marginTop: 'var(--vk-space-6)' }}>
          {LOCKUPS.map((lockup) => (
            <Flex key={lockup} vertical gap="small" align="center">
              <Logo lockup={lockup} />
              <span style={caption}>{lockup}</span>
            </Flex>
          ))}
        </Flex>
      </Section>

      <Section title="Primitive palettes">
        {Object.entries(tokens.palettes).map(([name, scale]) => (
          <Flex key={name} wrap gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
            {Object.entries(scale).map(([step, value]) => (
              <Swatch key={step} background={value} label={`${name} ${step}`} />
            ))}
          </Flex>
        ))}
      </Section>

      <Section title="Semantic colour tokens">
        <Flex wrap gap="middle">
          {tokens.semanticColorTokens.map((name) => (
            <Swatch key={name} background={`var(--vk-${name})`} label={`--vk-${name}`} />
          ))}
        </Flex>
      </Section>

      <Section title="Status tones">
        {tokens.tones.map((tone) => (
          <Flex key={tone} wrap gap="middle" style={{ marginBottom: 'var(--vk-space-4)' }}>
            {tonePartsOf(tone).map((part) => (
              <Swatch
                key={part}
                background={`var(--vk-${tone}-${part})`}
                label={`${tone}-${part}`}
              />
            ))}
            <span
              style={{
                alignSelf: 'center',
                padding: 'var(--vk-space-1) var(--vk-space-3)',
                borderRadius: 'var(--vk-radius-full)',
                border: `1px solid var(--vk-${tone}-border)`,
                background: `var(--vk-${tone}-bg)`,
                color: `var(--vk-${tone}-fg)`,
                fontSize: 'var(--vk-font-caption-size)',
                fontWeight: 500,
              }}
            >
              {tone}
            </span>
          </Flex>
        ))}
      </Section>

      <Section title="Typography (staff scale)">
        {Object.entries(tokens.typeScale).map(([name, spec]) => (
          <Flex key={name} gap="large" align="baseline">
            <span style={{ ...caption, width: 'var(--vk-space-20)' }}>{name}</span>
            <span
              style={{
                fontSize: `var(--vk-font-${name}-size)`,
                lineHeight: `var(--vk-font-${name}-line)`,
                fontWeight: spec.weight,
                fontFamily: name === 'code' ? 'var(--vk-font-mono)' : undefined,
                textTransform: name === 'overline' ? 'uppercase' : undefined,
                fontVariantNumeric: name === 'stat' ? 'tabular-nums' : undefined,
              }}
            >
              {name === 'code' ? 'K7M4-Q9XR' : name === 'stat' ? '3,214' : 'Uchaguzi wa 2027'}
            </span>
          </Flex>
        ))}
      </Section>

      <Section title="Spacing">
        {spaceSteps.map((step) => (
          <Flex
            key={step}
            gap="middle"
            align="center"
            style={{ marginBottom: 'var(--vk-space-1)' }}
          >
            <span style={{ ...caption, width: 'calc(var(--vk-space-20) + var(--vk-space-10))' }}>
              --vk-space-{step}
            </span>
            <div
              style={{
                width: `var(--vk-space-${step})`,
                height: 'var(--vk-space-3)',
                background: 'var(--vk-primary)',
              }}
            />
          </Flex>
        ))}
      </Section>

      <Section title="Radius and elevation">
        <Flex wrap gap="large">
          {Object.keys(tokens.radius).map((name) => (
            <Flex key={name} vertical gap="small" align="center">
              <div
                style={{
                  ...swatch,
                  background: 'var(--vk-surface)',
                  border: '1px solid var(--vk-border-strong)',
                  borderRadius: `var(--vk-radius-${name})`,
                }}
              />
              <span style={caption}>radius-{name}</span>
            </Flex>
          ))}
          {(['sm', 'md'] as const).map((name) => (
            <Flex key={name} vertical gap="small" align="center">
              <div
                style={{
                  ...swatch,
                  background: 'var(--vk-surface-raised)',
                  boxShadow: `var(--vk-shadow-${name})`,
                }}
              />
              <span style={caption}>shadow-{name}</span>
            </Flex>
          ))}
        </Flex>
      </Section>

      <Section title="Motion">
        <Flex vertical gap="small">
          {Object.entries(tokens.duration).map(([name, ms]) => (
            <span key={name} style={caption}>
              --vk-duration-{name}: {ms} ms
            </span>
          ))}
          {Object.entries(tokens.easing).map(([name, curve]) => (
            <span key={name} style={caption}>
              --vk-ease-{name}: {curve}
            </span>
          ))}
        </Flex>
      </Section>

      <Section title="Components">
        <Flex gap="large" align="center">
          <ThemeToggle />
          <span style={caption}>ThemeToggle (icon button M)</span>
          <LanguageSwitch />
          <span style={caption}>LanguageSwitch</span>
        </Flex>
      </Section>

      <Section title="Shared components">
        <GalleryComponents />
      </Section>
    </main>
  );
}
