---
title: Understanding Historical Sate Regeneration
---

# Understanding Historical Sate Regeneration

To run a blockchain client and establish consensus we need latest headers and forkchoice data. This operation does not require to historical data, specially after the epochs which are finalized. Storing the full state information for the finalized slots increase the storage requirement a lot and not suitable for running the node for long time.

## Solution

To overcome the storage problem for the archive nodes we implemented following algorithm to store and fetch the historical sates.

**Approach**

Assume we have following chain represents the state object every slot. With following assumptions:

1. Assume that epoch consists of 5 slots each.
2. We decide to take snapshot every 3 epoch, so the slots will for the snapshots will be S0, S15, S30, S45 etc.
3. We decided to take state binary diff start of every epoch which is not the snapshot epoch.

So if the chain is grown till S12, we have to store only 3 objects, 1 full snapshot and 2 diffs. `S0` will be full serialized value of the beacon sate. `DIFF1` will be binary difference of `S5 - S0`. And `DIFF2` will be binary difference of `S10 - S5`.

Now if user request a state object for the S5, we will fetch nearest snapshot state and apply the diff at S5, so `S5 = S0 + DIFF1`. Similarly if user request the state object for S10 we have to fetch nearest snapshot sate and then apply all diffs in between, so `S10 = ((S0 + DIFF1) + DIFF2)`. What if user request any state in between those diffs, here we replay the blocks. e.g. If user request for `S8` we have to apply one diff and 3 blocks.

With this approach the storage requirement will be reduced and we have more responsive historical state generation.

```
 SNAPSHOT                                  DIFF1                                   DIFF2
     |                                       |                                       |
     |                                       |                                       |
     |                                       |                                       |
  +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+
  |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     |
  |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     | |     |
  +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+ +-----+
    S0      S1      S2      S3      S4      S5      S6      S7      S8      S9      S10     S11     S12

```

**Constants**

Following constants values are used for the implementation.

| Name                       | Value | Description                                     |
| -------------------------- | ----- | ----------------------------------------------- |
| SNAPSHOT_STATE_EVERY_EPOCH | 1000  | Take full snapshot every certain epochs         |
| DIFF_STATE_EVERY_EPOCH     | 10    | Take the binary difference every certain epochs |
