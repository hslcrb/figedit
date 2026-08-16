import { describe, expect, it } from "vitest";
import { apply, identity, invert, multiply, rotation, scaling, translation } from "./matrix";

describe("matrix", () => {
  it("identity는 점을 그대로 둔다", () => {
    expect(apply(identity(), 3, 4)).toEqual([3, 4]);
  });

  it("translation이 이동한다", () => {
    expect(apply(translation(10, 20), 1, 2)).toEqual([11, 22]);
  });

  it("scaling이 확대한다", () => {
    expect(apply(scaling(2, 3), 4, 5)).toEqual([8, 15]);
  });

  it("rotation 90도가 점을 회전한다", () => {
    const [x, y] = apply(rotation(Math.PI / 2), 10, 0);
    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(10, 6);
  });

  it("multiply가 합성된다 (T * S)", () => {
    const m = multiply(translation(5, 0), scaling(2, 2));
    expect(apply(m, 1, 1)).toEqual([7, 2]);
  });

  it("invert는 역변환이다", () => {
    const m = multiply(translation(10, 20), scaling(2, 3));
    const inv = invert(m);
    const [x, y] = apply(inv, 30, 80);
    expect(x).toBeCloseTo(10, 6);
    expect(y).toBeCloseTo(20, 6);
  });
});
