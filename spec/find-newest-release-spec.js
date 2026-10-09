const findNewestRelease = require("../src/find-newest-release.js");

const repositoryUrl = "https://api.github.com/repos/lumine-code/lumine";

function fetchReturning({ ok = true, status = 200, body }) {
  return Promise.resolve({
    ok,
    status,
    json: () => Promise.resolve(body),
  });
}

function fetchLatest(body) {
  return spyOn(global, "fetch").and.returnValues(
    fetchReturning({ body: [{ tag_name: "1.0.0", prerelease: false, draft: false }] }),
    fetchReturning({ body }),
  );
}

describe("lumine-updater findNewestRelease", () => {
  it("requests the full release designated latest by GitHub after finding a full release", async () => {
    const request = fetchLatest({ tag_name: "1.2.3", prerelease: false, draft: false });

    expect(await findNewestRelease()).toBe("1.2.3");
    expect(request.calls.allArgs().map(([url]) => url)).toEqual([
      `${repositoryUrl}/releases?per_page=100&page=1`,
      `${repositoryUrl}/releases/latest`,
    ]);
  });

  it("returns the sentinel without requesting /latest when the repository has no releases", async () => {
    const request = spyOn(global, "fetch").and.returnValue(fetchReturning({ body: [] }));

    expect(await findNewestRelease()).toBe("0.0.0");
    expect(request.calls.count()).toBe(1);
    expect(request.calls.first().args[0]).toBe(`${repositoryUrl}/releases?per_page=100&page=1`);
  });

  it("does not turn an unavailable repository into the no-release sentinel", async () => {
    const request = spyOn(global, "fetch").and.returnValue(
      fetchReturning({ ok: false, status: 404, body: {} }),
    );
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/release lookup.*404/);
    expect(request.calls.count()).toBe(1);
  });

  it("observes cancellation while the release list request is pending", async () => {
    const controller = new AbortController();
    let finish;
    const request = spyOn(global, "fetch").and.callFake(
      () => new Promise((reply) => (finish = reply)),
    );
    const pending = findNewestRelease({ signal: controller.signal });
    controller.abort();
    finish({ ok: true, json: () => Promise.resolve([]) });
    await expectAsync(pending).toBeRejected();
    expect(request.calls.count()).toBe(1);
  });

  for (const flag of ["draft", "prerelease"]) {
    it(`returns the sentinel without requesting /latest when only ${flag} releases exist`, async () => {
      const request = spyOn(global, "fetch").and.returnValue(
        fetchReturning({ body: [{ tag_name: "2.0.0-beta.1", [flag]: true }] }),
      );
      expect(await findNewestRelease()).toBe("0.0.0");
      expect(request.calls.count()).toBe(1);
    });

    it(`rejects an unexpected ${flag} returned as the full latest release`, async () => {
      fetchLatest({ tag_name: "2.0.0-beta.1", [flag]: true });
      await expectAsync(findNewestRelease()).toBeRejectedWithError(/full release/);
    });
  }

  it("finds a full release beyond the first page of prereleases", async () => {
    const request = spyOn(global, "fetch").and.returnValues(
      fetchReturning({ body: Array.from({ length: 100 }, () => ({ prerelease: true })) }),
      fetchReturning({ body: [{ tag_name: "1.0.0" }] }),
      fetchReturning({ body: { tag_name: "1.2.3" } }),
    );
    expect(await findNewestRelease()).toBe("1.2.3");
    expect(request.calls.allArgs().map(([url]) => url)).toEqual([
      `${repositoryUrl}/releases?per_page=100&page=1`,
      `${repositoryUrl}/releases?per_page=100&page=2`,
      `${repositoryUrl}/releases/latest`,
    ]);
  });

  it("returns the sentinel when every page contains only prereleases", async () => {
    const request = spyOn(global, "fetch").and.returnValues(
      fetchReturning({ body: Array.from({ length: 100 }, () => ({ prerelease: true })) }),
      fetchReturning({ body: [] }),
    );
    expect(await findNewestRelease()).toBe("0.0.0");
    expect(request.calls.count()).toBe(2);
    expect(request.calls.mostRecent().args[0]).toBe(
      `${repositoryUrl}/releases?per_page=100&page=2`,
    );
  });

  for (const tag_name of ["", undefined, 123]) {
    it(`rejects a latest release with invalid tag ${String(tag_name)}`, async () => {
      fetchLatest({ tag_name });
      await expectAsync(findNewestRelease()).toBeRejectedWithError(/tag name/);
    });
  }

  it("accepts the designated full release independently of build or backport chronology", async () => {
    const request = spyOn(global, "fetch").and.returnValues(
      fetchReturning({ body: [{ tag_name: "v1.3.0" }, { tag_name: "v1.2.1" }] }),
      fetchReturning({
        body: {
          tag_name: "v1.2.1",
          created_at: "2025-01-01T00:00:00Z",
          published_at: "2026-10-08T00:00:00Z",
        },
      }),
    );
    expect(await findNewestRelease()).toBe("v1.2.1");
    expect(request.calls.count()).toBe(2);
  });

  for (const body of [null, {}, [null], ["1.2.3"]]) {
    it(`rejects a malformed release list ${JSON.stringify(body)}`, async () => {
      const request = spyOn(global, "fetch").and.returnValue(fetchReturning({ body }));
      await expectAsync(findNewestRelease()).toBeRejectedWithError(/invalid release list/);
      expect(request.calls.count()).toBe(1);
    });
  }

  it("rejects a malformed latest release", async () => {
    fetchLatest(null);
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/invalid full release/);
  });

  it("rejects when the request fails", async () => {
    spyOn(global, "fetch").and.callFake(() => Promise.reject(new Error("network failure")));

    await expectAsync(findNewestRelease()).toBeRejectedWithError("network failure");
  });

  it("rejects an unsuccessful release list HTTP response", async () => {
    spyOn(global, "fetch").and.returnValue(fetchReturning({ ok: false, status: 503, body: [] }));
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/503/);
  });

  it("rejects an unsuccessful latest release HTTP response", async () => {
    spyOn(global, "fetch").and.returnValues(
      fetchReturning({ body: [{ tag_name: "1.0.0" }] }),
      fetchReturning({ ok: false, status: 503, body: {} }),
    );
    await expectAsync(findNewestRelease()).toBeRejectedWithError(/503/);
  });

  it("does not request a release when cancellation happened before the read", async () => {
    const fetch = spyOn(global, "fetch");
    const signal = AbortSignal.abort();
    await expectAsync(findNewestRelease({ signal })).toBeRejected();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("observes cancellation while the release list body is being read", async () => {
    let finish;
    const controller = new AbortController();
    const request = spyOn(global, "fetch").and.resolveTo({
      ok: true,
      json: () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    });
    const pending = findNewestRelease({ signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    finish(Array.from({ length: 100 }, () => ({ prerelease: true })));
    await expectAsync(pending).toBeRejected();
    expect(request.calls.count()).toBe(1);
  });

  it("observes cancellation while the latest release body is being read", async () => {
    let finish;
    const controller = new AbortController();
    const entered = new Promise((resolve) => {
      spyOn(global, "fetch").and.returnValues(
        fetchReturning({ body: [{ tag_name: "1.0.0" }] }),
        Promise.resolve({
          ok: true,
          json: () =>
            new Promise((reply) => {
              finish = reply;
              resolve();
            }),
        }),
      );
    });
    const pending = findNewestRelease({ signal: controller.signal });
    await entered;
    controller.abort();
    finish({ tag_name: "2.0.0" });
    await expectAsync(pending).toBeRejected();
  });
});
