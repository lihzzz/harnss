import { describe, expect, it } from "vitest";
import { UsageActivity } from "./usage-activity";

describe("chat activity", () => {
  it("does not count time before interaction and stops after two idle minutes", () => {
    const activity = new UsageActivity();
    expect(activity.sample(1000)).toBeNull();
    activity.interact(1000);
    let total = 0;
    for (let now = 16_000; now <= 151_000; now += 15_000) {
      const interval = activity.sample(now);
      if (interval) total += interval[1] - interval[0];
    }
    expect(total).toBe(120_000);
    expect(activity.sample(166_000)).toBeNull();
  });

  it("ends at blur and starts a fresh interval when the user returns", () => {
    const activity = new UsageActivity();
    activity.interact(0);
    expect(activity.pause(5000)).toEqual([0, 5000]);
    expect(activity.sample(15000)).toBeNull();
    activity.interact(60000);
    expect(activity.sample(75000)).toEqual([60000, 75000]);
  });

  it("does not fill an idle gap when input arrives before a delayed heartbeat", () => {
    const activity = new UsageActivity();
    activity.interact(0);
    for (let now = 15_000; now <= 105_000; now += 15_000) activity.sample(now);
    expect(activity.interact(125_000)).toEqual([105_000, 120_000]);
    expect(activity.sample(135_000)).toEqual([125_000, 135_000]);
  });

  it("does not count sleep, including a key event before the delayed heartbeat", () => {
    const activity = new UsageActivity();
    activity.interact(0);
    expect(activity.sample(3_600_000)).toBeNull();
    activity.interact(3_601_000);
    expect(activity.sample(3_610_000)).toEqual([3_601_000, 3_610_000]);
    activity.interact(7_200_000);
    expect(activity.sample(7_210_000)).toEqual([7_200_000, 7_210_000]);
  });
});
