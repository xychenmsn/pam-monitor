import { useState, useCallback } from 'react';
import { checkAuth, triggerLogin } from '../lib/cloudwatch';

export type ConnectionState = 'unknown' | 'checking' | 'connected' | 'disconnected' | 'connecting';

export function useConnectionStatus() {
    const [statuses, setStatuses] = useState<Record<'qa' | 'dev' | 'prod', ConnectionState>>({
        qa: 'unknown',
        dev: 'unknown',
        prod: 'unknown'
    });

    const check = useCallback(async (env: 'qa' | 'dev' | 'prod') => {
        setStatuses(prev => ({ ...prev, [env]: 'checking' }));
        const isValid = await checkAuth(env);
        setStatuses(prev => ({
            ...prev,
            [env]: isValid ? 'connected' : 'disconnected'
        }));
        return isValid;
    }, []);

    const connect = useCallback(async (env: 'qa' | 'dev' | 'prod') => {
        setStatuses(prev => ({ ...prev, [env]: 'connecting' }));
        const triggerSuccess = await triggerLogin(env);
        if (!triggerSuccess) {
            setStatuses(prev => ({ ...prev, [env]: 'disconnected' }));
            return false;
        }
        
        // Give user time to approve Duo push
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const isValid = await checkAuth(env);
        setStatuses(prev => ({
            ...prev,
            [env]: isValid ? 'connected' : 'disconnected'
        }));
        return isValid;
    }, []);

    const setDisconnected = useCallback((env: 'qa' | 'dev' | 'prod') => {
        setStatuses(prev => ({ ...prev, [env]: 'disconnected' }));
    }, []);

    return { statuses, check, connect, setDisconnected };
}
