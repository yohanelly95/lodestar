import {Slot} from "@lodestar/types";
import {Logger} from "@lodestar/logger";
import {computeEpochAtSlot} from "@lodestar/state-transition";
import {HistoricalStateRegenMetrics, IBinaryDiffCodec, StateArchiveStrategy} from "../types.js";
import {IBeaconDb} from "../../../db/interface.js";
import {validateStateArchiveStrategy} from "../utils/strategies.js";
import {BinaryDiffVCDiffCodec} from "../utils/binaryDiffVCDiffCodec.js";

let codecInitialized: boolean = false;
const codec: IBinaryDiffCodec = new BinaryDiffVCDiffCodec();

export async function putState(
  {
    slot,
    state,
    snapshotSlot,
    snapshotState,
  }: {slot: Slot; state: Uint8Array; snapshotState: Uint8Array; snapshotSlot: Slot},
  {db, logger, metrics}: {db: IBeaconDb; logger: Logger; metrics?: HistoricalStateRegenMetrics}
): Promise<void> {
  validateStateArchiveStrategy(slot, StateArchiveStrategy.Diff);

  if (!codecInitialized) {
    await codec.init();
    codecInitialized = true;
  }
  const previousState = await replayStateDiffsTill({slot, snapshotSlot, snapshotState}, {db});
  const diff = codec.compute(previousState, state);

  metrics?.stateDiffSize.set(diff.byteLength);

  await db.stateArchive.putBinary(slot, diff);

  logger.verbose("State stored as diff", {
    epoch: computeEpochAtSlot(slot),
    slot,
  });
}

export async function getState(
  {slot, snapshotSlot, snapshotState}: {slot: Slot; snapshotState: Uint8Array; snapshotSlot: Slot},
  {db}: {db: IBeaconDb}
): Promise<Uint8Array | null> {
  if (!codecInitialized) {
    await codec.init();
    codecInitialized = true;
  }

  return replayStateDiffsTill({slot, snapshotSlot, snapshotState}, {db});
}

async function replayStateDiffsTill(
  {slot, snapshotSlot, snapshotState}: {slot: Slot; snapshotState: Uint8Array; snapshotSlot: Slot},
  {db}: {db: IBeaconDb}
): Promise<Uint8Array> {
  const intermediateSlots = await db.stateArchive.keys({gt: snapshotSlot, lte: slot});
  const intermediateStatesDiffs = await Promise.all(intermediateSlots.map((s) => db.stateArchive.getBinary(s)));

  let activeState: Uint8Array = snapshotState;
  for (const intermediateStateDiff of intermediateStatesDiffs) {
    // TODO: Handle the case if any intermediate diff state is missing
    if (!intermediateStateDiff) continue;
    activeState = codec.apply(activeState, intermediateStateDiff);
  }

  return activeState;
}
