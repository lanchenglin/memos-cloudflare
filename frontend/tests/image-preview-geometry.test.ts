import { describe, expect, it } from "vitest";
import { constrainImageView } from "@/hooks/useImagePreviewGestures";

const image = { width: 200, height: 600 };
const stage = { width: 320, height: 600 };

describe("mobile image preview bounds", () => {
  it("clamps zoom below 100%", () => {
    expect(constrainImageView({ scale: 0.2, x: 20, y: 30 }, image, stage)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("clamps zoom above 400%", () => {
    expect(constrainImageView({ scale: 10, x: 0, y: 0 }, image, stage).scale).toBe(4);
  });
  it("keeps a narrow image horizontally centered", () => {
    expect(constrainImageView({ scale: 1.2, x: 100, y: 20 }, image, stage)).toEqual({ scale: 1.2, x: 0, y: 20 });
  });
  it("allows vertical inspection of a zoomed long screenshot", () => {
    expect(constrainImageView({ scale: 2, x: 0, y: 250 }, image, stage).y).toBe(250);
  });
  it("prevents dragging beyond all four image edges", () => {
    expect(constrainImageView({ scale: 2, x: 999, y: 999 }, image, stage)).toEqual({ scale: 2, x: 40, y: 300 });
    expect(constrainImageView({ scale: 2, x: -999, y: -999 }, image, stage)).toEqual({ scale: 2, x: -40, y: -300 });
  });
  it("recenters when zoom returns to 100%", () => {
    expect(constrainImageView({ scale: 1, x: 40, y: 300 }, image, stage)).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it("reclamps after orientation or viewport size changes", () => {
    expect(constrainImageView({ scale: 2, x: 40, y: 300 }, image, { width: 800, height: 1000 })).toEqual({ scale: 2, x: 0, y: 100 });
  });
  it("handles an image that has not loaded yet", () => {
    expect(constrainImageView({ scale: 2, x: 99, y: 99 }, { width: 0, height: 0 }, stage)).toEqual({ scale: 2, x: 0, y: 0 });
  });
});
