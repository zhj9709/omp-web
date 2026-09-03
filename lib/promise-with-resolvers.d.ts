// TypeScript < 5.4 does not declare Promise.withResolvers (ES2024).
// Ambient augmentation so rpc-client.ts / rpc-manager.ts compile cleanly.
interface PromiseConstructor {
  withResolvers<T>(): {
    promise: Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
  };
}
