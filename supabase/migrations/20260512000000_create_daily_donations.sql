CREATE TABLE IF NOT EXISTS public.daily_donations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    date DATE NOT NULL UNIQUE,
    amount INTEGER NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.daily_donations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to daily donations"
    ON public.daily_donations FOR SELECT
    USING (true);

