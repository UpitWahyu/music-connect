import { beforeAll, afterAll, describe, it, expect } from "vitest";
import "dotenv/config";
import { redis, connectRedis } from "../redis/client.js";
import { prisma } from "../db/prisma.js";
import { queueService } from "./queue.service.js";
import type { Track } from "@music-connect/types";

const DEVICE = "test-device-queue";

function track(n: string): Track {
  return { id: `T-${n}`, provider: "youtube-music", title: `Lagu ${n}`, artist: "QA", duration: 120 };
}

beforeAll(async () => {
  await connectRedis();
  await prisma.device.upsert({
    where: { id: DEVICE },
    update: { userId: null, name: "QA Queue" },
    create: { id: DEVICE, name: "QA Queue", type: "qa", tokenHash: "x" },
  });
  await redis.flushdb(); // isolate: tests own the whole redis
});

afterAll(async () => {
  await prisma.device.deleteMany({ where: { id: DEVICE } }).catch(() => null);
  await redis.quit();
  await prisma.$disconnect();
});

describe("queue.add", () => {
  it("appends by default", async () => {
    const q = await queueService.add(DEVICE, track("A"));
    expect(q.map((i) => i.track.id)).toEqual(["T-A"]);
  });

  it("playNext after index 0 inserts at 1", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    await queueService.setIndex(DEVICE, 0);
    const q = await queueService.add(DEVICE, track("X"), "next");
    expect(q.map((i) => i.track.id)).toEqual(["T-A", "T-X", "T-B"]);
  });

  it("playNext in the middle inserts right after current", async () => {
    await queueService.set(DEVICE, []);
    for (const n of ["A", "B", "C", "D"]) await queueService.add(DEVICE, track(n));
    await queueService.setIndex(DEVICE, 2); // current = C
    const q = await queueService.add(DEVICE, track("E"), "next");
    expect(q.map((i) => i.track.id)).toEqual(["T-A", "T-B", "T-C", "T-E", "T-D"]);
  });

  it("playNext at the last index appends at the end", async () => {
    await queueService.set(DEVICE, []);
    for (const n of ["A", "B", "C"]) await queueService.add(DEVICE, track(n));
    await queueService.setIndex(DEVICE, 2); // current = C (last)
    const q = await queueService.add(DEVICE, track("Z"), "next");
    expect(q.map((i) => i.track.id)).toEqual(["T-A", "T-B", "T-C", "T-Z"]);
  });
});

describe("queue mutations", () => {
  it("addAuto appends with addedBy=auto", async () => {
    await queueService.set(DEVICE, []);
    await queueService.addAuto(DEVICE, track("R"));
    const q = await queueService.get(DEVICE);
    expect(q[0]?.addedBy).toBe("auto");
  });

  it("remove by stable item id", async () => {
    await queueService.set(DEVICE, []);
    const a = await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    const target = a[0]!.id;
    const q = await queueService.remove(DEVICE, target);
    expect(q.map((i) => i.track.id)).toEqual(["T-B"]);
  });

  it("clear empties the queue and resets the cursor", async () => {
    await queueService.add(DEVICE, track("A"));
    await queueService.setIndex(DEVICE, 0);
    const q = await queueService.clear(DEVICE);
    expect(q).toEqual([]);
    expect(await queueService.getIndex(DEVICE)).toBe(0);
  });

  it("reorder accepts a full permutation", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    await queueService.add(DEVICE, track("C"));
    const q0 = await queueService.get(DEVICE);
    const id = (t: string) => q0.find((i) => i.track.id === t)!.id;
    const q = await queueService.reorder(DEVICE, [id("T-C"), id("T-A"), id("T-B")]);
    expect(q.map((i) => i.track.id)).toEqual(["T-C", "T-A", "T-B"]);
  });

  it("reorder rejects a mismatched set", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    await expect(queueService.reorder(DEVICE, ["some-id"])).rejects.toThrow("ORDER_MISMATCH");
  });

  it("reorder rejects unknown ids", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await expect(queueService.reorder(DEVICE, ["nope"])).rejects.toThrow("ORDER_INVALID");
  });

  it("insertAtCurrent places before the current track", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    await queueService.setIndex(DEVICE, 1);
    await queueService.insertAtCurrent(DEVICE, track("M"));
    const q = await queueService.get(DEVICE);
    expect(q.map((i) => i.track.id)).toEqual(["T-A", "T-M", "T-B"]);
  });
});

describe("queue cursor", () => {
  it("advance moves to the next item", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    await queueService.setIndex(DEVICE, 0);
    const next = await queueService.advance(DEVICE);
    expect(next?.track.id).toBe("T-B");
    expect(await queueService.getIndex(DEVICE)).toBe(1);
  });

  it("advance past the end returns null", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.setIndex(DEVICE, 0);
    expect(await queueService.advance(DEVICE)).toBeNull();
  });

  it("placeCurrent finds an existing track", async () => {
    await queueService.set(DEVICE, []);
    await queueService.add(DEVICE, track("A"));
    await queueService.add(DEVICE, track("B"));
    const item = await queueService.placeCurrent(DEVICE, "T-B");
    expect(item?.track.id).toBe("T-B");
    expect(await queueService.getIndex(DEVICE)).toBe(1);
  });

  it("placeCurrent returns null for a missing track", async () => {
    expect(await queueService.placeCurrent(DEVICE, "T-MISSING")).toBeNull();
  });
});

describe("queue concurrency (no lost updates)", () => {
  it("20 parallel adds all survive", async () => {
    await queueService.set(DEVICE, []);
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => queueService.add(DEVICE, track(String(i)))),
    );
    const q = await queueService.get(DEVICE);
    expect(q.length).toBe(20); // no lost updates under contention
    const ids = new Set(q.map((i) => i.track.id));
    expect(ids.size).toBe(20);
  });

  it("parallel add + remove converge without corruption or lost updates", async () => {
    await queueService.set(DEVICE, []);
    for (const n of ["A", "B", "C", "D", "E"]) await queueService.add(DEVICE, track(n));
    const q0 = await queueService.get(DEVICE);
    const target = q0[0]!.id; // will be removed while two adds race
    await Promise.all([
      queueService.add(DEVICE, track("F")),
      queueService.add(DEVICE, track("G")),
      queueService.remove(DEVICE, target),
    ]);
    const q = await queueService.get(DEVICE);
    expect(q.length).toBe(6); // 5 + 2 adds − 1 remove — nothing lost
    expect(q.every((i) => i.id && i.track?.id)).toBe(true);
    expect(q.some((i) => i.id === target)).toBe(false);
  });
});
