import { redirect } from 'next/navigation'

/** /wh has no page of its own yet — A/R is the section's landing view. */
export default function WhIndexPage() {
  redirect('/wh/ar')
}
