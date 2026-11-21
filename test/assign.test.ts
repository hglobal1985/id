// Which positions an App may hand out (ADR 0033): pure rules, no database.
import { describe, it, expect } from "vitest";
import { APP_ASSIGNABLE_ROLES, isAppAssignable, planAssignment } from "../src/admin/assign";
import { ROLE_GRANTS, grantsOf } from "../src/admin/roles";

const boss = grantsOf(["super_admin"]);

describe("planAssignment", () => {
  it("only the general positions are assignable; super_admin and secretary never", () => {
    expect([...APP_ASSIGNABLE_ROLES]).toEqual(["reviewer", "president", "course", "sound", "ticket", "activity"]);
    expect(isAppAssignable("super_admin")).toBe(false);
    expect(isAppAssignable("secretary")).toBe(false);
    expect(isAppAssignable("sound")).toBe(true);
  });

  it("adds and removes assignable positions and keeps the ones an App may not touch", () => {
    const p = planAssignment(["secretary", "sound"], ["course", "sound"], boss);
    expect(p).toEqual({ ok: true, roles: ["secretary", "course", "sound"], added: ["course"], removed: [], changed: true });
    const q = planAssignment(["super_admin", "sound"], [], boss);
    expect(q).toEqual({ ok: true, roles: ["super_admin"], added: [], removed: ["sound"], changed: true });
  });

  it("the same list is no change; duplicates count once", () => {
    const p = planAssignment(["sound"], ["sound", "sound"], boss);
    expect(p).toMatchObject({ ok: true, roles: ["sound"], changed: false });
  });

  it("nobody hands out a position whose permissions they do not hold", () => {
    const weak = grantsOf(["sound"]);
    expect(planAssignment([], ["reviewer"], weak)).toEqual({ ok: false, reason: "cannot_grant", role: "reviewer" });
    // a position the caller already covers is fine; removing never needs the permissions
    expect(planAssignment(["reviewer"], [], weak)).toMatchObject({ ok: true, changed: true });
    expect(ROLE_GRANTS.reviewer.length).toBeGreaterThan(0);
  });
});
