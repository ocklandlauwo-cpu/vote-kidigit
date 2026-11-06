// Date pickers in the organization's time zone (PRD 4.3 rule 6). Ant Design's DatePicker shows
// and returns wall-clock times in the browser's zone; staff mean the organization's zone. These
// two helpers move a moment between "UTC instant" and "the same wall clock in the picker".
import dayjs, { type Dayjs } from 'dayjs';
import timezone from 'dayjs/plugin/timezone';
import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);
dayjs.extend(timezone);

const WALL = 'YYYY-MM-DDTHH:mm:ss';

/** A UTC instant as the picker value showing its wall clock in `timeZone`. */
export function toPicker(iso: string, timeZone: string): Dayjs {
  return dayjs(dayjs.utc(iso).tz(timeZone).format(WALL));
}

/** The wall clock chosen in the picker, read in `timeZone`, as a UTC ISO string. */
export function fromPicker(value: Dayjs, timeZone: string): string {
  return dayjs.tz(value.format(WALL), timeZone).toISOString();
}

/** The current wall clock in `timeZone`, as a picker value (to compare with picked values). */
export function nowInPicker(timeZone: string): Dayjs {
  return toPicker(new Date().toISOString(), timeZone);
}
