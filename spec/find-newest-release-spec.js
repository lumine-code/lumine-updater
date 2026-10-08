const findNewestRelease = require("../src/find-newest-release.js");

function fetchReturning({ ok = true, status = 200, body }) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("lumine-updater findNewestRelease", () => {
  it("returns the newest release tag", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ body: [{ tag_name: "1.2.3" }] }));

    expect(await findNewestRelease()).toBe("1.2.3");
  });

  it("returns the sentinel version when the repository has no releases", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ body: [] }));

    expect(await findNewestRelease()).toBe("0.0.0");
  });

  it("rejects a malformed response", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ body: null }));

    await expectAsync(findNewestRelease()).toBeRejected();
  });

  it("rejects when the request fails", async () => {
    spyOn(global, "fetch").and.callFake(() => Promise.reject(new Error("network failure")));

    await expectAsync(findNewestRelease()).toBeRejectedWithError("network failure");
  });

  it("rejects an unsuccessful HTTP response", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ ok: false, status: 503, body: [] }));
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/503/);
  });

  it("does not request a release when cancellation happened before the read", async () => {
    const fetch = spyOn(global, "fetch");
    const signal = AbortSignal.abort();
    await expectAsync(findNewestRelease({ signal })).toBeRejected();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("observes cancellation while the response body is being read", async () => {
    let finish;
    const controller = new AbortController();
    spyOn(global, "fetch").and.resolveTo({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = findNewestRelease({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    finish([{ tag_name: "2.0.0" }]);
    await expectAsync(pending).toBeRejected();
  });
});
