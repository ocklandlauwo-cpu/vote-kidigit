// Calls of the voter flow (Backend Schema 12.11), validated with the shared schemas.
import {
  ConfirmIdentityResponseSchema,
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

export const signIn = (body: VoterSignInRequest) =>
  voterApi('/v1/vote/sign-in', { method: 'POST', body, schema: VoterSignInResponseSchema });

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
