import { describe, it, expect } from "vitest";
import { speakable } from "@/lib/speakable";

describe("speakable", () => {
  it("reads units in Arabic", () => {
    expect(speakable("12.8V 200Ah")).toBe("12.8 فولت 200 أمبير ساعة");
    expect(speakable("50kW")).toBe("50 كيلو واط");
  });
  it("reads MPPT in Arabic letters", () => {
    expect(speakable("4 MPPT")).toBe("4 إم بي بي تي");
  });
  it("drops bracketed model codes", () => {
    expect(speakable("انفرتر سوليس (Solis-50K-5G-PLUS) قوي")).toBe("انفرتر سوليس قوي");
  });
});
