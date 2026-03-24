import { NextResponse, type NextRequest } from "next/server";
import commitData from "@/generated/commits.json";

type CommitStat = {
  hash: string;
  date: string;
  message: string;
  added: number;
  removed: number;
};

type CommitData = {
  total: number;
  commits: CommitStat[];
};

const data = commitData as CommitData;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(searchParams.get("limit") || "20", 10) || 20));

  const start = (page - 1) * limit;
  const end = start + limit;
  const pageCommits = data.commits.slice(start, end);
  const totalPages = Math.ceil(data.total / limit);

  return NextResponse.json({
    total: data.total,
    page,
    totalPages,
    commits: pageCommits,
  });
}
