import { describe, expect, it } from "vitest";
import { batteryKwh, fuseRanks } from "@/lib/rank";

describe("fuseRanks", () => {
  it("puts an item found by several searches first", () => {
    expect(fuseRanks([["a", "b"], ["c", "b"], ["b"]])[0]).toBe("b");
  });
  it("keeps items found by only one search", () => {
    expect(fuseRanks([["a"], ["z"]]).sort()).toEqual(["a", "z"]);
  });
});

describe("batteryKwh", () => {
  it("51.2V 200Ah is 10.24 kWh", () => expect(batteryKwh(51.2, 200)).toBe(10.24));
  it("12.8V 200Ah is 2.56 kWh", () => expect(batteryKwh(12.8, 200)).toBe(2.56));
});
