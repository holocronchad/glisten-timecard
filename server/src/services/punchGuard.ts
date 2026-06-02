// Segregation of duties: nobody edits their OWN time entries — not a manager,
// not an owner. A manager who could rewrite their own punches could silently
// pad their own pay; the timecard's integrity depends on a second person
// making any correction. Enforced server-side on every punch mutation
// (PATCH / DELETE / POST /manage/punches): the actor (req.auth.user_id) is
// never allowed to be the punch's owner.
//
// Inert on today's roster — the only managers/owners are Anas + Dr. Dawood,
// both track_hours=false with zero punches. It is a forward-looking invariant:
// it keeps any manager who DOES have a timecard (an hourly lead promoted to
// manager, or a remote EA later given a clock) from being able to alter their
// own record. Added 2026-06-01 alongside Sky (Dr. Dawood's EA, manager access)
// so "she can't change her own hours" holds by construction, not by accident.
export function isOwnPunch(actorUserId: number, punchUserId: number): boolean {
  return actorUserId === punchUserId;
}

export const SELF_PUNCH_BLOCKED_MESSAGE =
  'You cannot change your own time entries. Ask another manager or the owner to make this correction.';
