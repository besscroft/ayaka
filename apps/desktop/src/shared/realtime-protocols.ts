import type {
  Experimental_RealtimeClientEvent as RealtimeClientEvent,
  Experimental_RealtimeServerEvent as RealtimeServerEvent,
  Experimental_RealtimeSessionConfig as RealtimeSessionConfig,
} from "ai";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" ? (value as JsonRecord) : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function mapBailianVoice(voice: string, modelId: string): string {
  if (voice !== "alloy") return voice;
  return modelId.toLowerCase() === "qwen3.8-omni-flash-realtime" ? "longanlingxin" : "longanqian";
}

export function buildBailianSessionConfig(
  config: RealtimeSessionConfig,
  modelId: string,
): JsonRecord {
  const session: JsonRecord = {};

  if (config.instructions != null) session.instructions = config.instructions;
  if (config.outputModalities != null) session.modalities = config.outputModalities;
  const audio: JsonRecord = {};
  if (config.inputAudioFormat != null) {
    const inputFormat = record(config.inputAudioFormat);
    audio.input = {
      format: {
        type: "pcm",
        sample_rate: typeof inputFormat.rate === "number" ? inputFormat.rate : 16_000,
        sample_format: "s16le",
        channels: 1,
        packing: "interleaved",
        channel_layout: "mono",
      },
    };
  }
  if (config.outputAudioFormat != null || config.voice != null) {
    const outputFormat = record(config.outputAudioFormat);
    audio.output = {
      ...(config.voice != null ? { voice: mapBailianVoice(config.voice, modelId) } : {}),
      ...(config.outputAudioFormat != null
        ? {
            format: {
              type: "pcm",
              sample_rate: typeof outputFormat.rate === "number" ? outputFormat.rate : 24_000,
            },
          }
        : {}),
    };
  }
  if (Object.keys(audio).length > 0) session.audio = audio;

  if (config.turnDetection != null) {
    if (config.turnDetection.type === "disabled") {
      session.turn_detection = null;
    } else {
      const turnDetection: JsonRecord = {
        type: config.turnDetection.type === "semantic-vad" ? "smart_turn" : "server_vad",
      };
      if (config.turnDetection.threshold != null)
        turnDetection.threshold = config.turnDetection.threshold;
      if (config.turnDetection.silenceDurationMs != null) {
        turnDetection.silence_duration_ms = config.turnDetection.silenceDurationMs;
      }
      if (config.turnDetection.type === "semantic-vad") {
        delete turnDetection.threshold;
        delete turnDetection.silence_duration_ms;
      }
      session.turn_detection = turnDetection;
    }
  }

  if (config.tools != null && config.tools.length > 0) {
    session.tools = config.tools.map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        ...(tool.description != null ? { description: tool.description } : {}),
        parameters: tool.parameters,
      },
    }));
  }

  if (config.providerOptions != null) Object.assign(session, config.providerOptions);
  return session;
}

export function serializeBailianRealtimeClientEvent(
  event: RealtimeClientEvent,
  modelId: string,
): JsonRecord | undefined {
  switch (event.type) {
    case "session-update":
      return {
        type: "session.update",
        session: buildBailianSessionConfig(event.config, modelId),
      };
    case "input-audio-append":
      return { type: "input_audio_buffer.append", audio: event.audio };
    case "input-audio-commit":
      return { type: "input_audio_buffer.commit" };
    case "input-audio-clear":
      return { type: "input_audio_buffer.clear" };
    case "conversation-item-create": {
      const item = event.item;
      if (item.type === "text-message") {
        return {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: item.role,
            content: [{ type: "input_text", text: item.text }],
          },
        };
      }
      if (item.type === "audio-message") {
        return {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: item.role,
            content: [{ type: "input_audio", audio: item.audio }],
          },
        };
      }
      return {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: item.callId,
          output: item.output,
        },
      };
    }
    case "conversation-item-truncate":
      return {
        type: "conversation.item.truncate",
        item_id: event.itemId,
        content_index: event.contentIndex,
        audio_end_ms: event.audioEndMs,
      };
    case "response-create":
      return {
        type: "response.create",
        ...(event.options?.modalities != null
          ? { response: { modalities: event.options.modalities } }
          : {}),
      };
    case "response-cancel":
      return { type: "response.cancel" };
  }
}

export function parseBailianRealtimeServerEvent(raw: unknown): RealtimeServerEvent {
  const event = record(raw);
  const type = string(event.type);
  const response = record(event.response);
  const item = record(event.item);
  const error = record(event.error);
  const responseId = string(event.response_id ?? response.id);
  const itemId = string(event.item_id ?? item.id);

  switch (type) {
    case "session.created":
      return {
        type: "session-created",
        sessionId: string(record(event.session).id) || undefined,
        raw,
      };
    case "session.updated":
      return { type: "session-updated", raw };
    case "input_audio_buffer.speech_started":
      return { type: "speech-started", itemId: string(event.item_id) || undefined, raw };
    case "input_audio_buffer.speech_stopped":
      return { type: "speech-stopped", itemId: string(event.item_id) || undefined, raw };
    case "input_audio_buffer.committed":
      return {
        type: "audio-committed",
        itemId: string(event.item_id) || undefined,
        previousItemId: string(event.previous_item_id) || undefined,
        raw,
      };
    case "conversation.item.created":
      return { type: "conversation-item-added", itemId, item, raw };
    case "conversation.item.input_audio_transcription.completed":
      return {
        type: "input-transcription-completed",
        itemId,
        transcript: string(event.transcript),
        raw,
      };
    case "response.created":
      return { type: "response-created", responseId, raw };
    case "response.done":
      return {
        type: "response-done",
        responseId,
        status: string(response.status, "completed"),
        raw,
      };
    case "response.output_item.added":
      return { type: "output-item-added", responseId, itemId, raw };
    case "response.output_item.done":
      return { type: "output-item-done", responseId, itemId, raw };
    case "response.content_part.added":
      return { type: "content-part-added", responseId, itemId, raw };
    case "response.content_part.done":
      return { type: "content-part-done", responseId, itemId, raw };
    case "response.audio.delta":
      return {
        type: "audio-delta",
        responseId,
        itemId,
        delta: string(event.delta),
        raw,
      };
    case "response.audio.done":
      return { type: "audio-done", responseId, itemId, raw };
    case "response.audio_transcript.delta":
      return {
        type: "audio-transcript-delta",
        responseId,
        itemId,
        delta: string(event.delta),
        raw,
      };
    case "response.audio_transcript.done":
      return {
        type: "audio-transcript-done",
        responseId,
        itemId,
        transcript: string(event.transcript),
        raw,
      };
    case "response.text.delta":
      return {
        type: "text-delta",
        responseId,
        itemId,
        delta: string(event.delta),
        raw,
      };
    case "response.text.done":
      return { type: "text-done", responseId, itemId, text: string(event.text), raw };
    case "response.function_call_arguments.delta":
      return {
        type: "function-call-arguments-delta",
        responseId,
        itemId,
        callId: string(event.call_id),
        delta: string(event.delta),
        raw,
      };
    case "response.function_call_arguments.done":
      return {
        type: "function-call-arguments-done",
        responseId,
        itemId,
        callId: string(event.call_id),
        name: string(event.name),
        arguments: string(event.arguments),
        raw,
      };
    case "error":
      return {
        type: "error",
        message: string(error.message, "Realtime provider error"),
        code: string(error.code) || undefined,
        raw,
      };
    default:
      return { type: "custom", rawType: type, raw };
  }
}
