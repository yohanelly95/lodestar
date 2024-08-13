import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/index.js";

export async function getSnapshotStateWithFallback(slot: Slot, db: IBeaconDb): Promise<Uint8Array | null> {
  const state = await db.stateSnapshotArchive.getBinary(slot);
  if (state) return state;

  // There is a possibility that node is started with checkpoint and initial snapshot
  // is not persisted on expected slot
  const lastSnapshotSlot = await db.stateSnapshotArchive.lastKey();
  if (lastSnapshotSlot !== null) return db.stateSnapshotArchive.getBinary(lastSnapshotSlot);

  return null;
}
