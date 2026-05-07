-- Add co-teach fields to courses table
ALTER TABLE public.courses
ADD COLUMN is_co_taught BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN co_tutor_id UUID REFERENCES public.app_users(id),
ADD COLUMN co_tutor_name TEXT,
ADD COLUMN co_tutor_email TEXT;

-- Add co-teach fields to course_creation_requests table
ALTER TABLE public.course_creation_requests
ADD COLUMN is_co_taught BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN co_tutor_id UUID REFERENCES public.app_users(id);
