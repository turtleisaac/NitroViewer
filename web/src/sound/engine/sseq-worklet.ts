// Realtime host for the Stepper: runs on the AudioWorklet render thread, producing float32 stereo
// samples per process() quantum. Static sequence data arrives once via processorOptions; mute/solo
// and seeking are small, infrequent messages over the port — nothing here waits on the CheerpJ
// call queue or any other main-thread state once construction finishes.
import { Stepper } from "./stepper";
import type { LoadedSequence } from "./load";
import { WORKLET_NAME, type MainToWorklet, type WorkletInit, type WorkletToMain } from "./protocol";

const POSITION_REPORT_INTERVAL_SECONDS = 0.02;

class SseqEngineProcessor extends AudioWorkletProcessor {
  private readonly seq: LoadedSequence;
  private readonly outRate: number;
  private stepper: Stepper;
  private trackMask: number;
  private samplesSinceReport = 0;
  private readonly reportEvery: number;
  private endedReported = false;

  constructor(options?: AudioWorkletNodeOptions) {
    super();
    const init = options!.processorOptions as WorkletInit;
    this.seq = init.seq;
    this.outRate = init.outRate;
    this.trackMask = init.trackMask;
    this.reportEvery = Math.max(1, Math.round(init.outRate * POSITION_REPORT_INTERVAL_SECONDS));

    this.stepper = this.newStepper();
    this.stepper.fastForward(Math.round(init.seedSeconds * this.outRate));

    this.port.onmessage = (e: MessageEvent<MainToWorklet>) => this.onMessage(e.data);
    this.post({ type: "ready" });
  }

  private newStepper(): Stepper {
    const s = new Stepper(this.seq, this.outRate);
    for (let t = 0; t < 16; t++) s.trackEnabled[t] = ((this.trackMask >> t) & 1) !== 0;
    return s;
  }

  private post(msg: WorkletToMain): void {
    this.port.postMessage(msg);
  }

  private onMessage(msg: MainToWorklet): void {
    if (msg.type === "setTrackMask") {
      this.trackMask = msg.mask;
      for (let t = 0; t < 16; t++) this.stepper.trackEnabled[t] = ((msg.mask >> t) & 1) !== 0;
    } else if (msg.type === "seek") {
      // No snapshotting: rebuild fresh state and fast-forward again. Works for seeking either
      // direction; the cost is proportional to the target position, same tradeoff as the original
      // "first play synthesizes the whole song" offline render this replaces. This runs
      // synchronously on the same render thread as process() — a deep seek into a long sequence
      // can run long enough to miss a process() quantum deadline and produce an audible glitch
      // right at the seek point. Acceptable for v1; a real fix would chunk fastForward() across
      // multiple process() calls (or snapshot periodically) so seeking never blocks rendering.
      this.stepper = this.newStepper();
      this.stepper.fastForward(Math.round(msg.seconds * this.outRate));
      this.samplesSinceReport = 0;
      this.endedReported = false;
    }
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const output = outputs[0];
    const left = output[0];
    // host.ts always constructs this node with outputChannelCount: [2], so output[1] is guaranteed;
    // no fallback here on purpose — a missing second channel should fail loudly, not silently
    // downmix to duplicated mono.
    const right = output[1];
    for (let i = 0; i < left.length; i++) {
      const sample = this.stepper.stepSample();
      if (sample == null) {
        left[i] = 0;
        right[i] = 0;
        if (!this.endedReported) {
          this.endedReported = true;
          this.post({ type: "ended" });
        }
        continue;
      }
      left[i] = sample[0] / 32768;
      right[i] = sample[1] / 32768;
      if (++this.samplesSinceReport >= this.reportEvery) {
        this.samplesSinceReport = 0;
        this.post({ type: "position", seconds: this.stepper.currentFrame / this.outRate });
      }
    }
    return true; // keep the node alive after "ended" — most SSEQs loop forever (stopAtLoop is off)
  }
}

registerProcessor(WORKLET_NAME, SseqEngineProcessor);
