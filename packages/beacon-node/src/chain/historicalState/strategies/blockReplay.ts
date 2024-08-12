import {
  BeaconStateAllForks,
  CachedBeaconStateAllForks,
  DataAvailableStatus,
  ExecutionPayloadStatus,
  PubkeyIndexMap,
  computeEpochAtSlot,
  createCachedBeaconState,
  stateTransition,
} from "@lodestar/state-transition";
import {BeaconConfig} from "@lodestar/config";
import {Logger} from "@lodestar/logger";
import {RootHex, Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";
import {HistoricalStateRegenMetrics, RegenErrorType, StateArchiveStrategy} from "../types.js";
import {validateStateArchiveStrategy} from "../utils/strategies.js";

/**
 * Populate a PubkeyIndexMap with any new entries based on a BeaconState
 */
export function syncPubkeyCache(state: BeaconStateAllForks, pubkey2index: PubkeyIndexMap): void {
  // Get the validators sub tree once for all the loop
  const validators = state.validators;

  const newCount = state.validators.length;
  for (let i = pubkey2index.size; i < newCount; i++) {
    const pubkey = validators.getReadonly(i).pubkey;
    pubkey2index.set(pubkey, i);
  }
}

/**
 * Get the nearest BeaconState at or before a slot
 */
export async function getNearestState(
  slot: number,
  config: BeaconConfig,
  db: IBeaconDb,
  pubkey2index: PubkeyIndexMap
): Promise<CachedBeaconStateAllForks> {
  const states = await db.stateArchive.values({limit: 1, lte: slot, reverse: true});
  if (!states.length) {
    throw new Error("No near state found in the database");
  }

  const state = states[0];
  syncPubkeyCache(state, pubkey2index);

  return createCachedBeaconState(
    state,
    {
      config,
      pubkey2index,
      index2pubkey: [],
    },
    {
      skipSyncPubkeys: true,
    }
  );
}

/**
 * Get and regenerate a historical state
 */
export async function getState(
  {
    slot,
    lastFullSlot,
    lastFullState,
  }: {
    slot: Slot;
    lastFullState: Uint8Array;
    lastFullSlot: Slot;
  },
  {
    config,
    db,
    pubkey2index,
    metrics,
  }: {config: BeaconConfig; db: IBeaconDb; pubkey2index: PubkeyIndexMap; metrics?: HistoricalStateRegenMetrics}
): Promise<Uint8Array> {
  const regenTimer = metrics?.regenTime.startTimer();

  if (lastFullSlot + 1 !== slot) {
    throw new Error(`Invalid full state slot to regen historical sate. expected=${slot - 1} actual=${lastFullSlot}`);
  }

  const transitionTimer = metrics?.stateTransitionTime.startTimer();

  let state = config.getForkTypes(slot).BeaconState.deserializeToViewDU(lastFullState);
  syncPubkeyCache(state, pubkey2index);
  state = createCachedBeaconState(
    state,
    {
      config,
      pubkey2index,
      index2pubkey: [],
    },
    {
      skipSyncPubkeys: true,
    }
  );

  let blockCount = 0;

  for await (const block of db.blockArchive.valuesStream({gt: lastFullSlot, lte: slot})) {
    try {
      state = stateTransition(
        state as CachedBeaconStateAllForks,
        block,
        {
          verifyProposer: false,
          verifySignatures: false,
          verifyStateRoot: false,
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailableStatus: DataAvailableStatus.available,
        },
        metrics
      );
    } catch (e) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.blockProcessing});
      throw e;
    }
    blockCount++;
    if (Buffer.compare(state.hashTreeRoot(), block.message.stateRoot) !== 0) {
      metrics?.regenErrorCount.inc({reason: RegenErrorType.invalidStateRoot});
    }
  }
  metrics?.stateTransitionBlocks.observe(blockCount);
  transitionTimer?.();

  const serializeTimer = metrics?.stateSerializationTime.startTimer();
  const stateBytes = state.serialize();
  serializeTimer?.();

  return stateBytes;
}

export async function putState(
  {slot, blockRoot}: {slot: Slot; blockRoot: RootHex},
  {logger}: {logger: Logger}
): Promise<void> {
  validateStateArchiveStrategy(slot, StateArchiveStrategy.BlockReplay);

  logger.verbose("State archive skipped for", {
    epoch: computeEpochAtSlot(slot),
    slot,
    blockRoot,
  });
}
