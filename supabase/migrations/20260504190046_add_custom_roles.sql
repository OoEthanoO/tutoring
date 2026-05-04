CREATE TABLE IF NOT EXISTS public.custom_roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL UNIQUE,
    role_level TEXT NOT NULL CHECK (role_level IN ('CEO', 'COO', 'Chief Executive', 'Executive', 'Junior Executive', 'Student')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS custom_role TEXT REFERENCES public.custom_roles(name) ON DELETE SET NULL;
