const https = require("node:https");
const net = require("node:net");
const { EventEmitter } = require("node:events");
const { PassThrough } = require("node:stream");
const releaseRequest = require("../src/release-request.js");

const repositoryUrl = "https://api.github.com/repos/lumine-code/lumine/releases";

function response({ status = 200, headers = {} } = {}) {
  return Object.assign(new PassThrough(), { statusCode: status, headers });
}

function mockResponses(...responses) {
  let index = 0;
  return spyOn(https, "get").and.callFake((_url, _options, callback) => {
    const request = new EventEmitter();
    queueMicrotask(() => callback(responses[index++]));
    return request;
  });
}

describe("lumine-updater release request", () => {
  it("uses Node HTTPS and reads UTF-8 JSON across response chunks", async () => {
    const incoming = response();
    const transport = mockResponses(incoming);
    const browserFetch = spyOn(global, "fetch");
    const signal = new AbortController().signal;
    const headers = { Accept: "application/vnd.github+json" };
    const pending = releaseRequest.fetch(repositoryUrl, { headers, signal });
    const body = Buffer.from('{"name":"Luminé"}');
    incoming.write(body.subarray(0, body.length - 3));
    incoming.end(body.subarray(body.length - 3));

    const result = await pending;
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ name: "Luminé" });
    expect(String(transport.calls.first().args[0])).toBe(repositoryUrl);
    expect(transport.calls.first().args[1]).toEqual({ headers, signal });
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it("returns unsuccessful HTTP status after consuming its response", async () => {
    const incoming = response({ status: 503 });
    mockResponses(incoming);
    const pending = releaseRequest.fetch(repositoryUrl);
    incoming.end('{"message":"Unavailable"}');

    const result = await pending;
    expect(result.ok).toBe(false);
    expect(result.status).toBe(503);
    expect(incoming.readableEnded).toBe(true);
    expect(await result.json()).toEqual({ message: "Unavailable" });
  });

  it("rejects JSON parsing errors when the body is read", async () => {
    const incoming = response();
    mockResponses(incoming);
    const pending = releaseRequest.fetch(repositoryUrl);
    incoming.end("invalid JSON");

    const result = await pending;
    await expectAsync(result.json()).toBeRejectedWithError(SyntaxError);
  });

  it("rejects connection failures", async () => {
    const request = new EventEmitter();
    spyOn(https, "get").and.returnValue(request);
    const pending = releaseRequest.fetch(repositoryUrl);
    request.emit("error", new Error("Offline"));

    await expectAsync(pending).toBeRejectedWithError("Offline");
  });

  it("rejects when the response body cannot finish", async () => {
    const incoming = response();
    mockResponses(incoming);
    const pending = releaseRequest.fetch(repositoryUrl);
    await Promise.resolve();
    incoming.write("{");
    incoming.destroy(new Error("Connection closed"));

    await expectAsync(pending).toBeRejectedWithError("Connection closed");
  });

  it("follows relative HTTPS redirects and consumes their responses", async () => {
    const redirect = response({ status: 302, headers: { location: "releases/latest" } });
    const incoming = response();
    const transport = mockResponses(redirect, incoming);
    const signal = new AbortController().signal;
    const headers = { Accept: "application/vnd.github+json" };
    const pending = releaseRequest.fetch(repositoryUrl, { headers, signal });
    redirect.end("Redirecting");
    incoming.end('{"tag_name":"1.2.3"}');

    expect(await (await pending).json()).toEqual({ tag_name: "1.2.3" });
    expect(String(transport.calls.mostRecent().args[0])).toBe(`${repositoryUrl}/latest`);
    expect(transport.calls.mostRecent().args[1]).toEqual({ headers, signal });
    expect(redirect.readableEnded).toBe(true);
  });

  it("rejects a redirect loop after five hops", async () => {
    const redirects = Array.from({ length: 6 }, () =>
      response({ status: 301, headers: { location: repositoryUrl } }),
    );
    const transport = mockResponses(...redirects);
    const pending = releaseRequest.fetch(repositoryUrl);
    for (const redirect of redirects) redirect.end();

    await expectAsync(pending).toBeRejectedWithError(/redirect limit/);
    expect(transport.calls.count()).toBe(6);
  });

  it("rejects redirects away from HTTPS", async () => {
    const redirect = response({ status: 302, headers: { location: "http://example.test/" } });
    const transport = mockResponses(redirect);
    const pending = releaseRequest.fetch(repositoryUrl);
    redirect.end();

    await expectAsync(pending).toBeRejectedWithError(/requires HTTPS/);
    expect(transport.calls.count()).toBe(1);
  });

  it("does not connect when the check has already been cancelled", async () => {
    const transport = spyOn(https, "get");
    const signal = AbortSignal.abort();

    await expectAsync(releaseRequest.fetch(repositoryUrl, { signal })).toBeRejected();
    expect(transport).not.toHaveBeenCalled();
  });

  it("observes cancellation after receiving the body and before parsing it", async () => {
    const incoming = response();
    mockResponses(incoming);
    const controller = new AbortController();
    const pending = releaseRequest.fetch(repositoryUrl, { signal: controller.signal });
    incoming.end("[]");
    const result = await pending;
    controller.abort();

    await expectAsync(result.json()).toBeRejected();
  });

  it("cancels a real HTTPS connection before its TLS handshake finishes", async () => {
    const controller = new AbortController();
    let connection;
    const server = net.createServer((socket) => {
      connection = socket;
      controller.abort();
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(2000)]);
      await expectAsync(
        releaseRequest.fetch(`https://127.0.0.1:${server.address().port}/`, { signal }),
      ).toBeRejectedWithError(/aborted/i);
      expect(controller.signal.aborted).toBe(true);
    } finally {
      connection?.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("times out a real HTTPS connection whose TLS handshake stalls", async () => {
    let connection;
    const server = net.createServer((socket) => {
      connection = socket;
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const signal = AbortSignal.timeout(100);
      await expectAsync(
        releaseRequest.fetch(`https://127.0.0.1:${server.address().port}/`, { signal }),
      ).toBeRejectedWithError(/aborted/i);
      expect(signal.aborted).toBe(true);
      expect(connection).toBeDefined();
    } finally {
      connection?.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
