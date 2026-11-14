// Status tones and icons, row by row from Design System 3.3.
import {
  CheckCircleOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  FileDoneOutlined,
  InboxOutlined,
  LockOutlined,
  MailOutlined,
  MinusCircleOutlined,
  MinusOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  SendOutlined,
  StopOutlined,
  TrophyOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import type { ComponentType } from 'react';

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'violet';

export interface StatusSpec {
  tone: Tone;
  icon: ComponentType;
}

/** Design System 3.3, row by row. */
export const STATUS_SPECS = {
  event: {
    draft: { tone: 'neutral', icon: EditOutlined },
    scheduled: { tone: 'info', icon: ClockCircleOutlined },
    open: { tone: 'success', icon: PlayCircleOutlined },
    closed: { tone: 'warning', icon: LockOutlined },
    results_published: { tone: 'violet', icon: FileDoneOutlined },
    cancelled: { tone: 'danger', icon: StopOutlined },
    archived: { tone: 'neutral', icon: InboxOutlined },
  },
  category: {
    not_open: { tone: 'neutral', icon: ClockCircleOutlined },
    open: { tone: 'success', icon: PlayCircleOutlined },
    closed: { tone: 'warning', icon: LockOutlined },
    inactive: { tone: 'neutral', icon: MinusCircleOutlined },
  },
  code: {
    not_sent: { tone: 'neutral', icon: MinusCircleOutlined },
    sent: { tone: 'info', icon: SendOutlined },
    delivered: { tone: 'success', icon: CheckCircleOutlined },
    failed: { tone: 'danger', icon: CloseCircleOutlined },
  },
  voter: {
    voted: { tone: 'success', icon: CheckOutlined },
    not_voted: { tone: 'neutral', icon: MinusOutlined },
  },
  result: {
    winner: { tone: 'success', icon: TrophyOutlined },
    tie: { tone: 'warning', icon: WarningOutlined },
  },
  user: {
    invited: { tone: 'info', icon: MailOutlined },
    active: { tone: 'success', icon: CheckCircleOutlined },
    deactivated: { tone: 'neutral', icon: StopOutlined },
  },
  org: {
    active: { tone: 'success', icon: CheckCircleOutlined },
    suspended: { tone: 'warning', icon: PauseCircleOutlined },
  },
} as const satisfies Record<string, Record<string, StatusSpec>>;

export type StatusDomain = keyof typeof STATUS_SPECS;
export type StatusValue<D extends StatusDomain> = keyof (typeof STATUS_SPECS)[D] & string;
