const fs = require('fs');

let content = fs.readFileSync('src/lib/githubSync.ts', 'utf8');

const getCommitNumberStr = `
    const getCommitNumber = (sha: string) => {
      const foundIdx = commitsData.commits.findIndex(c => c.hash === sha);
      if (foundIdx !== -1) {
        return commitsData.total - foundIdx;
      }
      const githubIdx = githubCommits.findIndex(c => c.sha === sha);
      if (githubIdx !== -1) {
        for (let i = githubIdx + 1; i < githubCommits.length; i++) {
          const knownIdx = commitsData.commits.findIndex(c => c.hash === githubCommits[i].sha);
          if (knownIdx !== -1) {
            return commitsData.total - knownIdx + (i - githubIdx);
          }
        }
        return commitsData.total + (githubCommits.length - githubIdx);
      }
      return "?";
    };
`;

content = content.replace('for (const commit of commitsToProcess) {', getCommitNumberStr + '\n    for (const commit of commitsToProcess) {');

const letTextRegex = /let text = `\*\*New Commit:\*\* \\`\$\{shortId\}\\` by \$\{authorName\}\\n> \$\{title\}`;/;

const updatedText = `
      const commitNumber = getCommitNumber(commit.sha);
      const fullMessage = commit.commit.message.trim();
      let text = \`**Commit #\${commitNumber}:** \\\`\${shortId}\\*\` by \${authorName}\\n\${fullMessage}\`;
`;

content = content.replace(letTextRegex, updatedText.trim());

fs.writeFileSync('src/lib/githubSync.ts', content);
