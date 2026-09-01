// Minimal ambient types for the AudioWorklet global scope (sseq-worklet.ts runs there, not in the
// window/DOM realm lib.dom.d.ts models) — just the surface this codebase actually uses, not a full
// typings package.
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: AudioWorkletNodeOptions);
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new (options?: AudioWorkletNodeOptions) => AudioWorkletProcessor
): void;
