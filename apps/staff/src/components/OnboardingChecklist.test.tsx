import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { onboardingItems, type OrganizationSettings } from '@vote-kidigit/shared';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { OnboardingChecklist } from './OnboardingChecklist';

function settings(done: string[], dismissed = false): OrganizationSettings {
  return {
    id: '0190f0a1-2b3c-7d4e-8f90-0000000000d1',
    name: 'Chama',
    slug: 'chama',
    logoUrl: null,
    primaryColor: null,
    timeZone: 'Africa/Dar_es_Salaam',
    contactEmail: null,
    contactPhone: null,
    smsSenderId: null,
    helpPhone: null,
    sessionTimeoutMinutes: 15,
    archiveAfterDays: 90,
    onboarding: {
      dismissed,
      items: onboardingItems.map((key) => ({ key, done: done.includes(key) })),
    },
  };
}

describe('setup checklist card (App Flow 7.4)', () => {
  it('lists the five items in order with progress, ticking the done ones', async () => {
    renderWithProviders(
      <OnboardingChecklist
        settings={settings(['timeZone', 'smsSender'])}
        canDismiss
        onDismiss={vi.fn()}
      />,
    );
    expect(await screen.findByText('Andaa shirika lako')).toBeInTheDocument();
    expect(screen.getByText('2 kati ya 5')).toBeInTheDocument();
    const items = [...document.querySelectorAll('[data-item]')];
    expect(items.map((el) => el.getAttribute('data-item'))).toEqual([...onboardingItems]);
    expect(items.map((el) => el.getAttribute('data-done'))).toEqual([
      'true',
      'false',
      'true',
      'false',
      'false',
    ]);
  });

  it('links each open item to its screen', async () => {
    renderWithProviders(
      <OnboardingChecklist settings={settings([])} canDismiss onDismiss={vi.fn()} />,
    );
    expect(
      await screen.findByRole('link', { name: 'Alika msimamizi wa uchaguzi' }),
    ).toHaveAttribute('href', '/users?invite=1');
    expect(screen.getByRole('link', { name: 'Thibitisha saa za eneo' })).toHaveAttribute(
      'href',
      '/settings',
    );
  });

  it('can be dismissed', async () => {
    const onDismiss = vi.fn();
    renderWithProviders(
      <OnboardingChecklist settings={settings([])} canDismiss onDismiss={onDismiss} />,
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Ficha' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('is gone once dismissed or complete', () => {
    const { container, rerender } = renderWithProviders(
      <OnboardingChecklist settings={settings([], true)} canDismiss onDismiss={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
    rerender(
      <OnboardingChecklist
        settings={settings([...onboardingItems])}
        canDismiss
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByText('Andaa shirika lako')).toBeNull();
  });
});
