import type { Metadata } from "next";
import ClassExerciseStudent from "@/components/ClassExerciseStudent";

export const metadata: Metadata = { title: "Class exercises | YanLearn", robots: { index: false, follow: false } };
export default async function ClassExercisePage({ params }: { params: Promise<{ classId: string }> }) {
  return <ClassExerciseStudent classId={(await params).classId} />;
}
