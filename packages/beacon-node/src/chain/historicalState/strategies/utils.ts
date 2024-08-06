import {Slot} from "@lodestar/types";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {StateArchiveStrategy} from "../types.js";

export const SNAPSHOT_STATE_EVERY_EPOCH = 1000;

export function getStateArchiveStrategy(slot: Slot): StateArchiveStrategy {
  const epoch = computeEpochAtSlot(slot);
  const isStartOfEpoch = slot % SLOTS_PER_EPOCH === 0;

  if (isStartOfEpoch && epoch % SNAPSHOT_STATE_EVERY_EPOCH === 0) return StateArchiveStrategy.Snapshot;

  if (isStartOfEpoch) return StateArchiveStrategy.Diff;

  return StateArchiveStrategy.Skip;
}

export function validateStateArchiveStrategy(slot: Slot, expected: StateArchiveStrategy): void {
  const actual = getStateArchiveStrategy(slot);

  if (actual !== expected) {
    throw new Error(`Invalid archive strategy. slot=${slot} actual=${actual} expected=${expected}`);
  }
}
