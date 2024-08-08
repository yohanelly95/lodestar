import {describe, it, vi, expect, afterEach} from "vitest";
import {when} from "vitest-when";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {Slot} from "@lodestar/types";
import {putState} from "../../../../../src/chain/historicalState/strategies/diff.js";
import {getMockedBeaconDb} from "../../../../mocks/mockedBeaconDb.js";
import {getMockedLogger} from "../../../../mocks/loggerMock.js";
import {BinaryDiffVCDiffCodec} from "../../../../../src/chain/historicalState/utils/binaryDiffVCDiffCodec.js";

const codec = new BinaryDiffVCDiffCodec();
await codec.init();

const strToUint8Array = (s: string): Uint8Array => Uint8Array.from(Buffer.from(s, "utf8"));

const statsData: Record<Slot, {value: Uint8Array; diff: Uint8Array}> = {
  0: {
    value: strToUint8Array("initial value"),
    diff: strToUint8Array(""),
  },
  [SLOTS_PER_EPOCH * 1]: {
    value: strToUint8Array("initial value + diff 1"),
    diff: codec.compute(strToUint8Array("initial value"), strToUint8Array("initial value + diff 1")),
  },
  [SLOTS_PER_EPOCH * 2]: {
    value: strToUint8Array("initial value + diff 1 + diff 2"),
    diff: codec.compute(strToUint8Array("initial value + diff 1"), strToUint8Array("initial value + diff 1 + diff 2")),
  },
  [SLOTS_PER_EPOCH * 3]: {
    value: strToUint8Array("initial value + diff 1 + diff 2 + diff 3"),
    diff: codec.compute(
      strToUint8Array("initial value + diff 1 + diff 2"),
      strToUint8Array("initial value + diff 1 + diff 2 + diff 3")
    ),
  },
};
const allSlots = Object.keys(statsData).map((s) => parseInt(s));

describe("strategies/diff", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(allSlots)("should store the correct diff for slot %i", async (slot) => {
    const snapshotSlot = 0;
    const snapshotState = statsData[snapshotSlot].value;
    const blockRoot = "0x0000";
    const db = getMockedBeaconDb();
    const logger = getMockedLogger();
    const regen = {
      getBlockSlotState: vi.fn().mockReturnValue({serialize: () => statsData[slot].value}),
    };

    db.stateArchive.keys.mockResolvedValue(allSlots.filter((s) => s > snapshotSlot && s < slot));
    for (const s of allSlots) {
      when(db.stateArchive.getBinary).calledWith(s).thenResolve(statsData[s].diff);
    }

    if (slot === 0) {
      await expect(putState({slot, snapshotState, snapshotSlot, blockRoot}, {db, logger, regen})).rejects.toThrow(
        "Invalid state archive strategy for slot=0. actual=snapshot expected=diff"
      );
    } else {
      await putState({slot, snapshotState, snapshotSlot, blockRoot}, {db, logger, regen});

      expect(db.stateArchive.putBinary).toHaveBeenCalledOnce();
      expect(db.stateArchive.putBinary).toHaveBeenCalledWith(slot, statsData[slot].diff);
    }
  });
});
