import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { App } from 'antd';
import { useEffect } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api/client';
import { i18n } from '../i18n';
import { PhotoField } from './PhotoField';

// jsdom loads no images and has no canvas: the cropper reports a fixed area at once, and the
// crop itself (photo.ts, run in the browser check) returns a stand-in JPEG.
vi.mock('react-easy-crop', () => ({
  default: function FakeCropper({
    onCropComplete,
  }: {
    onCropComplete: (area: unknown, pixels: unknown) => void;
  }) {
    // Once, like the real cropper after the image loads (the callback changes every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => onCropComplete({}, { x: 0, y: 0, width: 50, height: 70 }), []);
    return <div data-testid="cropper" />;
  },
}));
const cropped = new Blob(['jpeg'], { type: 'image/jpeg' });
vi.mock('./photo', async (original) => ({
  ...(await original<typeof import('./photo')>()),
  cropToPhoto: vi.fn(() => Promise.resolve(cropped)),
}));

const png = (bytes = 1000) => new File([new Uint8Array(bytes)], 'asha.png', { type: 'image/png' });

function renderField(props: Partial<Parameters<typeof PhotoField>[0]> = {}) {
  const onUpload = vi.fn<(photo: Blob) => Promise<unknown>>(() => Promise.resolve());
  const onRemove = vi.fn(() => Promise.resolve());
  render(
    <I18nextProvider i18n={i18n}>
      <App>
        <PhotoField url={null} name="Asha" onUpload={onUpload} onRemove={onRemove} {...props} />
      </App>
    </I18nextProvider>,
  );
  return { onUpload, onRemove };
}

/** rc-upload replaces its input after every choice, so it is looked up each time. */
const fileInput = () => document.querySelector('input[type=file]') as HTMLInputElement;

const revokeObjectURL = vi.fn();

describe('PhotoField', () => {
  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:photo');
    URL.revokeObjectURL = revokeObjectURL;
  });
  afterEach(() => vi.clearAllMocks());

  it('accepts JPG and PNG only, as the input says', () => {
    renderField();
    expect(fileInput().accept).toBe('image/jpeg,image/png');
    expect(screen.getByRole('img', { name: 'Hakuna picha' })).toBeInTheDocument();
    expect(screen.getByText('JPG au PNG, hadi MB 2')).toBeInTheDocument();
  });

  it('refuses other types and files over 2 MB before cropping', async () => {
    const user = userEvent.setup({ applyAccept: false });
    const { onUpload } = renderField();
    await user.upload(fileInput(), new File(['a,b'], 'list.csv', { type: 'text/csv' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tumia picha ya JPG au PNG chini ya MB 2',
    );
    await user.upload(fileInput(), png(2 * 1024 * 1024 + 1));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Kata picha')).toBeNull();
    expect(onUpload).not.toHaveBeenCalled();
  });

  it('crops a chosen photo and uploads the result', async () => {
    const user = userEvent.setup();
    const { onUpload } = renderField();
    await user.upload(fileInput(), png());
    expect(await screen.findByText('Kata picha')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemin', '1');
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuemax', '3');
    await user.click(screen.getByRole('button', { name: 'Hifadhi' }));
    await waitFor(() => expect(onUpload).toHaveBeenCalledWith(cropped));
    // The dialog closes and the chosen image is released.
    await waitFor(() => expect(revokeObjectURL).toHaveBeenCalledWith('blob:photo'));
  });

  it('shows the server refusal under the field', async () => {
    const user = userEvent.setup();
    renderField({
      onUpload: () => Promise.reject(new ApiError(415, 'FILE_TYPE', 'x')),
    });
    await user.upload(fileInput(), png());
    await user.click(await screen.findByRole('button', { name: 'Hifadhi' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tumia picha ya JPG au PNG chini ya MB 2',
    );
  });

  it('shows the current photo and removes it', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderField({ url: '/api/v1/files/abc' });
    expect(screen.getByRole('img', { name: 'Picha ya Asha' })).toHaveAttribute(
      'src',
      '/api/v1/files/abc',
    );
    await user.click(screen.getByRole('button', { name: /Ondoa/ }));
    expect(onRemove).toHaveBeenCalled();
  });

  it('greys out both buttons while disabled', () => {
    renderField({ url: '/api/v1/files/abc', disabled: true });
    expect(screen.getByRole('button', { name: /Pakia picha/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Ondoa/ })).toBeDisabled();
  });
});
