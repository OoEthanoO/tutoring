const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const rawCount = execSync("git rev-list --count HEAD").toString().trim();
const totalCount = parseInt(rawCount, 10) || 0;

const rawLog = execSync(
  `git log --numstat --format="COMMIT|%H|%cI|%s"`
).toString();

const commits = [];
const lines = rawLog.split("\n");
let currentCommit = null;

for (const line of lines) {
  if (line.startsWith("COMMIT|")) {
    if (currentCommit) {
      commits.push(currentCommit);
    }
    const parts = line.split("|");
    const hash = parts[1] || "";
    const date = parts[2] || "";
    const message = parts.slice(3).join("|") || "";

    currentCommit = { hash, date, message, added: 0, removed: 0 };
  } else if (line.trim().length > 0 && currentCommit) {
    const statParts = line.split("\t");
    if (statParts.length >= 2) {
      const addedStr = statParts[0].trim();
      const removedStr = statParts[1].trim();
      if (addedStr !== "-") currentCommit.added += parseInt(addedStr, 10) || 0;
      if (removedStr !== "-") currentCommit.removed += parseInt(removedStr, 10) || 0;
    }
  }
}

if (currentCommit) {
  commits.push(currentCommit);
}

const outDir = path.join(__dirname, "..", "src", "generated");
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

fs.writeFileSync(
  path.join(outDir, "commits.json"),
  JSON.stringify({ total: totalCount, commits }, null, 2)
);

console.log(`Generated commits.json with ${totalCount} commits.`);
