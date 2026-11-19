/**
 * The conversation between the page and the PDF worker. Small on purpose:
 *
 *   page → worker   `run` (a job with an id) · `cancel` (stop job id at its next step — the cooperative version; the page
 *                   itself cancels by terminating the worker, since pdf-lib can't be interrupted mid-save)
 *   worker → page   `ready` (the script loaded; sent once) · `progress` · `result` · `error` · `cancelled`
 *
 * Inputs are copied into the worker (the page keeps its own bytes for previews and the next run); results come back as
 * transferred ArrayBuffers, so a 100 MB output isn't copied twice.
 */
import type { FRect } from './geometry';
import type { Progress } from './job';
import type { PageRange } from './ranges';
import type { ImageInput, ImagesToPdfOptions, PageRef, RasterPage, SignaturePlacement, WatermarkOptions } from './types';

/** Everything the worker can be asked to do. */
export type JobSpec =
  | { op: 'inspect'; bytes: Uint8Array }
  | { op: 'merge'; files: Uint8Array[] }
  | { op: 'assemble'; sources: Uint8Array[]; pages: PageRef[] }
  | { op: 'split'; bytes: Uint8Array; ranges: PageRange[] }
  | { op: 'crop'; bytes: Uint8Array; crops: Array<FRect | null> }
  | { op: 'sign'; bytes: Uint8Array; placements: SignaturePlacement[] }
  | { op: 'images'; images: ImageInput[]; options: ImagesToPdfOptions }
  | { op: 'optimize'; bytes: Uint8Array }
  | { op: 'rebuild'; pages: RasterPage[] }
  | { op: 'watermark'; bytes: Uint8Array; options: WatermarkOptions }
  | { op: 'fontMetrics' };

export type JobOp = JobSpec['op'];

/** What a job produces: output files (usually one) and, for the ops that answer a question instead, plain `info`. */
export type JobOutput = { files: Uint8Array[]; info?: unknown };

export type WorkerRequest = { type: 'run'; id: number; job: JobSpec } | { type: 'cancel'; id: number };

export type ErrorKind = 'pdf' | 'unexpected';

export type WorkerResponse =
  | { type: 'ready' }
  | { type: 'progress'; id: number; progress: Progress }
  | { type: 'result'; id: number; files: ArrayBuffer[]; info?: unknown }
  | { type: 'error'; id: number; kind: ErrorKind; message: string }
  | { type: 'cancelled'; id: number };

/** An ArrayBuffer that holds exactly `bytes` — the buffer itself when it already does, else a copy — ready to transfer. */
export function toTransferable(bytes: Uint8Array): ArrayBuffer {
  if (bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength && bytes.buffer instanceof ArrayBuffer) return bytes.buffer;
  return bytes.slice().buffer as ArrayBuffer;
}
