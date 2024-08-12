import vcdiff from "vcdiff-wasm";
import {IBinaryDiffCodec} from "../types.js";

export class BinaryDiffVCDiffCodec implements IBinaryDiffCodec {
  private encoder!: (s: Uint8Array, i: Uint8Array) => Uint8Array;
  private decoder!: (s: Uint8Array, i: Uint8Array) => Uint8Array;
  private isInitialized: boolean = false;

  async init(): Promise<void> {
    const vc = await vcdiff();

    this.encoder = vc.encoder;
    this.decoder = vc.decoder;
    this.isInitialized = true;
  }

  get initialized(): boolean {
    return this.isInitialized;
  }

  compute(base: Uint8Array, changed: Uint8Array): Uint8Array {
    return this.encoder(base, changed);
  }

  apply(base: Uint8Array, delta: Uint8Array): Uint8Array {
    return this.decoder(base, delta);
  }
}
