module.exports = async function findNewestRelease({ signal: requestedSignal } = {}) {
  const timeout = AbortSignal.timeout(30000);
  const signal = requestedSignal ? AbortSignal.any([requestedSignal, timeout]) : timeout;
  signal.throwIfAborted();
  const res = await fetch("https://api.github.com/repos/lumine-code/lumine/releases", {
    signal,
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Lumine.Lumine-Updater",
    },
  });
  signal.throwIfAborted();

  if (!res.ok) {
    throw new Error(`GitHub release lookup failed with HTTP ${res.status}.`);
  }

  const body = await res.json();
  signal.throwIfAborted();

  if (!Array.isArray(body)) throw new Error("GitHub returned an invalid release list.");
  if (body.length === 0) return "0.0.0";
  if (typeof body[0].tag_name !== "string" || !body[0].tag_name)
    throw new Error("GitHub returned a release without a tag name.");

  // We can be fast and simply check if the top of the array is newer than our
  // current version. Since the return is ordered.
  return body[0].tag_name;
};
