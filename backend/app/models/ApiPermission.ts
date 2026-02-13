export enum AuthType {
  SESSION = 'session',
  API_KEY = 'api-key',
  API_KEY_LEGACY = 'api-key-legacy',
}

export enum ApiKeyKind {
  SERVICE = 'service',
  USER = 'user',
}

export enum ApiPermission {
  ADD_MEDIA = 'ADD_MEDIA',
  READ_MEDIA = 'READ_MEDIA',
  UPDATE_MEDIA = 'UPDATE_MEDIA',
  REMOVE_MEDIA = 'REMOVE_MEDIA',

  READ_LISTS = 'READ_LISTS',
  CREATE_LISTS = 'CREATE_LISTS',
  UPDATE_LISTS = 'UPDATE_LISTS',
  DELETE_LISTS = 'DELETE_LISTS',
}
