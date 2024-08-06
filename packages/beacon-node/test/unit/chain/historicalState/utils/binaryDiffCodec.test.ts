import fs from "node:fs";
import path from "node:path";
import {describe, it, expect, beforeAll} from "vitest";
import {BeaconState, Epoch, phase0, RootHex, Slot, ssz} from "@lodestar/types";
import {fromHex} from "@lodestar/utils";
import {ForkName} from "@lodestar/params";
import {BinaryDiffVCDiffCodec} from "../../../../../src/chain/historicalState/utils/binaryDiffVCDiffCodec.js";
import {generateState} from "../../../../utils/state.js";
import {IBinaryDiffCodec} from "../../../../../src/chain/historicalState/types.js";

const testsCases: {title: string; base: () => Uint8Array; changed: () => Uint8Array}[] = [
  {
    title: "Simple string",
    base: () => Uint8Array.from(Buffer.from("Lodestar")),
    changed: () => Uint8Array.from(Buffer.from("Lodestar Shines")),
  },
  {
    title: "Array of numbers",
    base: () => Uint8Array.from([10, 11, 12]),
    changed: () => Uint8Array.from([10, 11, 12, 14, 15]),
  },
  {
    title: "An attestation",
    base: () => ssz.phase0.Attestation.serialize(ssz.phase0.Attestation.defaultValue()),
    changed: () =>
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
    base: () => {
      const state = generateState({slot: 0});
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
    changed: () => {
      const state = generateState({slot: 0});
      state.balances.set(0, state.balances.get(0) + 1000);
      state.commit();
      return ssz.phase0.BeaconState.serialize(state.toValue() as BeaconState<ForkName.phase0>);
    },
  },
  {
    title: "Sepolia state",
    base: () => {
      return Buffer.from(
        fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/source.txt"), "utf8"),
        "hex"
      );
    },
    changed: () => {
      return Buffer.from(
        fs.readFileSync(path.join(import.meta.dirname, "../../../../fixtures/binaryDiff/input.txt"), "utf8"),
        "hex"
      );
    },
  },
];

describe("BinaryDiffCodec", () => {
  let codec: IBinaryDiffCodec;

  beforeAll(async () => {
    codec = new BinaryDiffVCDiffCodec();
    await codec.init();
  });

  it.each(testsCases)("$title", ({base, changed}) => {
    const _base = base();
    const _changed = changed();

    const delta = codec.compute(_base, _changed);
    const result = codec.apply(_base, delta);

    expect(delta).toBeInstanceOf(Uint8Array);
    expect(delta).not.toHaveLength(0);
    expect(Buffer.from(result).toString("hex")).toStrictEqual(Buffer.from(_changed).toString("hex"));
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
