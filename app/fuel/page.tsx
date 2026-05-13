import { redirect } from 'next/navigation'

export default function FuelPage() {
  redirect('/dashboard?tab=fuel')
}
