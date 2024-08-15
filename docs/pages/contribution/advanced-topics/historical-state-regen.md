---
title: Understanding Historical Sate Regeneration
---

# Understanding Historical Sate Regeneration

To run a blockchain client and establish consensus we need latest headers and forkchoice data. This operation does not require to historical data, specially after the epochs which are finalized. Storing the full state information for the finalized slots increase the storage requirement a lot and not suitable for running the node for long time.

## Solution

To overcome the storage problem for the archive nodes we implemented following algorithm to store and fetch the historical sates.

**Approach**

Assume we have following chain represents the state object every slot, with following diff layer configurations `1,2,3,5`. With assumption that we have 8 slots each epoch, The following configuration for layers implies:

1. We store the snapshot every 5th epoch.
2. We take diff every epoch, every 2nd epoch and every 3rd epoch.

Please see the following table for more understanding of these layers.

![historical-regen](docs/static/images/historical-regen/historical-regen.png)

These are the rules we follow:

1. If two layers frequency collide on one slot, we use the lower layer. Shown as the black border around slots.
2. The lowest layer is called the snapshot layer and we store fully serialized bytes of state object for that slot.
3. We always try to find the shortest hierarchical path to reach to the snapshot layer, starting from the top most layer.
4. For rest of the layers we recursively find the binary difference and only store the diffs on the upper layers.

Let's take few scenarios:

1. For slot `0` all layers collide, so we use the lowest layer which is the snapshot layer. So for the slot `0` we store and fetch the snapshot.
2. For slots (0-7) within first epoch we there is no intermediary layer, so we read the snapshot from slot `0`.
3. For slots (8-15) the path we follow is `8 -> 0`. e.g. For slot `12`, we apply diff from slot `8` on snapshot from slot `0`. Then we replay blocks from 9-12.
4. For slot `18` the shortest path to nearest snapshot is `16 -> 0` and rest will follow same as above.
5. For slot `34` the path we follow `32 -> 24 -> 0`.
6. For slot `41` path for the nearest snapshot slot is just one layer directly at slot `40`.

As you can see with this approach we can find a shorter paths with smaller number of diffs to apply, which generate the nearest full state and reduce the number of blocks we have to replay to reach to actual slot.


**Constants**

Following constants values are used for the implementation.

| Name                       | Value | Description                                     |
| -------------------------- | ----- | ----------------------------------------------- |
| DEFAULT_DIFF_LAYERS | 4, 64, 256, 1024  | Default value for layers         |
