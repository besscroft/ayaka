import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import WebSocket, { WebSocketServer } from "ws";
import {
  buildBailianRealtimeEndpoint,
  closeRealtimeProxy,
  createRealtimeProxySession,
  inferBailianRealtimeWorkspaceId,
  resolveBailianRealtimeWorkspaceId,
} from "../../../../apps/desktop/src/main/lib/realtime-proxy";

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function waitForMessage(socket: WebSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    socket.once("message", (data) => resolve(data.toString()));
    socket.once("error", reject);
  });
}

function waitForClose(socket: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => {
    socket.once("close", (code, reason) => resolve({ code, reason: reason.toString() }));
  });
}

void describe("realtime WebSocket proxy", () => {
  afterEach(async () => {
    await closeRealtimeProxy();
  });

  void it("builds the workspace-bound endpoint required by Qwen 3.8 Omni Realtime", () => {
    assert.equal(
      buildBailianRealtimeEndpoint({
        modelId: "qwen3.8-omni-flash-realtime",
        endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=old-model",
        workspace: "workspace-test",
        region: "cn-beijing",
      }),
      "wss://workspace-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime",
    );
    assert.equal(
      buildBailianRealtimeEndpoint({
        modelId: "qwen3.8-omni-flash-realtime",
        endpoint: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        workspace: "workspace-test",
        region: "ap-southeast-1",
      }),
      "wss://workspace-test.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime",
    );
    assert.throws(
      () =>
        buildBailianRealtimeEndpoint({
          modelId: "qwen3.8-omni-flash-realtime",
          endpoint: "wss://dashscope.aliyuncs.com/api-ws/v1/realtime",
        }),
      /必须填写百炼业务空间 ID/,
    );
  });

  void it("validates the workspace on an explicitly configured Qwen 3.8 endpoint", () => {
    assert.equal(
      buildBailianRealtimeEndpoint({
        modelId: "qwen3.8-omni-flash-realtime",
        endpoint: "wss://workspace-test.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime",
      }),
      "wss://workspace-test.ap-southeast-1.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime",
    );
    assert.throws(
      () =>
        buildBailianRealtimeEndpoint({
          modelId: "qwen3.8-omni-flash-realtime",
          endpoint: "wss://workspace-test.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime",
          workspace: "another-workspace",
        }),
      /Workspace ID.*不一致/,
    );
  });

  void it("infers the Bailian workspace ID from a regional endpoint", () => {
    const endpoint =
      "wss://ws-gqvd7ehvjmrndvhz.cn-beijing.maas.aliyuncs.com/api-ws/v1/realtime?model=qwen3.8-omni-flash-realtime";
    assert.equal(inferBailianRealtimeWorkspaceId(endpoint), "ws-gqvd7ehvjmrndvhz");
    assert.equal(resolveBailianRealtimeWorkspaceId(endpoint), "ws-gqvd7ehvjmrndvhz");
    assert.equal(
      resolveBailianRealtimeWorkspaceId(endpoint, "ws-gqvd7ehvjmrndvhz"),
      "ws-gqvd7ehvjmrndvhz",
    );
    assert.throws(
      () => resolveBailianRealtimeWorkspaceId(endpoint, "another-workspace"),
      /Workspace ID.*不一致/,
    );
    assert.equal(
      inferBailianRealtimeWorkspaceId(
        "wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=qwen3-omni-flash-realtime",
      ),
      undefined,
    );
  });

  void it("connects upstream with the provider API key and forwards frames", async () => {
    let authorization = "";
    let workspaceHeader = "";
    let receivedBinary: boolean | null = null;
    const upstream = new WebSocketServer({ host: "127.0.0.1", port: 0 });
    upstream.on("connection", (socket, request) => {
      authorization = request.headers.authorization ?? "";
      workspaceHeader = request.headers["x-dashscope-workspace"] ?? "";
      socket.on("message", (data, isBinary) => {
        receivedBinary = isBinary;
        socket.send(data, { binary: isBinary });
      });
    });
    await new Promise<void>((resolve) => upstream.once("listening", () => resolve()));
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");

    const session = await createRealtimeProxySession({
      modelId: "qwen3-omni-flash-realtime",
      endpoint: `ws://127.0.0.1:${address.port}/api-ws/v1/realtime`,
      apiKey: "provider-secret",
      workspace: "workspace-test",
    });
    const client = new WebSocket(session.url, ["realtime"]);

    try {
      await waitForOpen(client);
      const payload = JSON.stringify({ type: "session.update" });
      const echoed = waitForMessage(client);
      client.send(payload);
      assert.equal(await echoed, payload);
      assert.equal(receivedBinary, false);
      assert.equal(authorization, "Bearer provider-secret");
      assert.equal(workspaceHeader, "workspace-test");
      assert.equal(session.authMode, "api-key-header");
    } finally {
      client.close();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  void it("logs upstream HTTP rejection details without exposing the API key", async () => {
    const apiKey = "provider-secret-should-not-be-logged";
    const upstream = createServer((_request, response) => {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ code: "InvalidApiKey", echoed: apiKey }));
    });
    await new Promise<void>((resolve) => upstream.listen(0, "127.0.0.1", resolve));
    const address = upstream.address();
    assert.ok(address && typeof address !== "string");
    const logs: string[] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) =>
      logs.push(
        args.map((value) => (typeof value === "string" ? value : JSON.stringify(value))).join(" "),
      );

    try {
      const session = await createRealtimeProxySession({
        modelId: "qwen3-omni-flash-realtime",
        endpoint: `ws://127.0.0.1:${address.port}/api-ws/v1/realtime`,
        apiKey,
      });
      const client = new WebSocket(session.url, ["realtime"]);
      const closed = waitForClose(client);
      await waitForOpen(client);
      assert.equal((await closed).code, 1011);
      const logText = logs.join("\n");
      assert.match(logText, /"statusCode":401/);
      assert.match(logText, /InvalidApiKey/);
      assert.doesNotMatch(logText, new RegExp(apiKey));
    } finally {
      console.error = originalError;
      await new Promise<void>((resolve, reject) =>
        upstream.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
