// Thin fetch wrapper. All secrets stay on the backend — the browser only ever
// talks to same-origin routes exposed by server/index.js.
async function api(path, options) {
  const opts = options || {};
  opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  const res = await fetch(path, opts);
  let body = null;
  try {
    body = await res.json();
  } catch (err) {
    body = null;
  }
  if (!res.ok) {
    throw new Error((body && (body.error || body.message)) || `Request failed (HTTP ${res.status})`);
  }
  return body;
}

window.api = api;
