import {describe, it, beforeEach, expect} from "vitest";
import {BeaconState, Epoch, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {BinaryDiffCodec} from "../../../../../src/chain/historicalState/utils/binaryDiffCodec.js";
import {generateState} from "../../../../utils/state.js";

const testsCases: {title: string; source: () => Uint8Array; input: () => Uint8Array}[] = [
  {
    title: "Simple string",
    source: () => Uint8Array.from(Buffer.from("Lodestar")),
    input: () => Uint8Array.from(Buffer.from("Lodestar Shines")),
  },
  {
    title: "Array of numbers",
    source: () => Uint8Array.from([10, 11, 12]),
    input: () => Uint8Array.from([10, 11, 12, 14, 15]),
  },
  {
    title: "An attestation",
    source: () => ssz.phase0.Attestation.serialize(ssz.phase0.Attestation.defaultValue()),
    input: () =>
      ssz.phase0.Attestation.serialize(
        attestationFromValues(
          4_000_000,
          "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaabbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          200_00,
          "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeffffffffffffffffffffffffffffffff"
        )
      ),
  },
  {
    title: "Phase 0 beacon state",
    source: () => {
      const state = generateState({slot: 0});
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
    input: () => {
      const state = generateState({slot: 0});
      state.balances.set(0, state.balances.get(0) + 1000);
      state.commit();
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
  },
];

describe("BinaryDiffCodec", () => {
  let codec: BinaryDiffCodec;

  beforeEach(async () => {
    codec = new BinaryDiffCodec();
    await codec.init();
  });

  it.each(testsCases)("$title", ({source, input}) => {
    const _source = source();
    const _input = input();

    const delta = codec.compute(_input, _source);
    const result = codec.apply(_source, delta);

    expect(delta).toBeInstanceOf(Uint8Array);
    expect(delta).not.toHaveLength(0);
    expect(result).toStrictEqual(_input);
  });
});

function attestationFromValues(
  slot: Slot,
  blockRoot: RootHex,
  targetEpoch: Epoch,
  targetRoot: RootHex
): phase0.Attestation {
  const attestation = ssz.phase0.Attestation.defaultValue();
  attestation.data.slot = slot;
  attestation.data.beaconBlockRoot = fromHex(blockRoot);
  attestation.data.target.epoch = targetEpoch;
  attestation.data.target.root = fromHex(targetRoot);
  return attestation;
}
