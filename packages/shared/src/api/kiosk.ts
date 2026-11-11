// Kiosk mode (PRD VOT-07, App Flow 10, Backend Schema 7.4, 7.5, 12.9): staff launch a kiosk on a
// device with a label and an exit PIN; the device identifies voters by membership ID and sends
// their existing code by SMS, to someone else's phone only with the staff PIN.
import { z } from 'zod';
import { VoterEventCardSchema } from './vote.js';

export const KioskPinSchema = z.string().regex(/^\d{4,6}$/, 'PIN of 4 to 6 digits');

/** POST /events/:eventId/kiosk-sessions (KSK-00). */
export const LaunchKioskRequestSchema = z
  .object({
    deviceLabel: z.string().trim().min(1).max(80),
    pin: KioskPinSchema,
  })
  .strict();
export type LaunchKioskRequest = z.infer<typeof LaunchKioskRequestSchema>;

export const LaunchKioskResponseSchema = z.object({
  id: z.uuid(),
  /** Shown once: the device keeps it in its address. */
  token: z.string(),
  url: z.string(),
});
export type LaunchKioskResponse = z.infer<typeof LaunchKioskResponseSchema>;

export const KioskSessionSchema = z.object({
  id: z.uuid(),
  deviceLabel: z.string(),
  launchedBy: z.string(),
  startedAt: z.iso.datetime(),
  lastSeenAt: z.iso.datetime().nullable(),
});
export type KioskSession = z.infer<typeof KioskSessionSchema>;

export const KioskSessionListSchema = z.object({ items: z.array(KioskSessionSchema) });
export type KioskSessionList = z.infer<typeof KioskSessionListSchema>;

// ---------------------------------------------------------------------------------------------
// The device (X-Kiosk-Token)
// ---------------------------------------------------------------------------------------------

/** GET /vote/kiosk/session: what KSK-01 shows. */
export const KioskDeviceSessionSchema = z.object({
  deviceLabel: z.string(),
  event: VoterEventCardSchema,
});
export type KioskDeviceSession = z.infer<typeof KioskDeviceSessionSchema>;

export const KioskExitRequestSchema = z.object({ pin: KioskPinSchema }).strict();
export type KioskExitRequest = z.infer<typeof KioskExitRequestSchema>;

/** POST /vote/kiosk/send-code (KSK-02, KSK-03, KSK-03a). */
export const KioskSendCodeRequestSchema = z
  .object({
    membershipId: z.string().trim().min(1).max(50),
    /** Someone else's phone (KSK-03a): needs the staff PIN. */
    alternatePhone: z.string().trim().min(9).max(20).optional(),
    staffPin: KioskPinSchema.optional(),
  })
  .strict()
  .refine((body) => !body.alternatePhone || body.staffPin, {
    path: ['staffPin'],
    message: 'An officer must approve another phone',
  });
export type KioskSendCodeRequest = z.infer<typeof KioskSendCodeRequestSchema>;

export const KioskSendCodeResponseSchema = z.discriminatedUnion('state', [
  z.object({
    state: z.literal('sent'),
    /** "Tumetuma msimbo kwa simu inayoishia {last 3 digits}". */
    phoneLast3: z.string(),
    /** Further sends allowed for this voter on this device ("Sijapata msimbo"). */
    sendsLeft: z.number().int(),
  }),
  /** Already voted in everything open: no code is sent (App Flow 10.3). */
  z.object({ state: z.literal('voted'), votedAt: z.iso.datetime() }),
]);
export type KioskSendCodeResponse = z.infer<typeof KioskSendCodeResponseSchema>;
