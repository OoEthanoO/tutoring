import { SupabaseClient } from "@supabase/supabase-js";

export async function relabelClassesForCourse(
  courseId: string,
  adminClient: SupabaseClient
) {
  const { data: classes, error } = await adminClient
    .from("course_classes")
    .select("id, title, starts_at")
    .eq("course_id", courseId)
    .order("starts_at", { ascending: true });

  if (error || !classes) {
    console.error("Failed to fetch classes for relabeling:", error);
    return;
  }

  for (let i = 0; i < classes.length; i++) {
    const expectedTitle = `Class ${i + 1}`;
    if (classes[i].title !== expectedTitle) {
      await adminClient
        .from("course_classes")
        .update({ title: expectedTitle })
        .eq("id", classes[i].id);
    }
  }
}
