import { Redirect } from 'expo-router';
import InboundScreen from '@/screens/inbound';
import { useSafeSearchParams } from '@/hooks/useSafeRouter';
import type { ErpAccountKey } from '@/utils/erpAccounts';

export default function InboundRoute() {
  const params = useSafeSearchParams<{ accountKey?: ErpAccountKey; voucherCode?: string }>();

  if (!params.accountKey || !params.voucherCode?.trim()) {
    return <Redirect href="/purchase-receive" />;
  }

  return <InboundScreen />;
}
