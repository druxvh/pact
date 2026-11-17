/**
 * The PDF worker: every heavy PDF job (merge, organize, split, crop, sign, watermark, compress, images → PDF) runs here,
 * off the page's main thread. Bundled by Vite as a separate same-origin file, so Manifest V3's `script-src 'self'`
 * allows it (no remote code, no blob/eval). Started by `pdfRunner.ts`; terminated to cancel a job.
 *
 * A plain shell on purpose: the logic is in `lib/pdf/workerHandler.ts`, where it is tested without a worker.
 * (No `/// <reference lib="webworker" />`: it clashes with the DOM lib the rest of the project is typed against.)
 */
import type { WorkerRequest, WorkerResponse } from '../lib/pdf/protocol';
import { createWorkerHandler } from '../lib/pdf/workerHandler';

type WorkerScope = {
  postMessage(message: WorkerResponse, transfer?: Transferable[]): void;
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
};

const scope = self as unknown as WorkerScope;
const handle = createWorkerHandler((message, transfer) => scope.postMessage(message, transfer ?? []));

scope.onmessage = (event) => {
  void handle(event.data);
};
// Tells the page the script loaded — until then, an `error` event means "couldn't start", not "a job crashed".
scope.postMessage({ type: 'ready' });
