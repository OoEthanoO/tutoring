import { NextResponse } from "next/server";

const campaignUrl =
  "https://give.sickkidsfoundation.com/fundraisers/codingforsickkids/ethan--s-coding-class";

const parseDollarAmount = (value: string) => {
  const normalized = value.replaceAll(",", "").trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.round(parsed);
};

const findAmountAfterLabel = (html: string, labelPattern: RegExp) => {
  const match = html.match(labelPattern);
  if (!match || !match[1]) {
    return null;
  }
  return parseDollarAmount(match[1]);
};

const fetchRaisedAmount = async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const response = await fetch(campaignUrl, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; EthanCodingClassBot/1.0; +https://class.ethanyanxu.com)",
      },
      cache: "no-store",
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return (
      findAmountAfterLabel(
        html,
        /Raised[\s\S]{0,140}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i
      ) ??
      findAmountAfterLabel(
        html,
        /Please Help Me Reach My Goal[\s\S]{0,220}?\$\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)[\s\S]{0,120}?My Goal/i
      )
    );
  } catch {
    return null;
  }
};

export async function GET() {
  const raised = await fetchRaisedAmount();
  return NextResponse.json({ raised });
}

