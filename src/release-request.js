const https = require("node:https");
const { URL } = require("node:url");

const redirectStatuses = new Set([301, 302, 303, 307, 308]);
const maxRedirects = 5;

async function requestRelease(url, { headers, signal } = {}, redirects = 0) {
  signal?.throwIfAborted();
  const target = new URL(url);
  if (target.protocol !== "https:") throw new Error("GitHub release lookup requires HTTPS.");

  // Node's transport keeps expected offline failures out of Chromium's console.
  // Leave agent selection to Node, including its configured proxy environment.
  return new Promise((resolve, reject) => {
    const request = https.get(target, { headers, signal }, (response) => {
      response.once("error", reject);
      if (redirectStatuses.has(response.statusCode) && response.headers.location) {
        response.resume();
        if (redirects >= maxRedirects) {
          reject(new Error("GitHub release lookup exceeded the redirect limit."));
          return;
        }
        try {
          const destination = new URL(response.headers.location, target);
          requestRelease(destination, { headers, signal }, redirects + 1).then(resolve, reject);
        } catch (error) {
          reject(error);
        }
        return;
      }

      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.once("end", () => {
        if (signal?.aborted) {
          reject(signal.reason);
          return;
        }
        const body = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: response.statusCode >= 200 && response.statusCode < 300,
          status: response.statusCode,
          async json() {
            signal?.throwIfAborted();
            return JSON.parse(body);
          },
        });
      });
    });
    request.once("error", reject);
  });
}

module.exports = { fetch: requestRelease };
