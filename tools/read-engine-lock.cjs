const assert = require("node:assert/strict");
const lock = require("../resources/engine-lock.json");

assert.equal(lock.repository, "designsvet/ao-loot-logger");
assert.match(lock.commit, /^[a-f0-9]{40}$/);
console.log(`repository=${lock.repository}`);
console.log(`commit=${lock.commit}`);
