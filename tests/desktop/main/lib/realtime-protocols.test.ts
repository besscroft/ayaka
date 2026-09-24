import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Experimental_RealtimeClientEvent, Experimental_RealtimeSessionConfig } from "ai";
import {
  buildBailianSessionConfig,
  parseBailianRealtimeServerEvent,
  serializeBailianRealtimeClientEvent,
} from "../../../../apps/desktop/src/shared/realtime-protocols";

void describe("Bailian native realtime protocol", () => {
  void it("builds the nested Bailian audio session shape", () => {
    const config: Experimental_RealtimeSessionConfig = {
      instructions: "Be concise",
      voice: "alloy",
      outputModalities: ["text", "audio"],
      inputAudioFormat: { type: "audio/pcm", rate: 16_000 },
      outputAudioFormat: { type: "audio/pcm", rate: 24_000 },
      inputAudioTranscription: {},
      turnDetection: { type: "server-vad", silenceDurationMs: 800 },
      tools: [
        {
          type: "function",
          name: "get_weather",
          description: "Get weather",
          parameters: { type: "object", properties: {} },
        },
      ],
    };

    assert.deepEqual(buildBailianSessionConfig(config, "qwen3.8-omni-flash-realtime"), {
      instructions: "Be concise",
      modalities: ["text", "audio"],
      audio: {
        input: {
          format: {
            type: "pcm",
            sample_rate: 16_000,
            sample_format: "s16le",
            channels: 1,
            packing: "interleaved",
            channel_layout: "mono",
          },
        },
        output: {
          voice: "longanlingxin",
          format: { type: "pcm", sample_rate: 24_000 },
        },
      },
      turn_detection: { type: "server_vad", silence_duration_ms: 800 },
      tools: [
        {
          type: "function",
          function: {
            name: "get_weather",
            description: "Get weather",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    });
  });

  void it("serializes native text, audio, and response events", () => {
    const events: Experimental_RealtimeClientEvent[] = [
      { type: "input-audio-append", audio: "AQ==" },
      {
        type: "conversation-item-create",
        item: { type: "text-message", role: "user", text: "你好" },
      },
      { type: "response-create" },
      { type: "response-cancel" },
    ];

    assert.deepEqual(
      events.map((event) => serializeBailianRealtimeClientEvent(event, "qwen-realtime")),
      [
        { type: "input_audio_buffer.append", audio: "AQ==" },
        {
          type: "conversation.item.create",
          item: {
            type: "message",
            role: "user",
            content: [{ type: "input_text", text: "你好" }],
          },
        },
        { type: "response.create" },
        { type: "response.cancel" },
      ],
    );
  });

  void it("normalizes native audio, transcript, function, and error events", () => {
    assert.deepEqual(
      parseBailianRealtimeServerEvent({
        type: "response.audio.delta",
        response_id: "resp_1",
        item_id: "item_1",
        delta: "AQ==",
      }),
      {
        type: "audio-delta",
        responseId: "resp_1",
        itemId: "item_1",
        delta: "AQ==",
        raw: {
          type: "response.audio.delta",
          response_id: "resp_1",
          item_id: "item_1",
          delta: "AQ==",
        },
      },
    );
    assert.deepEqual(
      parseBailianRealtimeServerEvent({
        type: "conversation.item.input_audio_transcription.completed",
        item_id: "item_1",
        transcript: "你好",
      }),
      {
        type: "input-transcription-completed",
        itemId: "item_1",
        transcript: "你好",
        raw: {
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "item_1",
          transcript: "你好",
        },
      },
    );
    assert.deepEqual(
      parseBailianRealtimeServerEvent({
        type: "response.function_call_arguments.done",
        response_id: "resp_1",
        item_id: "item_2",
        call_id: "call_1",
        name: "get_weather",
        arguments: '{"city":"杭州"}',
      }),
      {
        type: "function-call-arguments-done",
        responseId: "resp_1",
        itemId: "item_2",
        callId: "call_1",
        name: "get_weather",
        arguments: '{"city":"杭州"}',
        raw: {
          type: "response.function_call_arguments.done",
          response_id: "resp_1",
          item_id: "item_2",
          call_id: "call_1",
          name: "get_weather",
          arguments: '{"city":"杭州"}',
        },
      },
    );
    assert.deepEqual(
      parseBailianRealtimeServerEvent({
        type: "error",
        error: { code: "invalid_value", message: "Bad request" },
      }),
      {
        type: "error",
        code: "invalid_value",
        message: "Bad request",
        raw: {
          type: "error",
          error: { code: "invalid_value", message: "Bad request" },
        },
      },
    );
  });
});
