import {init, xd3_encode_memory, xd3_decode_memory, xd3_smatch_cfg} from "xdelta3-wasm";
import {IBinaryDiffCodec} from "../types.js";

export class BinaryDiffXDelta3Codec implements IBinaryDiffCodec {
  async init(): Promise<void> {
    await init();
  }

  compute(base: Uint8Array, changed: Uint8Array): Uint8Array {
    // The max size of a diff can be if input is empty and source is full state
    // TODO: Try to optimize a way to calculate max output size to reduce memory consumption
    const delta = xd3_encode_memory(changed, base, 1024 * 1024, xd3_smatch_cfg.FAST);
    if (delta.str === "SUCCESS") {
      return delta.output;
    }

    throw new Error(`Can not compute binary diff error=${delta.str}`);
  }

  apply(base: Uint8Array, delta: Uint8Array): Uint8Array {
    const orig = xd3_decode_memory(delta, base, 9999);

    if (orig.str === "SUCCESS") {
      return orig.output;
    }

    throw new Error("Can not apply binary diff patch");
  }
}
