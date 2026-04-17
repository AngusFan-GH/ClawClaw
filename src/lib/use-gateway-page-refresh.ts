import { useEffect, useRef } from 'react';
import { subscribeHostEvent } from '@/lib/host-events';
import type { GatewayStatus } from '@/types/gateway';

type FetchChannels = (probe?: boolean, options?: { includeRuntime?: boolean }) => Promise<void>;
type FetchAgents = (options?: { silent?: boolean }) => Promise<void>;

export function useGatewayPageRefresh(params: {
  fetchAgents: FetchAgents;
  fetchChannels: FetchChannels;
  gatewayState: GatewayStatus['state'];
  gatewayLifecycleState?: string;
}): { refresh: () => void } {
  const { fetchAgents, fetchChannels, gatewayState } = params;
  const previousGatewayStateRef = useRef(gatewayState);

  useEffect(() => {
    void fetchAgents({ silent: true });
    void fetchChannels(false, { includeRuntime: false });
    if (gatewayState === 'running') {
      void fetchChannels(false, { includeRuntime: true });
    }
  }, [fetchAgents, fetchChannels, gatewayState]);

  useEffect(() => {
    const refreshAll = () => {
      void fetchAgents({ silent: true });
      void fetchChannels(false, { includeRuntime: false });
      void fetchChannels(false, { includeRuntime: true });
    };

    const unsubscribeGateway = subscribeHostEvent<GatewayStatus>('gateway:status', (payload) => {
      const previousState = previousGatewayStateRef.current;
      previousGatewayStateRef.current = payload.state;
      if (previousState !== 'running' && payload.state === 'running') {
        refreshAll();
      }
    });
    const unsubscribeChannels = subscribeHostEvent('gateway:channel-status', () => {
      void fetchChannels(false, { includeRuntime: true });
    });

    return () => {
      unsubscribeGateway();
      unsubscribeChannels();
    };
  }, [fetchAgents, fetchChannels]);

  useEffect(() => {
    previousGatewayStateRef.current = gatewayState;
  }, [gatewayState]);

  return {
    refresh: () => {
      void fetchAgents();
      void fetchChannels(false, { includeRuntime: true });
    },
  };
}
