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
  const res = await fetch(`${repositoryUrl}/releases/latest`, request);
  signal.throwIfAborted();

  // A missing full release and an unavailable repository both answer 404.
  // Preserve the no-release sentinel only after confirming the repository.
  if (res.status === 404) {
    const repository = await fetch(repositoryUrl, request);
    signal.throwIfAborted();
    if (!repository.ok)
      throw new Error(`GitHub repository lookup failed with HTTP ${repository.status}.`);
    return "0.0.0";
  }
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
