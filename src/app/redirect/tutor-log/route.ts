import { NextResponse } from "next/server";

export function GET() {
  return new NextResponse(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Tutor Log No Longer Required</title>
    <style>
      :root {
        color-scheme: light dark;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        align-items: center;
        background: Canvas;
        color: CanvasText;
        display: flex;
        justify-content: center;
        margin: 0;
        min-height: 100vh;
        padding: 24px;
      }
      main {
        max-width: 560px;
      }
      h1 {
        font-size: 28px;
        line-height: 1.15;
        margin: 0 0 12px;
      }
      p {
        color: color-mix(in srgb, CanvasText 72%, transparent);
        font-size: 16px;
        line-height: 1.6;
        margin: 0;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Tutor logs are no longer required.</h1>
      <p>You do not need to complete the old post-lesson tutor log form anymore. Thank you for teaching with YanLearn.</p>
    </main>
  </body>
</html>`,
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
      },
    }
  );
}
