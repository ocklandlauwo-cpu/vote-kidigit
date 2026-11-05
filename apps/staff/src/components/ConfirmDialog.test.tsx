import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../test/render';
import { ConfirmDialog, type ConfirmDialogProps } from './ConfirmDialog';

function renderDialog(props: Partial<ConfirmDialogProps> = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = renderWithProviders(
    <ConfirmDialog
      open
      title="Funga upigaji kura wa AGM 2027?"
      body="Wapiga kura hawataweza kupiga kura tena. Hili haliwezi kutenduliwa."
      confirmLabel="Funga upigaji kura"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  );
  return { ...view, onConfirm, onCancel };
}

const confirmButton = () => screen.getByRole('button', { name: 'Funga upigaji kura' });

describe('ConfirmDialog', () => {
  it('confirm: shows title and consequence, focuses Cancel, confirms with the verb', async () => {
    const { onConfirm, onCancel } = renderDialog({ tone: 'warning' });
    expect(await screen.findByText('Funga upigaji kura wa AGM 2027?')).toBeInTheDocument();
    expect(screen.getByText(/hawataweza kupiga kura tena/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ghairi' })).toHaveFocus());
    expect(document.querySelector('[aria-label="warning"]')).not.toBeNull();
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith(undefined);
    await userEvent.click(screen.getByRole('button', { name: 'Ghairi' }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('info tone uses the info icon', async () => {
    renderDialog({ tone: 'info' });
    await screen.findByText('Funga upigaji kura wa AGM 2027?');
    expect(document.querySelector('[aria-label="info-circle"]')).not.toBeNull();
  });

  it('destructive: danger button, Escape cancels, overlay click does not', async () => {
    const { onCancel } = renderDialog({ tone: 'danger' });
    await screen.findByText('Funga upigaji kura wa AGM 2027?');
    expect(confirmButton()).toHaveClass('ant-btn-dangerous');
    const mask = document.querySelector('.ant-modal-wrap');
    if (mask) await userEvent.click(mask);
    expect(onCancel).not.toHaveBeenCalled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('type-to-confirm: enabled only when the text matches exactly (trimmed, case-sensitive)', async () => {
    const { onConfirm } = renderDialog({ tone: 'danger', typeToConfirm: 'AGM 2027' });
    const input = await screen.findByLabelText('Andika "AGM 2027" kuthibitisha');
    await waitFor(() => expect(input).toHaveFocus());
    expect(confirmButton()).toBeDisabled();
    await userEvent.type(input, 'agm 2027');
    expect(confirmButton()).toBeDisabled();
    await userEvent.tab();
    expect(await screen.findByText('Maandishi hayalingani')).toBeInTheDocument();
    await userEvent.clear(input);
    await userEvent.type(input, '  AGM 2027 ');
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it('reason required: at least 10 characters, passed to onConfirm trimmed', async () => {
    const { onConfirm } = renderDialog({ tone: 'danger', requireReason: true });
    const reason = await screen.findByLabelText('Sababu');
    expect(confirmButton()).toBeDisabled();
    await userEvent.type(reason, 'Fupi');
    await userEvent.tab();
    expect(await screen.findByText('Andika angalau herufi 10')).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    await userEvent.type(reason, ' sana, kikao kimeahirishwa ');
    expect(confirmButton()).toBeEnabled();
    await userEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledWith('Fupi sana, kikao kimeahirishwa');
  });

  it('type-to-confirm and reason together need both', async () => {
    renderDialog({ tone: 'danger', typeToConfirm: 'AGM 2027', requireReason: true });
    await userEvent.type(
      await screen.findByLabelText('Andika "AGM 2027" kuthibitisha'),
      'AGM 2027',
    );
    expect(confirmButton()).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Sababu'), 'Kikao kimeahirishwa');
    expect(confirmButton()).toBeEnabled();
  });

  it('loading: the action spins and the dialog cannot be dismissed', async () => {
    const { onCancel } = renderDialog({ tone: 'danger', loading: true });
    await screen.findByText('Funga upigaji kura wa AGM 2027?');
    // While loading, the accessible name also contains the spinner icon's label.
    expect(screen.getByRole('button', { name: /Funga upigaji kura/ })).toHaveClass(
      'ant-btn-loading',
    );
    expect(screen.getByRole('button', { name: 'Ghairi' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('starts empty each time it opens', async () => {
    const props = {
      title: 'T?',
      body: 'B',
      confirmLabel: 'Funga upigaji kura',
      requireReason: true,
      onConfirm: vi.fn(),
      onCancel: vi.fn(),
    };
    const { rerender } = renderWithProviders(<ConfirmDialog open {...props} />);
    await userEvent.type(await screen.findByLabelText('Sababu'), 'Sababu ndefu ya kutosha');
    rerender(<ConfirmDialog open={false} {...props} />);
    rerender(<ConfirmDialog open {...props} />);
    await waitFor(() => expect(screen.getByLabelText('Sababu')).toHaveValue(''));
  });
});
