import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot, PubkeyIndexMap} from "@lodestar/state-transition";
import {IBeaconDb} from "../../db/interface.js";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, RegenErrorType, StateArchiveStrategy} from "./types.js";
import {replayBlocks} from "./utils/blockReplay.js";
import {DiffLayers} from "./diffLayers.js";
import {BinaryDiffVCDiffCodec} from "./utils/binaryDiffVCDiffCodec.js";
import {replayStateDiffsTill} from "./utils/diff.js";

const codec: IBinaryDiffCodec = new BinaryDiffVCDiffCodec();

export async function getHistoricalState(
  {slot}: {slot: Slot},
  {
    db,
    logger,
    config,
    metrics,
    diffLayers,
    pubkey2index,
  }: {
    config: BeaconConfig;
    db: IBeaconDb;
    pubkey2index: PubkeyIndexMap;
    logger: Logger;
    diffLayers: DiffLayers;
    metrics?: HistoricalStateRegenMetrics;
  }
): Promise<Uint8Array | null> {
  const regenTimer = metrics?.regenTime.startTimer();
  const strategy = diffLayers.getArchiveStrategy(slot);
  logger.debug("Fetching state archive", {strategy, slot});

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      const loadStateTimer = metrics?.loadStateTime.startTimer();
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: StateArchiveStrategy.Snapshot});
      return state;
    }
    case StateArchiveStrategy.Diff: {
      const {snapshotState} = await getLastSnapshotState(slot, {db, metrics, logger, diffLayers});
      if (!snapshotState) return null;
      const diffSlots = diffLayers.getArchiveLayers(slot);

      const state = await replayStateDiffsTill({diffSlots, snapshotState}, {db, codec});

      regenTimer?.({strategy: StateArchiveStrategy.Diff});

      return state;
    }
    case StateArchiveStrategy.BlockReplay: {
      const {diffState, diffSlots} = await getLastDiffState(slot, {diffLayers, db, metrics, logger});
      if (!diffState) return null;

      const state = replayBlocks(
        {toSlot: slot, lastFullSlot: diffSlots[diffSlots.length - 1], lastFullState: diffState},
        {config, db, metrics, pubkey2index}
      );
      regenTimer?.({strategy: StateArchiveStrategy.BlockReplay});

      return state;
    }
  }
}

export async function putHistoricalSate(
  {slot, state}: {slot: Slot; state: Uint8Array},
  {
    db,
    logger,
    metrics,
    diffLayers,
  }: {
    db: IBeaconDb;
    logger: Logger;
    metrics?: HistoricalStateRegenMetrics;
    diffLayers: DiffLayers;
  }
): Promise<void> {
  const strategy = diffLayers.getArchiveStrategy(slot);
  const epoch = computeEpochAtSlot(slot);
  logger.debug("Storing state archive", {strategy, slot});

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      metrics?.stateSnapshotSize.set(state.byteLength);
      await db.stateArchive.putBinary(slot, state);
      logger.verbose("State stored as snapshot", {
        epoch,
        slot,
      });
      break;
    }
    case StateArchiveStrategy.Diff: {
      const {snapshotState} = await getLastSnapshotState(slot, {db, metrics, logger, diffLayers});
      if (!snapshotState) return;
      const diffSlots = diffLayers.getArchiveLayers(slot);

      const previousState = await replayStateDiffsTill({diffSlots, snapshotState}, {db, codec});

      const diff = codec.compute(previousState, state);

      metrics?.stateDiffSize.set(diff.byteLength);

      await db.stateArchive.putBinary(slot, diff);

      logger.verbose("State stored as diff", {
        epoch,
        slot,
      });
      break;
    }
    case StateArchiveStrategy.BlockReplay: {
      logger.verbose("Skipping storage of historical state", {
        epoch,
        slot,
      });

      break;
    }
  }
}

async function getLastSnapshotState(
  slot: Slot,
  {
    db,
    metrics,
    logger,
    diffLayers,
  }: {db: IBeaconDb; metrics?: HistoricalStateRegenMetrics; logger?: Logger; diffLayers: DiffLayers}
): Promise<{snapshotState: Uint8Array | null; snapshotSlot: Slot}> {
  const snapshotSlot = diffLayers.getLastSlotForLayer(slot, 0);
  const snapshotState = await db.stateArchive.getBinary(snapshotSlot);
  if (!snapshotState) {
    logger?.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {snapshotSlot, snapshotState: null};
  }
  return {snapshotState, snapshotSlot};
}

async function getLastDiffState(
  slot: Slot,
  {
    db,
    metrics,
    logger,
    diffLayers,
  }: {db: IBeaconDb; metrics?: HistoricalStateRegenMetrics; logger: Logger; diffLayers: DiffLayers}
): Promise<{diffState: Uint8Array | null; diffSlots: Slot[]}> {
  const diffSlots = diffLayers.getArchiveLayers(slot);
  const snapshotState = await db.stateArchive.getBinary(diffSlots[0]);
  if (!snapshotState) return {diffState: null, diffSlots};

  try {
    const diffState = await replayStateDiffsTill({diffSlots, snapshotState}, {db, codec});
    return {diffSlots, diffState};
  } catch {
    logger.error("Missing the diff state", {diffSlots: diffSlots.join(",")});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlots, diffState: null};
  }
}

export async function getLastStoredState({
  db,
  diffLayers,
  metrics,
  logger,
}: {
  db: IBeaconDb;
  diffLayers: DiffLayers;
  metrics?: HistoricalStateRegenMetrics;
  logger?: Logger;
}): Promise<{state: Uint8Array | null; slot: Slot | null}> {
  const lastStoredSlot = await db.stateArchive.lastKey();
  if (lastStoredSlot === null) {
    return {state: null, slot: null};
  }

  const strategy = diffLayers.getArchiveStrategy(lastStoredSlot);
  switch (strategy) {
    case StateArchiveStrategy.Snapshot:
      return {state: await db.stateArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    case StateArchiveStrategy.Diff: {
      const {snapshotSlot, snapshotState} = await getLastSnapshotState(lastStoredSlot, {
        db,
        metrics,
        logger,
        diffLayers,
      });
      if (!snapshotState) {
        throw new Error(`Missing the snapshot state slot=${snapshotSlot}`);
      }
      return {
        state: await replayStateDiffsTill(
          {diffSlots: diffLayers.getArchiveLayers(lastStoredSlot), snapshotState},
          {db, codec}
        ),
        slot: lastStoredSlot,
      };
    }
    case StateArchiveStrategy.BlockReplay:
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
