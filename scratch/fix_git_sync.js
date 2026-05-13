const fs = require('fs');

let content = fs.readFileSync('src/lib/githubSync.ts', 'utf8');

const regex = /text \+\= \`\\n\*\*\$\{filesChanged\}\*\* \$\{filesText\} changed, \*\*\$\{added\}\*\* \$\{insertionsText\}\(\+\), \*\*\$\{removed\}\*\* \$\{deletionsText\}\(\-\)\`;\n\s*successfulPushes \+\= 1;/;

const newText = `text += \`\\n**\${filesChanged}** \${filesText} changed, **\${added}** \${insertionsText}(+), **\${removed}** \${deletionsText}(-)\`;
      }

      try {
        await sendDiscordMessage(commitsChannel.id, text);
        successfulPushes += 1;`;

content = content.replace(regex, newText);

fs.writeFileSync('src/lib/githubSync.ts', content);
