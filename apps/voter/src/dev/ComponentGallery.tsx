// Development-only component gallery (Implementation Plan step 5) at /dev/components.
// Shows every design token on the voter scale and every voter component as it is built, in the
// theme in effect; use the toggle to check both. Not in production builds (see router.tsx).
// English labels only: this page is a developer tool, not product UI.
import { tokens } from '@vote-kidigit/shared';
import type { ReactNode } from 'react';
import { Logo, type LogoLockup } from '../components/Logo';
import { LogoMark } from '../components/LogoMark';
import { ThemeToggle } from '../components/ThemeToggle';
import { VoterComponents } from './VoterComponents';
import { useEffectiveTheme } from '../hooks/useEffectiveTheme';

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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-4 text-h2 font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Label({ children }: { children: ReactNode }) {
  return <span className="font-mono text-caption text-text-secondary">{children}</span>;
}

function Swatch({ background, label }: { background: string; label: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="h-10 w-16 rounded-sm border border-border" style={{ background }} />
      <Label>{label}</Label>
    </div>
  );
}

export default function ComponentGallery() {
  const theme = useEffectiveTheme();

  return (
    <main className="mx-auto max-w-300 p-6">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-h1 font-semibold">Component gallery (voter)</h1>
        <div className="flex items-center gap-2">
          <Label>theme: {theme}</Label>
          <ThemeToggle />
        </div>
      </div>

      <Section title="Logo">
        <div className="flex flex-wrap items-end gap-6">
          {[16, 20, 28, 40, 64].map((size) => (
            <div key={size} className="flex flex-col items-center gap-2">
              <LogoMark size={size} />
              <Label>{size}</Label>
            </div>
          ))}
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-6">
          {LOCKUPS.map((lockup) => (
            <div key={lockup} className="flex flex-col items-center gap-2">
              <Logo lockup={lockup} />
              <Label>{lockup}</Label>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Primitive palettes">
        {Object.entries(tokens.palettes).map(([name, scale]) => (
          <div key={name} className="mb-4 flex flex-wrap gap-3">
            {Object.entries(scale).map(([step, value]) => (
              <Swatch key={step} background={value} label={`${name} ${step}`} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="Semantic colour tokens">
        <div className="flex flex-wrap gap-3">
          {tokens.semanticColorTokens.map((name) => (
            <Swatch key={name} background={`var(--vk-${name})`} label={`--vk-${name}`} />
          ))}
        </div>
      </Section>

      <Section title="Status tones">
        {tokens.tones.map((tone) => (
          <div key={tone} className="mb-4 flex flex-wrap items-center gap-3">
            {tonePartsOf(tone).map((part) => (
              <Swatch
                key={part}
                background={`var(--vk-${tone}-${part})`}
                label={`${tone}-${part}`}
              />
            ))}
            <span
              className="rounded-full border px-3 py-1 text-caption font-medium"
              style={{
                borderColor: `var(--vk-${tone}-border)`,
                background: `var(--vk-${tone}-bg)`,
                color: `var(--vk-${tone}-fg)`,
              }}
            >
              {tone}
            </span>
          </div>
        ))}
      </Section>

      <Section title="Typography (voter scale)">
        {Object.entries(tokens.typeScale).map(([name, spec]) => (
          <div key={name} className="flex items-baseline gap-6">
            <span className="w-20 shrink-0">
              <Label>{name}</Label>
            </span>
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
              {name === 'code' ? 'K7M4-Q9XR' : name === 'stat' ? '3,214' : 'Chagua mgombea 1'}
            </span>
          </div>
        ))}
      </Section>

      <Section title="Spacing">
        {spaceSteps.map((step) => (
          <div key={step} className="mb-1 flex items-center gap-3">
            <span className="w-28 shrink-0">
              <Label>--vk-space-{step}</Label>
            </span>
            <div className="h-3 bg-brand" style={{ width: `var(--vk-space-${step})` }} />
          </div>
        ))}
      </Section>

      <Section title="Radius and elevation">
        <div className="flex flex-wrap gap-6">
          {Object.keys(tokens.radius).map((name) => (
            <div key={name} className="flex flex-col items-center gap-2">
              <div
                className="h-10 w-16 border border-border-strong bg-surface"
                style={{ borderRadius: `var(--vk-radius-${name})` }}
              />
              <Label>radius-{name}</Label>
            </div>
          ))}
          <div className="flex flex-col items-center gap-2">
            <div className="h-10 w-16 rounded-md bg-surface-raised shadow-sm" />
            <Label>shadow-sm</Label>
          </div>
          <div className="flex flex-col items-center gap-2">
            <div className="h-10 w-16 rounded-md bg-surface-raised shadow-md" />
            <Label>shadow-md</Label>
          </div>
        </div>
      </Section>

      <Section title="Brand colour (default organization)">
        <div className="flex flex-wrap gap-3">
          {(['brand', 'brand-hover', 'on-brand', 'brand-subtle'] as const).map((name) => (
            <Swatch key={name} background={`var(--vk-${name})`} label={`--vk-${name}`} />
          ))}
          <span className="self-center rounded-md bg-brand px-5 py-3 text-label font-medium text-on-brand">
            Tuma kura
          </span>
        </div>
      </Section>

      <Section title="Components">
        <div className="flex items-center gap-6">
          <ThemeToggle />
          <Label>ThemeToggle (40 px icon button)</Label>
        </div>
      </Section>

      <VoterComponents />
    </main>
  );
}
