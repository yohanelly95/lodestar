import {Slot} from "@lodestar/types";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {StateArchiveStrategy} from "../types.js";

export const SNAPSHOT_STATE_EVERY_EPOCH = 1000;
export const DIFF_STATE_EVERY_EPOCH = 10;

export function getStateArchiveStrategy(slot: Slot): StateArchiveStrategy {
  const epoch = computeEpochAtSlot(slot);
  const isStartOfEpoch = slot % SLOTS_PER_EPOCH === 0;

  if (isStartOfEpoch && epoch % SNAPSHOT_STATE_EVERY_EPOCH === 0) return StateArchiveStrategy.Snapshot;

  if (isStartOfEpoch && epoch % DIFF_STATE_EVERY_EPOCH === 0) return StateArchiveStrategy.Diff;

  return StateArchiveStrategy.BlockReplay;
}

export function validateStateArchiveStrategy(slot: Slot, expected: StateArchiveStrategy): void {
  const actual = getStateArchiveStrategy(slot);

  if (actual !== expected) {
    throw new Error(`Invalid state archive strategy for slot=${slot}. actual=${actual} expected=${expected}`);
  }
}

export function getLastCompatibleSlot(slot: Slot, strategy: StateArchiveStrategy): Slot {
  const epoch = computeEpochAtSlot(slot);

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      try {
        validateStateArchiveStrategy(slot, StateArchiveStrategy.Snapshot);
        return computeStartSlotAtEpoch(epoch);
      } catch {
        return Math.max(0, computeStartSlotAtEpoch(epoch - SNAPSHOT_STATE_EVERY_EPOCH));
      }
    }
    case StateArchiveStrategy.Diff: {
      try {
        validateStateArchiveStrategy(slot, StateArchiveStrategy.Diff);
        return computeStartSlotAtEpoch(epoch);
      } catch {
        return Math.max(0, computeStartSlotAtEpoch(epoch - DIFF_STATE_EVERY_EPOCH));
      }
    }
    case StateArchiveStrategy.BlockReplay: {
      // Return second last slot if last slot is start of epoch
      if (computeStartSlotAtEpoch(epoch) === slot) return slot - 2;

      // Return last slot
      return slot - 1;
    }
  }
}
