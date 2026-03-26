import { useEffect, useRef } from 'react';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayStatus } from '@/types/gateway';

type FetchChannels = (probe?: boolean, options?: { includeRuntime?: boolean }) => Promise<void>;
type FetchAgents = () => Promise<void>;

export function useGatewayPageRefresh(params: {
  fetchAgents: FetchAgents;
  fetchChannels: FetchChannels;
  gatewayState: GatewayStatus['state'];
  gatewayLifecycleState: string;
}): { refresh: () => void } {
  const { fetchAgents, fetchChannels, gatewayState, gatewayLifecycleState } = params;
  const previousGatewayStateRef = useRef(gatewayState);

  useEffect(() => {
    let cancelled = false;

    void fetchAgents();
    void fetchChannels(false, { includeRuntime: false }).then(() => {
      if (cancelled || gatewayState !== 'running') return;
      void fetchChannels(false, { includeRuntime: true });
    });

    return () => {
      cancelled = true;
    };
  }, [fetchAgents, fetchChannels, gatewayState]);

  useEffect(() => {
    const refreshAll = () => {
      void fetchAgents();
      void fetchChannels(false);
    };

    const unsubscribeGateway = subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
      const previousState = previousGatewayStateRef.current;
      previousGatewayStateRef.current = payload.state;
      if (previousState !== 'running' && payload.state === 'running') {
        refreshAll();
      }
    });
    const unsubscribeChannels = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels(false);
    });

    return () => {
      unsubscribeGateway();
      unsubscribeChannels();
    };
  }, [fetchAgents, fetchChannels]);

  useEffect(() => {
    previousGatewayStateRef.current = gatewayState;
  }, [gatewayState]);

  useEffect(() => {
    if (gatewayLifecycleState !== 'completed') return;
    void fetchAgents();
    void fetchChannels(false);
  }, [fetchAgents, fetchChannels, gatewayLifecycleState]);

  return {
    refresh: () => {
      void fetchAgents();
      void fetchChannels(false);
    },
  };
}
