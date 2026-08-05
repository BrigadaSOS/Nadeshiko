import { useToast } from 'vue-toastification';

export function useToastSuccess(msg: string) {
  useToast().success(msg);
}

export function useToastError(msg: string) {
  useToast().error(msg);
}

export function useToastInfo(msg: string) {
  useToast().info(msg);
}
