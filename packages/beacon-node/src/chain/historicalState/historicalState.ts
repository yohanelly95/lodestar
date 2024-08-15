import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {computeEpochAtSlot, PubkeyIndexMap} from "@lodestar/state-transition";
import {IBeaconDb} from "../../db/interface.js";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, StateArchiveStrategy} from "./types.js";
import {replayBlocks} from "./utils/blockReplay.js";
import {DiffLayers} from "./diffLayers.js";
import {BinaryDiffVCDiffCodec} from "./utils/binaryDiffVCDiffCodec.js";
import {getDiffState} from "./utils/diff.js";

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
  const epoch = computeEpochAtSlot(slot);
  const strategy = diffLayers.getArchiveStrategy(slot);
  logger.debug("Fetching state archive", {strategy, slot, epoch});

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      const loadStateTimer = metrics?.loadStateTime.startTimer();
      const state = await db.stateSnapshotArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: StateArchiveStrategy.Snapshot});
      return state;
    }
    case StateArchiveStrategy.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );
      regenTimer?.({strategy: StateArchiveStrategy.Diff});

      return diffState;
    }
    case StateArchiveStrategy.BlockReplay: {
      const {diffStateBytes, diffSlots} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );
      if (!diffStateBytes) return null;

      const state = replayBlocks(
        {toSlot: slot, lastFullSlot: diffSlots[diffSlots.length - 1], lastFullStateBytes: diffStateBytes},
        {config, db, metrics, pubkey2index}
      );

      regenTimer?.({strategy: StateArchiveStrategy.BlockReplay});

      return state;
    }
  }
}

export async function putHistoricalState(
  {slot, stateBytes}: {slot: Slot; stateBytes: Uint8Array},
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
  const epoch = computeEpochAtSlot(slot);
  const strategy = diffLayers.getArchiveStrategy(slot);

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      metrics?.stateSnapshotSize.set(stateBytes.byteLength);
      await db.stateSnapshotArchive.putBinary(slot, stateBytes);
      logger.verbose("State stored as snapshot", {
        epoch,
        slot,
      });
      break;
    }
    case StateArchiveStrategy.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot, skipSlotDiff: true},
        {db, metrics, logger, diffLayers, codec}
      );

      if (!diffState) return;

      const diff = codec.compute(diffState, stateBytes);

      metrics?.stateDiffSize.set(diff.byteLength);

      await db.stateDiffArchive.putBinary(slot, diff);

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
}): Promise<{stateBytes: Uint8Array | null; slot: Slot | null}> {
  const lastStoredSlot = await db.stateDiffArchive.lastKey();
  if (lastStoredSlot === null) {
    return {stateBytes: null, slot: null};
  }

  const strategy = diffLayers.getArchiveStrategy(lastStoredSlot);

  switch (strategy) {
    case StateArchiveStrategy.Snapshot:
      return {stateBytes: await db.stateSnapshotArchive.getBinary(lastStoredSlot), slot: lastStoredSlot};
    case StateArchiveStrategy.Diff: {
      const {diffStateBytes: diffState} = await getDiffState(
        {slot: lastStoredSlot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );

      return {
        stateBytes: diffState,
        slot: lastStoredSlot,
      };
    }
    case StateArchiveStrategy.BlockReplay:
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
