import { getSession } from '@workos-inc/authkit-nextjs'
import { redirect } from 'next/navigation'
import MapView from './MapView'

export default async function HomePage() {
  const session = await getSession()
  if (!session?.user) redirect('/sign-in')
  return <MapView />
}
