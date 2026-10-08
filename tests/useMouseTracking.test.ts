import { beforeEach, describe, expect, it, vi } from "vitest";

// Hook 宿主：不依赖 React 渲染，直接驱动 useRef/useCallback 语义
const host = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }));
vi.mock("react", () => ({
  useRef: (initial: unknown) => {
    const index = host.index++;
    if (!(index in host.slots)) host.slots[index] = { current: initial };
    return host.slots[index];
  },
  useCallback: (fn: unknown) => fn,
}));

import { useMouseTracking } from "../hooks/useMouseTracking";

function makeEvent(
  movementX: number,
  movementY: number,
  coalesced?: { movementX: number; movementY: number }[] | null,
  throws = false
): MouseEvent {
  return {
    movementX,
    movementY,
    getCoalescedEvents: () => {
      if (throws) throw new Error("unsupported");
      return coalesced ?? [];
    },
  } as unknown as MouseEvent;
}

beforeEach(() => {
  host.slots = [];
  host.index = 0;
});

describe("useMouseTracking", () => {
  it("accumulates movementX/Y across events and flush resets the buffer", () => {
    const { handleMove, flush } = useMouseTracking();
    handleMove(makeEvent(3, 4));
    handleMove(makeEvent(-1, 2));
    expect(flush()).toEqual({ dx: 2, dy: 6 });
    expect(flush()).toEqual({ dx: 0, dy: 0 });
  });

  it("prefers summed coalesced events when available", () => {
    const { handleMove, flush } = useMouseTracking();
    handleMove(
      makeEvent(99, 99, [
        { movementX: 5, movementY: 1 },
        { movementX: 2, movementY: 3 },
      ])
    );
    expect(flush()).toEqual({ dx: 7, dy: 4 });
  });

  it("falls back to movementX/Y when the coalesced sum is all zeros", () => {
    const { handleMove, flush } = useMouseTracking();
    handleMove(makeEvent(9, 8, [{ movementX: 0, movementY: 0 }]));
    expect(flush()).toEqual({ dx: 9, dy: 8 });
  });

  it("falls back when getCoalescedEvents throws", () => {
    const { handleMove, flush } = useMouseTracking();
    handleMove(makeEvent(6, 7, null, true));
    expect(flush()).toEqual({ dx: 6, dy: 7 });
  });

  it("treats missing movement values as zero", () => {
    const { handleMove, flush } = useMouseTracking();
    handleMove({ movementX: undefined, movementY: undefined } as unknown as MouseEvent);
    expect(flush()).toEqual({ dx: 0, dy: 0 });
  });
});
