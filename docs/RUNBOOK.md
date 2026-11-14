# Vote-Kidigit — Election runbook

For the people running an election on Vote-Kidigit: the organization's administrators and moderators, the help-phone staff, and the Vote-Kidigit operator. It covers the days before voting, voting day itself, and what happens after the close. Implementation Plan step 35; PRD 10.2.

**One rule above all: no deployment, server change or database work while an event is Open.** The deploy pipeline refuses on its own, but check anyway.

## 1. Before the event

### 1.1 One to two weeks before

- [ ] **Event set up** in the staff portal: name, start and end time (in the organization's time zone), categories with their rules, contesters with photos, voters imported from CSV. Fix every row the import preview marks.
- [ ] **Publish checklist** all green (event header → Publish). After publishing, categories, contesters and voters are locked. Until codes are sent, "Unpublish to Draft" still allows corrections.
- [ ] **SMS sender ID** approved by Beem for this organization (Settings → SMS sender ID). Without approval, SMS go out under the default sender or fail.
- [ ] **SMS balance** on the Beem account covers at least 3 SMS per voter: the code (often 2 SMS long), a reminder and the results message.
- [ ] **Staff accounts:** at least two moderators mapped to the event, so one can act if the other is unreachable. Observers mapped if wanted.
- [ ] **Help phone** number set (Settings → Help phone) and staffed during voting. It appears on voter screens.
- [ ] **Rehearsal** (first event of an organization): a rehearsal event on production with about 20 real phones: real SMS, web and kiosk votes, close, publish, PDF. Note every problem, then cancel and archive the rehearsal event.

### 1.2 At least 24 hours before opening

- [ ] **Send codes** (Messages tab → Send codes, or "Send codes now" when publishing). Sending early leaves time to fix failures (PRD 10.2).
- [ ] **Watch delivery** on the Messages tab: delivered, failed. Use **Resend failed** for failures. If more than 20% fail, the batch pauses on its own: check the numbers and the sender ID, then Resume or Cancel.
- [ ] **Voters without a code by the day before:** check their phone number on the Voters tab, correct it if needed (only before publishing), or plan to serve them at a kiosk.

### 1.3 On the morning

- [ ] **Kiosk devices** charged, on the venue Wi-Fi, opened from the staff portal (event header → More → Launch kiosk). Write down the kiosk PIN in a safe place. The staff session on that device ends at launch, by design.
- [ ] **Server check** by the operator: `bash deploy/verify-server.sh <domain>` passes, the last nightly backup is from last night.
- [ ] **Control room** open on a laptop (event → Live), with someone watching it.

## 2. During voting

### 2.1 What to watch in the control room (Live tab, refreshes every 30 s)

| You see | Meaning | Do |
|---|---|---|
| Turnout rising | Normal | Nothing |
| "No one has voted yet. Codes delivered: n" for long after opening | Voters may not have codes, or the link is not working | Test the voting link yourself; send a reminder (button on the Live tab) |
| Alert: repeated lockouts | Someone is guessing codes, or a voter keeps typing the wrong code | Call the voters you can identify; lockouts last 15 minutes |
| Alert: a message batch paused or failing | SMS provider or sender-ID problem | Messages tab: check, then Resume or Cancel |
| A category closing within 5 minutes | Normal for categories with their own window | Remind voters on site |

### 2.2 Common questions from voters

- **"I didn't get my code."**
  - Check the phone number on the Voters tab. If it's right, resend from the voter's panel (the same code is sent again).
  - At the venue, the kiosk sends the code to the voter's phone. With an officer's approval (kiosk PIN), it can go to another phone instead: at most 3 voters per other phone.
- **"It says my code is wrong."** Codes are 8 characters (dash optional, upper or lower case). Five wrong tries lock the voter out for 15 minutes. If a code was regenerated, the old one no longer works.
- **"It shows someone else's name."** The voter presses "Si mimi" (not me) and calls the help phone. Check the voter's details; this usually means a shared phone or a wrong number.
- **"I already voted?"** The status screen shows when each category was voted. A ballot can never be changed or deleted, by anyone.
- **"Did my vote count?"** If the voter saw "Kura yako imepokelewa", it was recorded. A vote is saved only on submit; if the connection dropped before, the voter signs in again and the ballot is still open for them.

### 2.3 If something goes wrong

| Problem | Do |
|---|---|
| Voting page slow or down | Operator: `pm2 status`, `pm2 logs vk-api --lines 100`, `/api/health`. Restart one process at a time with `pm2 reload vk-api` (no downtime). Never deploy |
| SMS provider down | Codes already delivered still work. Pause reminders; voters at the venue can use a kiosk |
| Voting must be extended | The end time is locked once the event is published. After the close, an administrator uses **Reopen** with a new end time and a reason (before results are published); voters who haven't voted get an SMS, and ballots already cast stay |
| Voting must stop | Event header → **Close now** (type the event name). Final: results are computed at once |
| Event must be cancelled | Event header → More → Cancel (event name and a reason). Voters are told by SMS; no results are published |
| Kiosk stolen or lost | Staff portal → Live → Kiosks → End kiosk. It stops working at once |

## 3. After the close

1. **Results** appear on the Results tab within a minute: winners, votes, %, skipped, threshold and quorum per category.
2. **Ties:** a banner lists them. For each, open "Resolve tie", choose who takes the seat (or "No winner") and write the reason (for example, the agreed method: a draw in front of all candidates). Every resolution is recorded.
3. **Publish results** (type the event name). This cannot be undone. Voters see results after signing in, and the public link works (Results tab: copy it, or disable it).
4. **Download the PDF** (Results tab → Download PDF): signature lines for the returning officer and two witnesses, the QR code to the public page and the verification hash. Print and sign it; hand it to the organization.
5. **Registered-voters report** if the organization needs it (Voters tab → Export: PDF or Excel). It shows voted / not voted, never choices.
6. **Operator:** confirm the nightly backup ran (`/var/backups/vote-kidigit/daily`) and the off-site copy finished.
7. **Archive** the event when the organization no longer needs it on the dashboard (More → Archive).

## 4. Contacts and access

| Role | Who | How |
|---|---|---|
| Organization administrator | _fill in_ | |
| Event moderators (2+) | _fill in_ | |
| Help phone | _fill in_ | |
| Vote-Kidigit operator (server) | _fill in_ | |
| Beem Africa support | — | Beem dashboard / support channel |

Database access during an Open event is limited to the named operator above, and logged (PRD NFR-23).

## 5. After the pilot

Write `docs/PILOT_REPORT.md`: turnout, SMS delivery rate (delivered / sent from the Messages tab), incidents and how they were handled, and feedback from staff and voters. Must-fix items become step 36.
