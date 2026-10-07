import { Redirect } from 'expo-router';

// First launch always lands on the role chooser; the remembered choice arrives with M01.
export default function Index() {
  return <Redirect href="/welcome" />;
}
