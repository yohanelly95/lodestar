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
https://docs.google.com/spreadsheets/d/1mRQgv-FEQo9v0oaiX7kxqF2vfoFSRvWcRgMmkGW4lY8/edit?usp=sharing

**Constants**

Following constants values are used for the implementation.

| Name                       | Value | Description                                     |
| -------------------------- | ----- | ----------------------------------------------- |
| DEFAULT_DIFF_LAYERS | 10, 250, 500, 1000  | Default value for layers         |
