import { useEffect, useState } from 'react';
import { useNavigation } from 'expo-router';
import { usePreventRemove, type NavigationAction } from 'expo-router/react-navigation';

/** Replay the original native action only after its removal guard has been released. */
export function useConfirmedRouteExit(
  enabled: boolean,
  requestExit: (proceed: () => void) => void,
) {
  const navigation = useNavigation();
  const [approvedAction, setApprovedAction] = useState<NavigationAction | null>(null);
  usePreventRemove(enabled && !approvedAction, ({ data }) => {
    requestExit(() => setApprovedAction(data.action));
  });
  useEffect(() => {
    if (!approvedAction) return;
    let active = true;
    navigation.dispatch(approvedAction);
    // Restore protection after dispatch settles if a parent refused the action.
    queueMicrotask(() => { if (active) setApprovedAction(null); });
    return () => { active = false; };
  }, [approvedAction, navigation]);
}
