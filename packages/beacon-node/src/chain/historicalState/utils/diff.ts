import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, RegenErrorType} from "../types.js";
import {IBeaconDb} from "../../../db/interface.js";
import {DiffLayers} from "../diffLayers.js";

export async function replayStateDiffs(
  {diffs, snapshotState}: {diffs: Uint8Array[]; snapshotState: Uint8Array},
  {codec}: {codec: IBinaryDiffCodec}
): Promise<Uint8Array> {
  if (!codec.initialized) {
    await codec.init();
  }

  let activeState: Uint8Array = snapshotState;
  for (const intermediateStateDiff of diffs) {
    activeState = codec.apply(activeState, intermediateStateDiff);
  }

  return activeState;
}

export async function getDiffState(
  {slot, skipSlotDiff}: {slot: Slot; skipSlotDiff: boolean},
  {
    db,
    metrics,
    logger,
    diffLayers,
    codec,
  }: {
    db: IBeaconDb;
    metrics?: HistoricalStateRegenMetrics;
    logger?: Logger;
    diffLayers: DiffLayers;
    codec: IBinaryDiffCodec;
  }
): Promise<{diffState: Uint8Array | null; diffSlots: Slot[]}> {
  const epoch = computeEpochAtSlot(slot);
  const diffSlots = diffLayers.getArchiveLayers(slot);
  const processableDiffs = [...diffSlots];

  // Remove the snapshot slot
  const snapshotSlot = processableDiffs.shift();

  if (skipSlotDiff && processableDiffs[processableDiffs.length - 1] === slot) {
    processableDiffs.pop();
  }

  if (snapshotSlot === undefined) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffState: null};
  }

  const snapshotState = await db.stateArchive.getBinary(snapshotSlot);
  if (!snapshotState) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffState: null, diffSlots};
  }

  // Get all diffs except the first one which was a snapshot layer
  const diffs = await Promise.all(processableDiffs.map((s) => db.stateArchive.getBinary(s)));
  const nonEmptyDiffs = diffs.filter((d) => d !== undefined && d !== null) as Uint8Array[];

  if (nonEmptyDiffs.length < processableDiffs.length) {
    logger?.warn("Missing some diff state", {diffPath: diffSlots.join(","), diffs: diffSlots.join(","), slot, epoch});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
  }

  try {
    const diffState = await replayStateDiffs({diffs: nonEmptyDiffs, snapshotState}, {codec});
    return {diffSlots, diffState};
  } catch (err) {
    logger?.error("Can not compute the diff state", {diffSlots: diffSlots.join(","), slot, epoch}, err as Error);
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffState: null};
  }
}
