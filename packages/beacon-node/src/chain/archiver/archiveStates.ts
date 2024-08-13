import {CheckpointWithHex} from "@lodestar/fork-choice";
import {Logger} from "@lodestar/utils";
import {IBeaconDb} from "../../db/index.js";
import {IStateRegenerator, RegenCaller} from "../regen/interface.js";
import {IHistoricalStateRegen} from "../historicalState/types.js";

export interface StatesArchiverOpts {}

/**
 * Archives finalized states from active bucket to archive bucket.
 *
 * Only the new finalized state is stored to disk
 */
export class StatesArchiver {
  constructor(
    private readonly historicalSates: IHistoricalStateRegen | undefined,
    private readonly regen: IStateRegenerator,
    private readonly db: IBeaconDb,
    private readonly logger: Logger,
    private readonly opts: StatesArchiverOpts
  ) {}

  async maybeArchiveState(finalized: CheckpointWithHex): Promise<void> {
    await this.archiveState(finalized);
  }

  /**
   * Archives finalized states from active bucket to archive bucket.
   * Only the new finalized state is stored to disk
   */
  async archiveState(finalized: CheckpointWithHex): Promise<void> {
    const state = await this.regen.getCheckpointState(
      finalized,
      {dontTransferCache: true},
      RegenCaller.historicalState
    );
    await this.historicalSates?.storeHistoricalState(state.slot, state.serialize());
  }
}
