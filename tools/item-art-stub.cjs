/** Layout proofs use a local PNG; public image availability is not a layout gate. */
const { protocol } = require("electron");
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfoYAAAAASUVORK5CYII=",
  "base64",
);
protocol.registerSchemesAsPrivileged([
  { scheme: "albion-art", privileges: { standard: true, secure: true, bypassCSP: true } },
]);
module.exports = () =>
  protocol.handle("albion-art", () => new Response(png, { headers: { "Content-Type": "image/png" } }));
