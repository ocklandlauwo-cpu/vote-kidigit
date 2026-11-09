// Uploaded files (Backend Schema 7.6) and the photo format (PRD CAT-07).
import { z } from 'zod';

/** Photos of contesters, voters and categories: passport format 25 × 35 mm (5:7). */
export const PHOTO_WIDTH = 350;
export const PHOTO_HEIGHT = 490;
export const PHOTO_ASPECT = PHOTO_WIDTH / PHOTO_HEIGHT;

/** Image uploads accepted by the API: JPG or PNG up to MAX_UPLOAD_MB (2 MB). */
export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png'] as const;
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

/** The multipart field every upload endpoint reads. */
export const UPLOAD_FIELD = 'file';

/** Files are served only through GET /api/v1/files/:id after a permission check. */
export function fileUrl(fileId: string): string {
  return `/api/v1/files/${fileId}`;
}

/** Answer of an upload endpoint. */
export const UploadedFileSchema = z.object({
  id: z.uuid(),
  url: z.string(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
});
export type UploadedFile = z.infer<typeof UploadedFileSchema>;
