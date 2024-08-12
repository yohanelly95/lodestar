import {Slot} from "@lodestar/types";
import {IBeaconDb} from "../../../db/interface.js";
import {IBinaryDiffCodec} from "../types.js";

export async function replayStateDiffsTill(
  {diffSlots, snapshotState}: {diffSlots: Slot[]; snapshotState: Uint8Array},
  {db, codec}: {db: IBeaconDb; codec: IBinaryDiffCodec}
): Promise<Uint8Array> {
  if (!codec.initialized) {
    await codec.init();
  }

  const intermediateStatesDiffs = await Promise.all(diffSlots.map((s) => db.stateArchive.getBinary(s)));

  let activeState: Uint8Array = snapshotState;
  for (const intermediateStateDiff of intermediateStatesDiffs) {
    // TODO: Handle the case if any intermediate diff state is missing
    if (!intermediateStateDiff) continue;
    activeState = codec.apply(activeState, intermediateStateDiff);
  }

  return activeState;
}
