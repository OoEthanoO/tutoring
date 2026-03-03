import { NextResponse } from "next/server";

const targetUrl =
    "https://docs.google.com/forms/d/e/1FAIpQLSfbp8hNm_hpGUfH-SvGbnF7LbsiemBbeXhjddVccSHS8di2nw/viewform";

export function GET() {
    return NextResponse.redirect(targetUrl);
}
