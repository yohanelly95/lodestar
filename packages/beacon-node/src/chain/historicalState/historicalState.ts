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
      const state = await db.stateArchive.getBinary(slot);
      loadStateTimer?.();
      regenTimer?.({strategy: StateArchiveStrategy.Snapshot});
      return state;
    }
    case StateArchiveStrategy.Diff: {
      const {diffState} = await getDiffState({slot, skipSlotDiff: false}, {db, metrics, logger, diffLayers, codec});
      regenTimer?.({strategy: StateArchiveStrategy.Diff});

      return diffState;
    }
    case StateArchiveStrategy.BlockReplay: {
      const {diffState, diffSlots} = await getDiffState(
        {slot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );
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
  const epoch = computeEpochAtSlot(slot);
  const strategy = diffLayers.getArchiveStrategy(slot);

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
      const {diffState} = await getDiffState({slot, skipSlotDiff: true}, {db, metrics, logger, diffLayers, codec});

      if (!diffState) return;

      const diff = codec.compute(diffState, state);

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
      const {diffState} = await getDiffState(
        {slot: lastStoredSlot, skipSlotDiff: false},
        {db, metrics, logger, diffLayers, codec}
      );

      return {
        state: diffState,
        slot: lastStoredSlot,
      };
    }
    case StateArchiveStrategy.BlockReplay:
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
