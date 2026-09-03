import Dashboard from './components/Dashboard';

// Rendered per request so a redeploy isn't needed to pick up a new LEAGUE_ID.
export const dynamic = 'force-dynamic';

export default function Page() {
  return <Dashboard leagueId={process.env.LEAGUE_ID ?? '47'} />;
}
