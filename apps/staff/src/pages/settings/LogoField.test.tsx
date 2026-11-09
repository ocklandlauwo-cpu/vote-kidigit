import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { OrganizationSettings } from '@vote-kidigit/shared';
import { onboardingItems } from '@vote-kidigit/shared';
import { App } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, upload } from '../../api/client';
import { jsonResponse, renderWithProviders, routeFetch } from '../../test/render';
import { LogoField } from './LogoField';

// The XMLHttpRequest upload is replaced; DELETE goes through the stubbed fetch.
vi.mock('../../api/client', async (original) => ({
  ...(await original<typeof import('../../api/client')>()),
  upload: vi.fn(),
}));
const uploadMock = vi.mocked(upload);

const settings = (logoUrl: string | null): OrganizationSettings => ({
  id: '0190f0a1-2b3c-7d4e-8f90-0000000000d1',
  name: 'Chama',
  slug: 'chama',
  logoUrl,
  primaryColor: null,
  timeZone: 'Africa/Dar_es_Salaam',
  contactEmail: null,
  contactPhone: null,
  smsSenderId: null,
  helpPhone: null,
  sessionTimeoutMinutes: 15,
  archiveAfterDays: 90,
  onboarding: { dismissed: false, items: onboardingItems.map((key) => ({ key, done: false })) },
});

const png = (bytes = 1000) => new File([new Uint8Array(bytes)], 'nembo.png', { type: 'image/png' });

function renderLogo(url: string | null) {
  renderWithProviders(
    <App>
      <LogoField url={url} organizationName="Chama" />
    </App>,
  );
}

/** rc-upload replaces its input after every choice, so it is looked up each time. */
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;

describe('SYS-03 logo', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    uploadMock.mockReset();
  });

  it('uploads a dropped logo, showing its progress', async () => {
    let finish: (value: OrganizationSettings) => void = () => undefined;
    uploadMock.mockImplementation((_path, _file, options) => {
      options?.onProgress?.(40);
      return new Promise((resolve) => {
        finish = resolve;
      });
    });
    renderLogo(null);
    expect(screen.getByText('Buruta faili hapa au bofya kuchagua')).toBeInTheDocument();
    await userEvent.upload(fileInput(), png());
    expect(await screen.findByText('Inapakia nembo.png')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '40');
    expect(uploadMock.mock.calls[0]?.[0]).toBe('/v1/organization/logo');
    finish(settings('/api/v1/files/new'));
    expect(await screen.findByText('Nembo imehifadhiwa')).toBeInTheDocument();
  });

  it('refuses other types and large files without sending, and shows server refusals', async () => {
    const user = userEvent.setup({ applyAccept: false });
    renderLogo(null);
    await user.upload(fileInput(), new File(['<svg/>'], 'nembo.svg', { type: 'image/svg+xml' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tumia picha ya JPG au PNG chini ya MB 2',
    );
    await user.upload(fileInput(), png(2 * 1024 * 1024 + 1));
    expect(uploadMock).not.toHaveBeenCalled();

    uploadMock.mockRejectedValue(new ApiError(413, 'FILE_TOO_LARGE', 'x'));
    await user.upload(fileInput(), png());
    await waitFor(() => expect(uploadMock).toHaveBeenCalled());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tumia picha ya JPG au PNG chini ya MB 2',
    );
    expect(document.querySelector('.vk-dropzone')).toHaveAttribute('data-error', 'true');
  });

  it('shows the current logo and removes it', async () => {
    const stub = routeFetch({
      'DELETE /v1/organization/logo': () => jsonResponse(200, settings(null)),
    });
    vi.stubGlobal('fetch', stub.fetch);
    renderLogo('/api/v1/files/abc');
    expect(screen.getByRole('img', { name: 'Nembo ya Chama' })).toHaveAttribute(
      'src',
      '/api/v1/files/abc',
    );
    await userEvent.click(screen.getByRole('button', { name: /Ondoa/ }));
    expect(await screen.findByText('Nembo imeondolewa')).toBeInTheDocument();
    expect(stub.calls.some((c) => c.method === 'DELETE')).toBe(true);
  });
});
