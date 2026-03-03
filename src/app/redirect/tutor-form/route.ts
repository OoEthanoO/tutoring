import { NextResponse } from "next/server";

const targetUrl =
    "https://docs.google.com/forms/d/e/1FAIpQLSeuaZhER3fUbkl1ijHy0k-COLAcpOy8QvYM5sgtcWGEqtHmNw/viewform";

export function GET() {
    return NextResponse.redirect(targetUrl);
}
