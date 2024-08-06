import {init, xd3_encode_memory, xd3_decode_memory, xd3_smatch_cfg} from "xdelta3-wasm";

export class BinaryDiffCodec {
  async init(): Promise<void> {
    await init();
  }

  compute(input: Uint8Array, source: Uint8Array): Uint8Array {
    // TODO: Find a way to compute maximum output size
    const delta = xd3_encode_memory(input, source, 9999, xd3_smatch_cfg.DEFAULT);
    if (delta.str === "SUCCESS") {
      return delta.output;
    }

    throw new Error("Can not compute binary diff");
  }

  apply(source: Uint8Array, delta: Uint8Array): Uint8Array {
    const orig = xd3_decode_memory(delta, source, 9999);

    if (orig.str === "SUCCESS") {
      return orig.output;
    }

    throw new Error("Can not apply binary diff patch");
  }
}
