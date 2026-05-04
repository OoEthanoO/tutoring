ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

-- Allow read access to authenticated users
CREATE POLICY "Allow authenticated users to read custom_roles" 
ON public.custom_roles
FOR SELECT 
TO authenticated 
USING (true);

-- No insert/update/delete policies for anon/authenticated.
-- The service_role key is used by the backend to write to this table, which bypasses RLS.
