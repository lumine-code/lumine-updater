const findNewestRelease = require("../src/find-newest-release.js");

function fetchReturning({ ok = true, status = 200, body }) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

describe("lumine-updater findNewestRelease", () => {
  it("requests the full release designated latest by GitHub", async () => {
    const request = spyOn(global, "fetch").and.returnValue(
      fetchReturning({
        body: { tag_name: "1.2.3", prerelease: false, draft: false },
      }),
    );

    expect(await findNewestRelease()).toBe("1.2.3");
    expect(request.calls.mostRecent().args[0]).toBe(
      "https://api.github.com/repos/lumine-code/lumine/releases/latest",
    );
  });

  it("returns the sentinel version when the repository has no releases", async () => {
    const request = spyOn(global, "fetch").and.returnValues(
      fetchReturning({ ok: false, status: 404, body: {} }),
      fetchReturning({ body: { name: "lumine" } }),
    );

    expect(await findNewestRelease()).toBe("0.0.0");
    expect(request.calls.mostRecent().args[0]).toBe(
      "https://api.github.com/repos/lumine-code/lumine",
    );
  });

  it("does not turn an unavailable repository into the no-release sentinel", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ ok: false, status: 404, body: {} }));
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/repository lookup.*404/);
  });

  it("observes cancellation during the no-release repository check", async () => {
    const controller = new AbortController();
    let finish;
    const entered = new Promise((resolve) => {
      spyOn(global, "fetch").and.callFake((url) => {
        if (url.endsWith("/latest")) return fetchReturning({ ok: false, status: 404, body: {} });
        resolve();
        return new Promise((reply) => (finish = reply));
      });
    });
    const pending = findNewestRelease({ signal: controller.signal });
    await entered;
    controller.abort();
    finish({ ok: true });
    await expectAsync(pending).toBeRejected();
  });

  for (const flag of ["draft", "prerelease"]) {
    it(`rejects an unexpected ${flag} returned as the full latest release`, async () => {
      spyOn(global, "fetch").and.returnValue(
        fetchReturning({ body: { tag_name: "2.0.0-beta.1", [flag]: true } }),
      );
      await expectAsync(findNewestRelease()).toBeRejectedWithError(/full release/);
    });
  }

  for (const tag_name of ["", undefined, 123]) {
    it(`rejects a latest release with invalid tag ${String(tag_name)}`, async () => {
      spyOn(global, "fetch").and.returnValue(fetchReturning({ body: { tag_name } }));
      await expectAsync(findNewestRelease()).toBeRejectedWithError(/tag name/);
    });
  }

  it("accepts the designated full release independently of build or backport chronology", async () => {
    spyOn(global, "fetch").and.returnValue(
      fetchReturning({
        body: {
          tag_name: "v1.2.1",
          created_at: "2025-01-01T00:00:00Z",
          published_at: "2026-10-08T00:00:00Z",
        },
      }),
    );
    expect(await findNewestRelease()).toBe("v1.2.1");
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
