module.exports = async function findNewestRelease({ signal: requestedSignal } = {}) {
  const timeout = AbortSignal.timeout(30000);
  const signal = requestedSignal ? AbortSignal.any([requestedSignal, timeout]) : timeout;
  signal.throwIfAborted();
  const request = {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Lumine.Lumine-Updater",
    },
  };
  const repositoryUrl = "https://api.github.com/repos/lumine-code/lumine";

  // /latest answers 404 when there is no full release, which Chromium logs
  // even when handled. The list answers 200 with [] for that normal state.
  const perPage = 100;
  for (let page = 1; ; page++) {
    const releases = await fetch(
      `${repositoryUrl}/releases?per_page=${perPage}&page=${page}`,
      request,
    );
    signal.throwIfAborted();
    if (!releases.ok) throw new Error(`GitHub release lookup failed with HTTP ${releases.status}.`);

    const body = await releases.json();
    signal.throwIfAborted();
    if (
      !Array.isArray(body) ||
      body.some((release) => !release || typeof release !== "object" || Array.isArray(release))
    )
      throw new Error("GitHub returned an invalid release list.");

    if (body.some((release) => release.prerelease !== true && release.draft !== true)) break;
    if (body.length < perPage) return "0.0.0";
  }

  // Keep GitHub's latest designation authoritative, including backports.
  const res = await fetch(`${repositoryUrl}/releases/latest`, request);
  signal.throwIfAborted();
  if (!res.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${res.status}.`);
  }

  const body = await res.json();
  signal.throwIfAborted();

  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new Error("GitHub returned an invalid full release.");
  if (body.prerelease === true || body.draft === true)
    throw new Error("GitHub returned a release that is not a published full release.");
  if (typeof body.tag_name !== "string" || !body.tag_name)
    throw new Error("GitHub returned a release without a tag name.");

  return body.tag_name;
};
