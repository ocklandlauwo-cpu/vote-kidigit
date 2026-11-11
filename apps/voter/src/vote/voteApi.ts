// Calls of the voter flow (Backend Schema 12.11), validated with the shared schemas.
import {
  ConfirmIdentityResponseSchema,
  KioskDeviceSessionSchema,
  type KioskSendCodeRequest,
  KioskSendCodeResponseSchema,
  NotMeResponseSchema,
  type SubmitBallotRequest,
  SubmitBallotResponseSchema,
  VoterBallotSchema,
  VoterEventCardSchema,
  type VoterSignInRequest,
  VoterSignInResponseSchema,
  VoterStatusSchema,
} from '@vote-kidigit/shared';
import { voterApi } from '../api/client';

export const fetchEventCard = (eventId: string) =>
  voterApi(`/v1/vote/events/${eventId}`, { schema: VoterEventCardSchema });

export const signIn = (body: VoterSignInRequest, kioskToken?: string) =>
  voterApi('/v1/vote/sign-in', {
    method: 'POST',
    body,
    headers: kioskToken ? { 'X-Kiosk-Token': kioskToken } : undefined,
    schema: VoterSignInResponseSchema,
  });

// Kiosk device (Backend Schema 12.9)
const kiosk = (token: string) => ({ 'X-Kiosk-Token': token });

export const fetchKioskSession = (token: string) =>
  voterApi('/v1/vote/kiosk/session', { headers: kiosk(token), schema: KioskDeviceSessionSchema });

export const kioskHeartbeat = (token: string) =>
  voterApi('/v1/vote/kiosk/heartbeat', { method: 'POST', headers: kiosk(token) });

export const kioskExit = (token: string, pin: string) =>
  voterApi('/v1/vote/kiosk/exit', { method: 'POST', headers: kiosk(token), body: { pin } });

export const kioskSendCode = (token: string, body: KioskSendCodeRequest) =>
  voterApi('/v1/vote/kiosk/send-code', {
    method: 'POST',
    headers: kiosk(token),
    body,
    schema: KioskSendCodeResponseSchema,
  });

export const confirmIdentity = (token: string) =>
  voterApi('/v1/vote/confirm-identity', {
    method: 'POST',
    token,
    schema: ConfirmIdentityResponseSchema,
  });

export const notMe = (token: string) =>
  voterApi('/v1/vote/not-me', { method: 'POST', token, schema: NotMeResponseSchema });

export const fetchStatus = (token: string) =>
  voterApi('/v1/vote/status', { token, schema: VoterStatusSchema });

export const fetchBallot = (token: string) =>
  voterApi('/v1/vote/ballot', { token, schema: VoterBallotSchema });

export const submitBallot = (token: string, body: SubmitBallotRequest) =>
  voterApi('/v1/vote/ballot', {
    method: 'POST',
    token,
    body,
    schema: SubmitBallotResponseSchema,
  });

export const finish = (token: string) => voterApi('/v1/vote/finish', { method: 'POST', token });
