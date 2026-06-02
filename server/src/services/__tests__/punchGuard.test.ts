import { describe, it, expect } from 'vitest';
import { isOwnPunch } from '../punchGuard';

// Segregation of duties: an actor may never mutate a punch they own. These
// tests pin the predicate the three /manage/punches handlers rely on.
describe('isOwnPunch', () => {
  it('blocks an actor editing their own punch', () => {
    expect(isOwnPunch(42, 42)).toBe(true);
  });

  it("allows an actor editing someone else's punch", () => {
    expect(isOwnPunch(42, 7)).toBe(false);
    expect(isOwnPunch(7, 42)).toBe(false);
  });

  it('uses strict equality (no cross-id coincidental block)', () => {
    expect(isOwnPunch(3, 30)).toBe(false);
    expect(isOwnPunch(1, 11)).toBe(false);
  });
});
