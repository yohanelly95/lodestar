import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, RegenErrorType} from "../types.js";
import {IBeaconDb} from "../../../db/interface.js";
import {DiffLayers} from "../diffLayers.js";
import {getSnapshotStateWithFallback} from "./snapshot.js";

export async function replayStateDiffs(
  {diffs, snapshotStateBytes}: {diffs: Uint8Array[]; snapshotStateBytes: Uint8Array},
  {codec}: {codec: IBinaryDiffCodec}
): Promise<Uint8Array> {
  if (!codec.initialized) {
    await codec.init();
  }

  let activeStateBytes: Uint8Array = snapshotStateBytes;
  for (const intermediateStateDiff of diffs) {
    activeStateBytes = codec.apply(activeStateBytes, intermediateStateDiff);
  }

  return activeStateBytes;
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
): Promise<{diffStateBytes: Uint8Array | null; diffSlots: Slot[]}> {
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
    return {diffSlots, diffStateBytes: null};
  }

  const snapshotStateBytes = await getSnapshotStateWithFallback(snapshotSlot, db);
  if (!snapshotStateBytes) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffStateBytes: null, diffSlots};
  }

  // Get all diffs except the first one which was a snapshot layer
  const diffs = await Promise.all(processableDiffs.map((s) => db.stateDiffArchive.getBinary(s)));
  const nonEmptyDiffs = diffs.filter((d) => d !== undefined && d !== null) as Uint8Array[];

  if (nonEmptyDiffs.length < processableDiffs.length) {
    logger?.warn("Missing some diff state", {diffPath: diffSlots.join(","), diffs: diffSlots.join(","), slot, epoch});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
  }

  try {
    const diffState = await replayStateDiffs({diffs: nonEmptyDiffs, snapshotStateBytes}, {codec});
    return {diffSlots, diffStateBytes: diffState};
  } catch (err) {
    logger?.error("Can not compute the diff state", {diffSlots: diffSlots.join(","), slot, epoch}, err as Error);
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffStateBytes: null};
  }
}
