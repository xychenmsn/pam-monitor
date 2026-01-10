import { useState, useEffect, useCallback } from 'react';
import { checkAuth } from '../lib/cloudwatch';

export function useAuthHeartbeat(intervalMs: number = 30000) {
    const [isAuthError, setIsAuthError] = useState(false);

    const check = useCallback(async () => {
        const isValid = await checkAuth();
        setIsAuthError(!isValid);
        return isValid;
    }, []);

    useEffect(() => {
        // Initial check
        check();

        // Heartbeat
        const interval = setInterval(check, intervalMs);
        return () => clearInterval(interval);
    }, [check, intervalMs]);

    return { isAuthError, check };
}
