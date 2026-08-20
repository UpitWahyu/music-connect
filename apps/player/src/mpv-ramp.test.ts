import { describe, expect, it } from "vitest";
import { volumeRampPlan } from "./mpv.js";

describe("volumeRampPlan (smooth volume)", () => {
  it("plans a full-range ramp (~2% per step, duration ≈ rampMs)", () => {
    const plan = volumeRampPlan(0, 100, 900);
    expect(plan).not.toBeNull();
    expect(plan!.steps).toBe(50);
    expect(plan!.delta).toBeCloseTo(2);
    // 50 steps over 900ms → stepMs ≥ 25 floor
    expect(plan!.stepMs).toBeGreaterThanOrEqual(25);
  });

  it("returns null when the volume is already at the target (no ramp)", () => {
    expect(volumeRampPlan(40, 40, 900)).toBeNull();
    expect(volumeRampPlan(0, 0, 900)).toBeNull();
  });

  it("still ramps for a 1-step change (diff ≥ 1)", () => {
    expect(volumeRampPlan(39, 40, 900)).not.toBeNull();
  });

  it("clamps to mpv's 0..130 range", () => {
    const plan = volumeRampPlan(0, 999, 900)!;
    expect(plan.steps).toBe(60); // (130-0)/2 capped at 60
    expect(plan.delta).toBeGreaterThan(0);
  });

  it("ramps down too (negative delta)", () => {
    const plan = volumeRampPlan(80, 20, 900)!;
    expect(plan.delta).toBeLessThan(0);
    expect(plan.steps).toBe(30);
  });

  it("keeps a minimum of 2 steps for tiny changes", () => {
    const plan = volumeRampPlan(10, 12, 900)!;
    expect(plan.steps).toBe(2);
  });

  it("respects stepMs floor for very short ramps", () => {
    const plan = volumeRampPlan(0, 100, 50)!;
    expect(plan.stepMs).toBe(25);
    expect(plan.steps).toBe(50);
  });
});
