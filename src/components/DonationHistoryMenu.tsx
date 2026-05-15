"use client";

import { useEffect, useState } from "react";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";

export default function DonationHistoryMenu() {
  const [raised, setRaised] = useState<number | null>(null);
  const [donationHistory, setDonationHistory] = useState<{ date: string; amount: number }[]>([]);

  useEffect(() => {
    const loadRaised = async () => {
      const response = await fetch("/api/fundraising/total");
      if (!response.ok) {
        return;
      }
      const data = (await response.json()) as { raised?: number | null };
      setRaised(typeof data.raised === "number" ? data.raised : null);
    };
    loadRaised();
  }, []);

  useEffect(() => {
    const loadHistory = async () => {
      const response = await fetch("/api/fundraising/daily");
      if (!response.ok) return;
      const data = (await response.json()) as { history?: { date: string; amount: number }[] };
      if (data.history) {
        setDonationHistory(data.history);
      }
    };
    loadHistory();
  }, []);

  // Generate a dummy graph if no data exists yet
  const displayData = donationHistory.length > 0 
    ? donationHistory 
    : [
        { date: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), amount: 0 },
        { date: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), amount: 0 },
        { date: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), amount: 0 },
        { date: new Date().toISOString(), amount: raised ?? 0 }
      ];

  return (
    <section className="space-y-6 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
      <header className="space-y-1">
        <h2 className="text-lg font-semibold text-[var(--foreground)]">Donation History</h2>
        <p className="text-sm text-[var(--muted)]">
          Follow the progress of the Coding for SickKids campaign over time.
        </p>
      </header>

      {raised !== null ? (
        <p className="text-sm font-semibold text-[var(--foreground)]">
          Current total raised: ${raised.toLocaleString()}
        </p>
      ) : null}

      <div className="h-64 w-full bg-[var(--surface-muted)] rounded-xl p-4">
        {displayData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayData} margin={{ top: 5, right: 30, left: 10, bottom: 0 }}>
              <defs>
                <linearGradient id="colorAmountHistoric" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--foreground)" stopOpacity={0.2}/>
                  <stop offset="95%" stopColor="var(--foreground)" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis 
                dataKey="date" 
                tickFormatter={(tick) => {
                  const d = new Date(tick);
                  d.setDate(d.getDate() + 1);
                  return `${d.getMonth() + 1}/${d.getDate()}`;
                }}
                stroke="var(--muted)" 
                fontSize={12} 
                tickLine={false}
                axisLine={false}
              />
              <YAxis 
                stroke="var(--muted)" 
                fontSize={12} 
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => `$${value}`}
              />
              <Tooltip 
                contentStyle={{ borderRadius: '8px', border: '1px solid var(--border)', backgroundColor: 'var(--surface)' }}
                labelStyle={{ color: 'var(--muted)' }}
                itemStyle={{ color: 'var(--foreground)' }}
                formatter={(value: any) => [`$${Number(value)}`, 'Amount']}
                labelFormatter={(label) => {
                  const d = new Date(label);
                  d.setDate(d.getDate() + 1);
                  return d.toLocaleDateString();
                }}
              />
              <Area 
                type="monotone" 
                dataKey="amount" 
                stroke="var(--foreground)" 
                strokeWidth={2}
                fillOpacity={1} 
                fill="url(#colorAmountHistoric)" 
                activeDot={{ r: 5, fill: "var(--foreground)", stroke: "var(--surface)", strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center text-[var(--muted)] text-sm">
            Insufficient data for graph
          </div>
        )}
      </div>
    </section>
  );
}
