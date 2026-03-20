import { NextResponse } from "next/server";

const targetUrl =
    "https://forms.gle/gmiLF8fDffTXn5sT6";

export function GET() {
    return NextResponse.redirect(targetUrl);
}
