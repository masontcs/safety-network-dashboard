import { redirect } from 'next/navigation'

/** The billing interface's entry point. */
export default function BillingIndexPage() {
  redirect('/billing/profiles')
}
