import type { ProtonDriveHTTPClient, ProtonDriveHTTPClientJsonRequest, ProtonDriveHTTPClientBlobRequest } from '../types/interface';
import { APP_VERSION } from '../version';

export type AuthTokenGetter = () => { accessToken: string; uid: string } | null;

export class NodeHttpClient implements ProtonDriveHTTPClient {
    private readonly timeoutMs: number;
    private readonly getAuthToken: AuthTokenGetter;
    private readonly appVersion: string;

    constructor(
        options: {
            timeoutMs?: number;
            getAuthToken?: AuthTokenGetter;
            appVersion?: string;
        } = {},
    ) {
        this.timeoutMs = options.timeoutMs ?? 30000;
        this.getAuthToken = options.getAuthToken ?? (() => null);
        this.appVersion = options.appVersion ?? APP_VERSION;
    }

    async fetchJson(request: ProtonDriveHTTPClientJsonRequest): Promise<Response> {
        const { url, method, headers, json, body, timeoutMs = this.timeoutMs, signal } = request;

        const mergedHeaders = this.buildHeaders(headers);
        if (json) {
            mergedHeaders['Content-Type'] = 'application/json';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            return await fetch(url, {
                method,
                headers: mergedHeaders,
                body: json ? JSON.stringify(json) : (body as BodyInit | undefined),
                signal: combinedSignal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    async fetchBlob(request: ProtonDriveHTTPClientBlobRequest): Promise<Response> {
        const { url, method, headers, body, timeoutMs = this.timeoutMs, signal } = request;

        const mergedHeaders = this.buildHeaders(headers);

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
            return await fetch(url, {
                method,
                headers: mergedHeaders,
                body: body as BodyInit | undefined,
                signal: combinedSignal,
            });
        } finally {
            clearTimeout(timeoutId);
        }
    }

    private buildHeaders(incoming: Headers): Record<string, string> {
        const result: Record<string, string> = {};
        incoming.forEach((value, key) => {
            result[key] = value;
        });
        result['x-pm-appversion'] = this.appVersion;

        const auth = this.getAuthToken();
        if (auth) {
            result['Authorization'] = `Bearer ${auth.accessToken}`;
            result['x-pm-uid'] = auth.uid;
        }

        return result;
    }
}
