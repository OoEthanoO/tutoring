const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

function getGitInfoLocal() {
  try {
    const remoteUrl = execSync("git remote get-url origin").toString().trim();
    // Handles https://github.com/owner/repo.git or git@github.com:owner/repo.git
    const match = remoteUrl.match(/github\.com[:/](.+?)\/(.+?)(\.git)?$/);
    if (!match) return null;
    
    const owner = match[1];
    const repo = match[2];
    const branch = execSync("git branch --show-current").toString().trim() || "main";
    
    return { owner, repo, branch };
  } catch (e) {
    return null;
  }
}

async function fetchCommitsGraphQL(token, owner, repo, branch) {
  const commits = [];
  let hasNextPage = true;
  let cursor = null;
  let totalCount = 0;

  while (hasNextPage) {
    const query = `
      query($owner: String!, $repo: String!, $branch: String!, $cursor: String) {
        repository(owner: $owner, name: $repo) {
          ref(qualifiedName: $branch) {
            target {
              ... on Commit {
                history(first: 100, after: $cursor) {
                  totalCount
                  nodes {
                    oid
                    messageHeadline
                    committedDate
                    additions
                    deletions
                  }
                  pageInfo {
                    hasNextPage
                    endCursor
                  }
                }
              }
            }
          }
        }
      }
    `;

    const variables = { owner, repo, branch, cursor };

    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ query, variables })
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`GitHub API error: ${response.status} ${text}`);
    }

    const json = await response.json();
    if (json.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    const ref = json.data.repository?.ref;
    if (!ref) {
       throw new Error(`Branch ${branch} not found in repository ${owner}/${repo}`);
    }
    
    const history = ref.target.history;
    totalCount = history.totalCount;

    for (const node of history.nodes) {
      commits.push({
        hash: node.oid,
        date: node.committedDate,
        message: node.messageHeadline,
        added: node.additions,
        removed: node.deletions
      });
    }

    hasNextPage = history.pageInfo.hasNextPage;
    cursor = history.pageInfo.endCursor;
  }

  return { total: totalCount, commits };
}

function getLocalCommits() {
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
  
  return { total: totalCount, commits };
}

async function main() {
  const token = process.env.GITHUB_TOKEN;
  let data;

  if (token) {
    console.log("GITHUB_TOKEN found. Fetching commits from GitHub API...");
    const owner = process.env.VERCEL_GIT_REPO_OWNER || getGitInfoLocal()?.owner || "OoEthanoO";
    const repo = process.env.VERCEL_GIT_REPO_SLUG || getGitInfoLocal()?.repo || "tutoring";
    const branch = process.env.VERCEL_GIT_COMMIT_REF || getGitInfoLocal()?.branch || "main";

    try {
      data = await fetchCommitsGraphQL(token, owner, repo, branch);
      console.log(`Successfully fetched ${data.commits.length} commits from GitHub API.`);
    } catch (error) {
      console.error("Failed to fetch commits from GitHub API:", error);
      console.log("Falling back to local git...");
      data = getLocalCommits();
    }
  } else {
    console.log("No GITHUB_TOKEN found. Using local git history.");
    try {
      data = getLocalCommits();
    } catch (error) {
      console.error("Failed to get local commits:", error);
      data = { total: 0, commits: [] };
    }
  }

  const outDir = path.join(__dirname, "..", "src", "generated");
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(
    path.join(outDir, "commits.json"),
    JSON.stringify(data, null, 2)
  );

  console.log(`Generated commits.json with ${data.total} commits.`);
}

main().catch(console.error);
