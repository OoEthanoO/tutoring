import React, { ReactNode } from "react";

function parseInlineMarkdown(text: string): ReactNode[] {
    // Regex to match ___**...**___, **___...___**, ***...***, ___...___, **...**, __...__, *...*, _..._
    const tokenRegex = /(___\*\*[^*]+\*\*___)|(\*\*___[^_]+___\*\*)|(\*\*\*[^*]+\*\*\*)|(___[^_]+___)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)/g;

    const parts: ReactNode[] = [];
    let lastIndex = 0;

    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push(text.slice(lastIndex, match.index));
        }

        const matchedText = match[0];
        if (matchedText.startsWith("___**") && matchedText.endsWith("**___")) {
            parts.push(
                <u key={`ubi-${match.index}`}>
                    <em key={`em-${match.index}`}>
                        <strong key={`strong-${match.index}`}>{matchedText.slice(5, -5)}</strong>
                    </em>
                </u>
            );
        } else if (matchedText.startsWith("**___") && matchedText.endsWith("___**")) {
            parts.push(
                <strong key={`bui-${match.index}`}>
                    <u key={`u-${match.index}`}>
                        <em key={`em-${match.index}`}>{matchedText.slice(5, -5)}</em>
                    </u>
                </strong>
            );
        } else if (matchedText.startsWith("***") && matchedText.endsWith("***")) {
            parts.push(
                <strong key={`bolditalic-${match.index}`}>
                    <em key={`inner-${match.index}`}>{matchedText.slice(3, -3)}</em>
                </strong>
            );
        } else if (matchedText.startsWith("___") && matchedText.endsWith("___")) {
            parts.push(
                <u key={`underlineitalic-${match.index}`}>
                    <em key={`inner-${match.index}`}>{matchedText.slice(3, -3)}</em>
                </u>
            );
        } else if (matchedText.startsWith("**") && matchedText.endsWith("**")) {
            parts.push(<strong key={`bold-${match.index}`}>{matchedText.slice(2, -2)}</strong>);
        } else if (matchedText.startsWith("__") && matchedText.endsWith("__")) {
            parts.push(<u key={`underline-${match.index}`}>{matchedText.slice(2, -2)}</u>);
        } else if (matchedText.startsWith("*") && matchedText.endsWith("*")) {
            parts.push(<em key={`italic-${match.index}`}>{matchedText.slice(1, -1)}</em>);
        } else if (matchedText.startsWith("_") && matchedText.endsWith("_")) {
            parts.push(<em key={`italic-${match.index}`}>{matchedText.slice(1, -1)}</em>);
        }

        lastIndex = tokenRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push(text.slice(lastIndex));
    }

    return parts;
}

export function MarkdownText({ text }: { text: string }) {
    if (!text) return null;

    const blocks: ReactNode[] = [];
    const lines = text.split("\n");

    let inList = false;
    let listItems: ReactNode[] = [];
    let lineGroupIndex = 0;

    const flushList = () => {
        if (inList && listItems.length > 0) {
            blocks.push(
                <ul key={`list-${lineGroupIndex}`} className="list-disc pl-5 my-1">
                    {listItems}
                </ul>
            );
            inList = false;
            listItems = [];
            lineGroupIndex++;
        }
    };

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trimStart();

        const isListItem = trimmed.startsWith("- ") || trimmed.startsWith("* ");

        if (isListItem) {
            inList = true;
            const content = trimmed.slice(2);
            listItems.push(
                <li key={`li-${i}`}>{parseInlineMarkdown(content)}</li>
            );
        } else {
            flushList();
            blocks.push(
                <span key={`text-${i}`} className="block">
                    {parseInlineMarkdown(line)}
                    {/* Only add invisible break if the line was empty to preserve spacing */}
                    {line.length === 0 && <br />}
                </span>
            );
        }
    }

    flushList(); // ensure any trailing list is added

    return <div className="space-y-1">{blocks}</div>;
}
