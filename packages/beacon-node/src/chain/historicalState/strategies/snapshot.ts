import {RootHex, Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {StateArchiveStrategy} from "../types.js";
import {QueuedStateRegenerator} from "../../regen/queued.js";
import {IBeaconDb} from "../../../db/interface.js";
import {RegenCaller} from "../../regen/interface.js";
import {validateStateArchiveStrategy} from "./utils.js";

export async function putState(
  {slot, blockRoot}: {slot: Slot; blockRoot: RootHex},
  {regen, db, logger}: {regen: QueuedStateRegenerator; db: IBeaconDb; logger: Logger}
): Promise<void> {
  validateStateArchiveStrategy(slot, StateArchiveStrategy.Snapshot);

  const state = await regen.getBlockSlotState(blockRoot, slot, {dontTransferCache: false}, RegenCaller.historicalState);

  await db.stateArchive.putBinary(slot, state.serialize());
  logger.verbose("State stored as snapshot", {
    epoch: computeEpochAtSlot(slot),
    slot,
    blockRoot,
  });
}

export async function getState({slot}: {slot: Slot}, {db}: {db: IBeaconDb}): Promise<Uint8Array | null> {
  return db.stateArchive.getBinary(slot);
}
