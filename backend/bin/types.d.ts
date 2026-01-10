declare module '@usebruno/converters' {
  export function openApiToBruno(spec: any): Promise<any>;
}

declare module 'js-yaml' {
  export function parse(str: string): any;
  export function load(str: string): any;
  export function stringify(obj: any): string;
}
