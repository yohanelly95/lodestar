import {RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {BeaconConfig} from "@lodestar/config";
import {PubkeyIndexMap} from "@lodestar/state-transition";
import {IBeaconDb} from "../../db/interface.js";
import {IStateRegenerator, RegenCaller} from "../regen/interface.js";
import {HistoricalStateRegenMetrics, RegenErrorType, StateArchiveStrategy} from "./types.js";
import {getLastCompatibleSlot, getStateArchiveStrategy} from "./utils/strategies.js";
import * as snapshot from "./strategies/snapshot.js";
import * as diff from "./strategies/diff.js";
import * as skip from "./strategies/skip.js";

export async function getHistoricalState(
  {slot}: {slot: Slot},
  {
    db,
    logger,
    config,
    metrics,
    pubkey2index,
  }: {
    config: BeaconConfig;
    db: IBeaconDb;
    pubkey2index: PubkeyIndexMap;
    logger: Logger;
    metrics?: HistoricalStateRegenMetrics;
  }
): Promise<Uint8Array | null> {
  const strategy = getStateArchiveStrategy(slot);
  logger.debug("Fetching state archive", {strategy, slot});

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      return snapshot.getState({slot}, {db});
    }
    case StateArchiveStrategy.Diff: {
      const {snapshotSlot, snapshotState} = await getLastSnapshotState(slot, {db, metrics, logger});
      if (!snapshotState) return null;

      return diff.getState({slot, snapshotSlot, snapshotState}, {db});
    }
    case StateArchiveStrategy.Skip: {
      const {diffState, diffSlot} = await getLastDiffState(slot, {db, metrics, logger});
      if (!diffState) return null;

      return skip.getState(
        {slot, lastFullSlot: diffSlot, lastFullState: diffState},
        {config, db, metrics, pubkey2index}
      );
    }
  }
}

export async function putHistoricalSate(
  {slot, blockRoot}: {slot: Slot; blockRoot: RootHex},
  {
    regen,
    db,
    logger,
    metrics,
  }: {regen: IStateRegenerator; db: IBeaconDb; logger: Logger; metrics?: HistoricalStateRegenMetrics}
): Promise<void> {
  const strategy = getStateArchiveStrategy(slot);
  logger.debug("Storing state archive", {strategy, slot});

  switch (strategy) {
    case StateArchiveStrategy.Snapshot: {
      await snapshot.putState({slot, blockRoot}, {regen, db, logger});
      break;
    }
    case StateArchiveStrategy.Diff: {
      const {snapshotSlot, snapshotState} = await getLastSnapshotState(slot, {db, metrics, logger});
      if (!snapshotState) return;

      const state = await regen.getBlockSlotState(
        blockRoot,
        slot,
        {dontTransferCache: false},
        RegenCaller.historicalState
      );

      await diff.putState({slot, state: state.serialize(), snapshotSlot, snapshotState}, {db, logger});
      break;
    }
    case StateArchiveStrategy.Skip: {
      await skip.putState({slot, blockRoot}, {logger});
      break;
    }
  }
}

async function getLastSnapshotState(
  slot: Slot,
  {db, metrics, logger}: {db: IBeaconDb; metrics?: HistoricalStateRegenMetrics; logger: Logger}
): Promise<{snapshotState: Uint8Array | null; snapshotSlot: Slot}> {
  const snapshotSlot = getLastCompatibleSlot(slot, StateArchiveStrategy.Snapshot);
  const snapshotState = await snapshot.getState({slot: snapshotSlot}, {db});
  if (!snapshotState) {
    logger.error("Missing the snapshot state", {snapshotSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {snapshotSlot, snapshotState: null};
  }
  return {snapshotState, snapshotSlot};
}

async function getLastDiffState(
  slot: Slot,
  {db, metrics, logger}: {db: IBeaconDb; metrics?: HistoricalStateRegenMetrics; logger: Logger}
): Promise<{diffState: Uint8Array | null; diffSlot: Slot}> {
  const diffSlot = getLastCompatibleSlot(slot, StateArchiveStrategy.Diff);
  const {snapshotSlot, snapshotState} = await getLastSnapshotState(slot, {db, metrics, logger});
  if (!snapshotState) return {diffState: null, diffSlot};

  const diffState = await diff.getState({slot: diffSlot, snapshotSlot, snapshotState}, {db});
  if (!diffState) {
    logger.error("Missing the diff state", {diffSlot});
    metrics?.regenErrorCount.inc({reason: RegenErrorType.loadState});
    return {diffSlot, diffState: null};
  }
  return {diffSlot, diffState};
}

export async function getLastStoredState({
  db,
}: {
  db: IBeaconDb;
}): Promise<{state: Uint8Array | null; slot: Slot | null}> {
  const lastStoredSlot = await db.stateArchive.lastKey();
  if (lastStoredSlot === null) {
    return {state: null, slot: null};
  }

  const strategy = getStateArchiveStrategy(lastStoredSlot);
  switch (strategy) {
    case StateArchiveStrategy.Snapshot:
      return {state: await snapshot.getState({slot: lastStoredSlot}, {db}), slot: lastStoredSlot};
    case StateArchiveStrategy.Diff: {
      const snapshotSlot = getLastCompatibleSlot(lastStoredSlot, StateArchiveStrategy.Snapshot);
      const snapshotState = await snapshot.getState({slot: snapshotSlot}, {db});
      if (!snapshotState) {
        throw new Error(`Missing the snapshot state slot=${snapshotSlot}`);
      }
      return {
        state: await diff.getState({slot: lastStoredSlot, snapshotSlot, snapshotState}, {db}),
        slot: lastStoredSlot,
      };
    }
    case StateArchiveStrategy.Skip:
      throw new Error(`Unexpected stored slot for a non epoch slot=${lastStoredSlot}`);
  }
}
