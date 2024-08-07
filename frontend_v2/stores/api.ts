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
        async createApiKeyGeneral(nameApiKey: string): Promise<ApiResponse | void> {
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
                        name: nameApiKey
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
