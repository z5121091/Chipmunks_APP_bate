import { Redirect } from 'expo-router';

// Preserve old deep links without exposing the retired field manager.
export default function LegacyCustomFieldsRoute() {
  return <Redirect href="/rules" />;
}
