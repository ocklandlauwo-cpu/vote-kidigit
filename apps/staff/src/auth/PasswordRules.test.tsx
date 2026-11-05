import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWithProviders } from '../test/render';
import { PasswordRules } from './PasswordRules';

const met = (rule: string) =>
  document.querySelector(`[data-rule="${rule}"]`)?.getAttribute('data-met');

describe('PasswordRules', () => {
  it('lists the five rules of App Flow 4.3, none met for an empty password', async () => {
    renderWithProviders(<PasswordRules password="" />);
    expect(await screen.findByText('Angalau herufi 10')).toBeInTheDocument();
    for (const rule of ['length', 'upper', 'lower', 'number', 'history']) {
      expect(met(rule)).toBe('false');
    }
    expect(screen.getByText('Lisiwe mojawapo ya manenosiri yako 5 ya mwisho')).toBeInTheDocument();
  });

  it('ticks rules as they are met', async () => {
    renderWithProviders(<PasswordRules password="kura2027" />);
    await screen.findByText('Angalau herufi 10');
    expect(met('length')).toBe('false');
    expect(met('upper')).toBe('false');
    expect(met('lower')).toBe('true');
    expect(met('number')).toBe('true');
  });

  it('meets all policy rules for a valid password', async () => {
    renderWithProviders(<PasswordRules password="Uchaguzi2027" />);
    await screen.findByText('Angalau herufi 10');
    for (const rule of ['length', 'upper', 'lower', 'number']) expect(met(rule)).toBe('true');
  });

  it('marks the history rule when the server refused a recent password', async () => {
    renderWithProviders(<PasswordRules password="Uchaguzi2027" reused />);
    await screen.findByText('Angalau herufi 10');
    expect(
      document.querySelector('[data-rule="history"] [aria-label="close-circle"]'),
    ).not.toBeNull();
  });

  it('can leave out the history rule', async () => {
    renderWithProviders(<PasswordRules password="" showHistory={false} />);
    await screen.findByText('Angalau herufi 10');
    expect(document.querySelector('[data-rule="history"]')).toBeNull();
  });
});
