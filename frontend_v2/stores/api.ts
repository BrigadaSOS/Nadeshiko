import { defineStore } from "pinia";
import { useRuntimeConfig } from '#app';

interface ApiResponse {
    status: number;
    [key: string]: any;
}

export const apiStore = defineStore('api', {
    actions: {
        async getApiKeysByUser(): Promise<ApiResponse | void> {
            const config = useRuntimeConfig();
            try {
                const response = await fetch(`${config.public.baseURLBackend}user/getApiKeys`, {
                    method: "POST",
                    mode: "cors",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "include"
                });
                const data = await response.json();
                return data;
            } catch (error) {
                console.error(error);
            }
        },
        async deactivateApiKey(apiKeyId: string): Promise<ApiResponse | void> {
            const config = useRuntimeConfig();
            try {
                const response = await fetch(`${config.public.baseURLBackend}user/deactivateApiKey`, {
                    method: "POST",
                    mode: "cors",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                      api_key_id: apiKeyId
                    }),
                    credentials: "include"
                });
                const data = await response.json();
                return data;
            } catch (error) {
                console.error(error);
            }
        },
        async createApiKeyGeneral(nameApiKey: string, permissions?: string[]): Promise<ApiResponse | void> {
            const config = useRuntimeConfig();
            try {
                const response = await fetch(`${config.public.baseURLBackend}user/createApiKey`, {
                    method: "POST",
                    mode: "cors",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "include",
                    body: JSON.stringify({
                        name: nameApiKey,
                        permissions: permissions
                    })
                });
                const data = await response.json();
                return data;
            } catch (error) {
                console.error(error);
            }
        }
    }
});
