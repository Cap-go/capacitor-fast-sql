import { IsolationLevel } from './definitions';

export function assertSupportedIsolation(level?: IsolationLevel): void {
  if (level !== undefined && level !== IsolationLevel.Serializable) {
    throw new Error('Only SERIALIZABLE transaction isolation is supported');
  }
}
