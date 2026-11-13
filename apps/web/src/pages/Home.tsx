import { useAuth } from '../lib/auth';
import { Fristen } from './Fristen';
import { Vorgaenge } from './Vorgaenge';
import { Pruefungen } from './Pruefungen';

export function Home() {
  const role = useAuth((s) => s.me?.user.roles[0]);
  if (role === 'projektleitung') return <Vorgaenge />;
  if (role === 'rechtsdienst') return <Pruefungen />;
  return <Fristen />;
}
