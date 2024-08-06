import { useToast } from "vue-toastification";
const toast = useToast();

export function useToastSuccess(msg: string) {
    toast.success(msg)
}

export function useToastError(msg: string) {
    toast.error(msg)
}

export function useToastInfo(msg: string) {
    toast.info(msg)
}

export function useToastWarning(msg: string) {
    toast.warning(msg)
}

