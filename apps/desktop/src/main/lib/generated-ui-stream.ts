import { pipeJsonRender } from "@json-render/core";

/** Apply json-render's mixed text + JSONL transform to an AI SDK UI stream. */
export function pipeGeneratedUIStream<T>(stream: ReadableStream<T>): ReadableStream<T> {
  return pipeJsonRender(stream);
}
